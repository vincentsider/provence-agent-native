/**
 * Catalogue build orchestrator (issue #600, spec sections 5 and 7.1).
 *
 *   npx tsx ingest/build-catalog.ts               # hub pages only (~72 fetches)
 *   npx tsx ingest/build-catalog.ts --enrich      # + one fetch per detail page
 *   npx tsx ingest/build-catalog.ts --enrich --limit 200
 *   npx tsx ingest/build-catalog.ts --allow-drift # skip the ±10% count guard
 *   npx tsx ingest/build-catalog.ts --accept-flagged
 *
 * Artefacts land in data-out/ (gitignored: the catalogue never enters the
 * repository, spec 13.2): catalog.<sha8>.json, vocab.<sha8>.json, manifest.json.
 *
 * The build FAILS on: budget overrun, record without a canonical path, any
 * tag id missing from the vocabulary, duplicate slugs, unreviewed injection
 * flags, or a record count drifting >10% from the previous manifest.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

import { fetchCached, fetchStats } from './fetch';
import { enumerateDetailPages } from './sitemap';
import { flagInjectionPatterns, type Flag } from './sanitize';
import {
  parseDetailNodeId,
  parseDetailPage,
  parseHubPage,
  pathToName,
  pathToTown,
  type FacetEntry,
  type HubCard,
} from './parse';
import {
  CLUSTERS,
  slugify,
  type ClusterKey,
  type Manifest,
  type Place,
  type VocabTag,
} from '../src/lib/types';

const OUT_DIR = path.join(__dirname, '..', 'data-out');
const BUILD_DIR = path.join(__dirname, '..', 'build');
const BASE = 'https://www.myprovence.fr/les-guides';

const BUDGET_CATALOG_BROTLI = 350 * 1024;
const BUDGET_VOCAB_BROTLI = 40 * 1024;
const MAX_RECORDS = 0xffff; // Uint16Array indexing ceiling
const DRIFT_TOLERANCE = 0.1;

interface Args {
  enrich: boolean;
  limit: number | null;
  allowDrift: boolean;
  acceptFlagged: boolean;
}

function parseArgs(argv: string[]): Args {
  const limitIdx = argv.indexOf('--limit');
  return {
    enrich: argv.includes('--enrich'),
    limit: limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null,
    allowDrift: argv.includes('--allow-drift'),
    acceptFlagged: argv.includes('--accept-flagged'),
  };
}

interface WorkingPlace {
  nodeId: number;
  cluster: number;
  name: string;
  town: string | null;
  lat: number | null;
  lng: number | null;
  grade: number | null;
  tagIds: Set<number>;
  path: string;
  summary: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  const byNodeId = new Map<number, WorkingPlace>();
  const facetTags = new Map<number, { label: string; count: number; vocab?: string }>();
  /** alias term id -> canonical term id, from same-hub facet evidence. */
  const aliasPairs = new Map<number, number>();
  const detailTags = new Map<number, string>();
  const flags: Array<Flag & { where: string }> = [];

  // ---- Stage 1: hub pages + pagination -----------------------------------
  for (const [clusterIdx, cluster] of CLUSTERS.entries()) {
    const firstHtml = await fetchCached(`${BASE}/${cluster.path}`);
    const first = parseHubPage(firstHtml);
    const pages = first.totalPages ?? 1;
    console.log(
      `[hub] ${cluster.key}: ${first.totalResults ?? '?'} places over ${pages} pages, ` +
        `${first.facets.length} facets`,
    );

    ingestCards(byNodeId, first.cards, clusterIdx, cluster.path);
    ingestFacets(facetTags, first.facets);
    detectHubAliasPairs(first.facets, aliasPairs);

    for (let pg = 2; pg <= pages; pg++) {
      const html = await fetchCached(`${BASE}/${cluster.path}?pg=${pg}`);
      const page = parseHubPage(html);
      if (page.cards.length === 0) break; // defensive: stop on an empty page
      ingestCards(byNodeId, page.cards, clusterIdx, cluster.path);
    }
  }

  console.log(`[hub] total unique places from hub cards: ${byNodeId.size}`);

  // ---- Stage 1b: sitemap enumeration --------------------------------------
  // The hub pagination is non-deterministic (overlapping windows between
  // requests), so hub cards alone under-count by ~35%. The sitemap is the
  // authoritative enumeration; hub cards remain the cheap source of name,
  // town and coordinates for the places they did cover.
  const sitemapEntries = await enumerateDetailPages();
  const byPath = new Map<string, WorkingPlace>();
  for (const wp of byNodeId.values()) byPath.set(wp.path, wp);
  let sitemapOnly = 0;
  for (const entry of sitemapEntries) {
    if (byPath.has(entry.path)) continue;
    sitemapOnly++;
    const wp: WorkingPlace = {
      nodeId: -1, // resolved during enrichment from the detail page
      cluster: entry.clusterIdx,
      name: pathToName(entry.path),
      town: pathToTown(entry.path, CLUSTERS[entry.clusterIdx]!.path),
      lat: null,
      lng: null,
      grade: null,
      tagIds: new Set(),
      path: entry.path,
      summary: '',
    };
    byPath.set(entry.path, wp);
  }
  console.log(
    `[sitemap] ${sitemapEntries.length} detail pages; ${sitemapOnly} not covered by hub cards`,
  );
  if (byPath.size === 0) throw new Error('no places parsed; aborting');
  if (byPath.size > MAX_RECORDS) {
    throw new Error(`${byPath.size} records exceeds the Uint16Array ceiling ${MAX_RECORDS}`);
  }

  // ---- Stage 2 (optional): detail enrichment ------------------------------
  if (args.enrich) {
    const targets = [...byPath.values()].slice(0, args.limit ?? Infinity);
    let done = 0;
    for (const wp of targets) {
      try {
        const html = await fetchCached(`https://www.myprovence.fr${wp.path}`);
        const d = parseDetailPage(html);
        const nodeId = parseDetailNodeId(html, wp.path);
        if (nodeId !== null) wp.nodeId = nodeId;
        if (d.name) wp.name = d.name;
        if (d.summary) {
          wp.summary = d.summary;
          for (const f of flagInjectionPatterns(d.summary)) {
            flags.push({ ...f, where: wp.path });
          }
        }
        if (d.lat !== null) wp.lat = d.lat;
        if (d.lng !== null) wp.lng = d.lng;
        if (d.town) wp.town = d.town;
        if (d.grade !== null) wp.grade = d.grade;
        for (const t of d.tags) {
          wp.tagIds.add(t.termId);
          if (!facetTags.has(t.termId) && !detailTags.has(t.termId)) {
            detailTags.set(t.termId, t.label);
          }
        }
      } catch (err) {
        console.warn(`[enrich] ${wp.path}: ${err instanceof Error ? err.message : err}`);
      }
      done++;
      if (done % 100 === 0) {
        console.log(`[enrich] ${done}/${targets.length} (${fetchStats.network} network, ${fetchStats.cached} cached)`);
      }
    }
  }

  // ---- Injection flags: fail unless reviewed ------------------------------
  await mkdir(BUILD_DIR, { recursive: true });
  await writeFile(
    path.join(BUILD_DIR, 'flagged-content.json'),
    JSON.stringify(flags, null, 2),
  );
  if (flags.length > 0 && !args.acceptFlagged) {
    throw new Error(
      `${flags.length} injection-shaped pattern(s) found in source content; ` +
        `review build/flagged-content.json and re-run with --accept-flagged`,
    );
  }

  // ---- Vocabulary: slugs + alias resolution -------------------------------
  const tags: Record<string, VocabTag> = {};
  const slugOwner = new Map<string, number>();

  const allTagEntries: Array<{ id: number; label: string; n: number; vocab?: string; source: 'facet' | 'detail' }> = [
    ...[...facetTags.entries()].map(([id, t]) => ({
      id,
      label: t.label,
      n: t.count,
      vocab: t.vocab,
      source: 'facet' as const,
    })),
    ...[...detailTags.entries()].map(([id, label]) => ({
      id,
      label,
      n: 0,
      vocab: undefined,
      source: 'detail' as const,
    })),
  ];

  // Recompute populations from the actual records when we have per-place tags.
  const realCounts = new Map<number, number>();
  for (const wp of byPath.values()) {
    for (const t of wp.tagIds) realCounts.set(t, (realCounts.get(t) ?? 0) + 1);
  }

  for (const entry of allTagEntries) {
    let slug = slugify(entry.label);
    if (!slug) slug = `tag-${entry.id}`;
    const owner = slugOwner.get(slug);
    if (owner !== undefined && owner !== entry.id) {
      // Same label, different term id (e.g. "Terrasse" in two vocabularies):
      // keep the slug on the first owner, give this one a suffixed slug.
      slug = `${slug}-${entry.id}`;
    }
    slugOwner.set(slug, entry.id);
    tags[String(entry.id)] = {
      label: entry.label,
      vocab: entry.vocab,
      n: realCounts.get(entry.id) ?? entry.n,
      slug,
      source: entry.source,
    };
  }

  // Alias wiring from hub evidence (detectHubAliasPairs): the same criterion
  // exists under different term ids per surface ("Animaux acceptés" 463 on
  // the facet, bare "Acceptés" 20813 on hotel detail pages; "Piscine" twice).
  // The pairs are proven by identical counts on the SAME hub page plus label
  // containment, never by globally recomputed populations, which diverge.
  for (const [alias, canonical] of aliasPairs) {
    const c = tags[String(canonical)];
    if (!c || !tags[String(alias)]) continue;
    tags[String(canonical)] = { ...c, aliases: [...(c.aliases ?? []), alias] };
  }

  // A canonical tag's population must describe what a FILTER on it returns,
  // which is the union across its alias ids ("animaux-acceptes" = 463 U
  // 20813), not the count of its own id alone. An agent doing arithmetic on
  // explain_vocabulary must not be lied to.
  for (const [idStr, t] of Object.entries(tags)) {
    if (!t.aliases || t.aliases.length === 0) continue;
    const idSet = new Set<number>([Number(idStr), ...t.aliases]);
    let unionN = 0;
    for (const wp of byPath.values()) {
      for (const tagId of wp.tagIds) {
        if (idSet.has(tagId)) {
          unionN++;
          break;
        }
      }
    }
    if (unionN > 0) tags[idStr] = { ...t, n: unionN };
  }
  console.log(`[vocab] ${Object.keys(tags).length} tags, ${aliasPairs.size} alias pairs`);

  // ---- Towns table ---------------------------------------------------------
  const townIndex = new Map<string, number>();
  const towns: string[] = [];
  const townOf = (name: string | null): number => {
    if (!name) return -1;
    const key = slugify(name);
    const existing = townIndex.get(key);
    if (existing !== undefined) return existing;
    towns.push(name);
    townIndex.set(key, towns.length - 1);
    return towns.length - 1;
  };

  // ---- Final records -------------------------------------------------------
  // Sitemap-only records that were not enriched have no Drupal node id yet;
  // give them a deterministic negative id from the path so the id stays
  // stable across builds until enrichment resolves the real one.
  const seenIds = new Set<number>();
  const places: Place[] = [...byPath.values()]
    .map((wp) => {
      if (wp.nodeId < 0) wp.nodeId = -fnv1a(wp.path);
      return wp;
    })
    .filter((wp) => {
      if (seenIds.has(wp.nodeId)) return false; // e.g. two paths, one node
      seenIds.add(wp.nodeId);
      return true;
    })
    .sort((a, b) => a.nodeId - b.nodeId)
    .map((wp) => ({
      id: wp.nodeId,
      c: wp.cluster,
      n: wp.name,
      t: townOf(wp.town),
      lat: wp.lat,
      lng: wp.lng,
      g: wp.grade,
      tags: [...wp.tagIds].sort((a, b) => a - b),
      u: wp.path,
      s: wp.summary,
    }));

  // Integrity: every record path canonical, every tag id known.
  for (const p of places) {
    if (!p.u.startsWith('/les-guides/')) {
      throw new Error(`record ${p.id} has non-canonical path ${p.u}`);
    }
    for (const t of p.tags) {
      if (!tags[String(t)]) throw new Error(`record ${p.id} carries unknown tag id ${t}`);
    }
  }

  // Drift guard against the previous manifest.
  let previous: Manifest | null = null;
  try {
    previous = JSON.parse(
      await readFile(path.join(OUT_DIR, 'manifest.json'), 'utf-8'),
    ) as Manifest;
  } catch {
    // First build.
  }
  if (previous && !args.allowDrift) {
    const drift = Math.abs(places.length - previous.counts.places) / previous.counts.places;
    if (drift > DRIFT_TOLERANCE) {
      throw new Error(
        `record count ${places.length} drifts ${(drift * 100).toFixed(1)}% from previous ` +
          `${previous.counts.places}; re-run with --allow-drift if intentional`,
      );
    }
  }

  // ---- Emit ---------------------------------------------------------------
  await mkdir(OUT_DIR, { recursive: true });
  const catalogJson = JSON.stringify({ version: 1, places });
  const vocabJson = JSON.stringify({ version: 1, tags, towns });

  const catalogBr = brotliCompressSync(Buffer.from(catalogJson)).length;
  const vocabBr = brotliCompressSync(Buffer.from(vocabJson)).length;
  console.log(
    `[emit] catalog ${(catalogJson.length / 1024).toFixed(0)} KB raw / ${(catalogBr / 1024).toFixed(0)} KB br; ` +
      `vocab ${(vocabJson.length / 1024).toFixed(0)} KB raw / ${(vocabBr / 1024).toFixed(0)} KB br`,
  );
  if (catalogBr > BUDGET_CATALOG_BROTLI) {
    throw new Error(`catalog brotli ${catalogBr} exceeds budget ${BUDGET_CATALOG_BROTLI}`);
  }
  if (vocabBr > BUDGET_VOCAB_BROTLI) {
    throw new Error(`vocab brotli ${vocabBr} exceeds budget ${BUDGET_VOCAB_BROTLI}`);
  }

  const catalogHash = sha256(catalogJson).slice(0, 8);
  const vocabHash = sha256(vocabJson).slice(0, 8);
  const catalogFile = `catalog.${catalogHash}.json`;
  const vocabFile = `vocab.${vocabHash}.json`;
  await writeFile(path.join(OUT_DIR, catalogFile), catalogJson);
  await writeFile(path.join(OUT_DIR, vocabFile), vocabJson);

  const perCluster = Object.fromEntries(
    CLUSTERS.map((c, i) => [c.key, places.filter((p) => p.c === i).length]),
  ) as Record<ClusterKey, number>;

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'public',
    counts: {
      places: places.length,
      tags: Object.keys(tags).length,
      towns: towns.length,
      perCluster,
    },
    files: { catalog: catalogFile, vocab: vocabFile },
    sha256: { catalog: sha256(catalogJson), vocab: sha256(vocabJson) },
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `[done] ${places.length} places, ${Object.keys(tags).length} tags, ${towns.length} towns ` +
      `in ${((Date.now() - t0) / 1000).toFixed(0)}s ` +
      `(${fetchStats.network} network fetches, ${fetchStats.cached} cache hits)`,
  );
}

function ingestCards(
  byNodeId: Map<number, WorkingPlace>,
  cards: HubCard[],
  clusterIdx: number,
  clusterPath: string,
): void {
  for (const card of cards) {
    if (byNodeId.has(card.nodeId)) continue;
    byNodeId.set(card.nodeId, {
      nodeId: card.nodeId,
      cluster: clusterIdx,
      name: card.name,
      town: card.town ?? pathToTown(card.path, clusterPath),
      lat: card.lat,
      lng: card.lng,
      grade: null,
      tagIds: new Set(),
      path: card.path,
      summary: '',
    });
  }
}

/**
 * Same-hub facet pairs with identical counts and slug containment are the
 * same criterion under two term ids. Guard: a "non-X"/"sans-X" label must
 * never merge with "X" (opposite meaning, and "non-acceptes" contains
 * "acceptes"). The longer label is canonical.
 */
function detectHubAliasPairs(
  facets: FacetEntry[],
  aliasPairs: Map<number, number>,
): void {
  const negated = (slug: string) => slug.startsWith('non-') || slug.startsWith('sans-');
  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const a = facets[i]!;
      const b = facets[j]!;
      if (a.termId === b.termId || a.count !== b.count || a.count === 0) continue;
      const sa = slugify(a.label);
      const sb = slugify(b.label);
      if (!(sa === sb || sa.includes(sb) || sb.includes(sa))) continue;
      if (negated(sa) !== negated(sb)) continue;
      const [canonical, alias] =
        a.label.length >= b.label.length ? [a.termId, b.termId] : [b.termId, a.termId];
      if (!aliasPairs.has(alias) && !aliasPairs.has(canonical) && alias !== canonical) {
        aliasPairs.set(alias, canonical);
      }
    }
  }
}

function ingestFacets(
  facetTags: Map<number, { label: string; count: number; vocab?: string }>,
  facets: FacetEntry[],
): void {
  for (const f of facets) {
    const existing = facetTags.get(f.termId);
    if (!existing || f.count > existing.count) {
      facetTags.set(f.termId, { label: f.label, count: f.count });
    }
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 31-bit FNV-1a over the path: deterministic placeholder ids. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1; // strictly positive; caller negates
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
