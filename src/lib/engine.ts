/**
 * Pure query engine over the catalogue. No DOM, no fetch, no globals:
 * everything here is unit-testable against a naive reference implementation
 * (tests/filter.reference.test.ts), which is the guard against an
 * intersection bug shipping as quietly wrong answers.
 *
 * Performance model (spec 7.2): inverted index as sorted Uint16Array postings,
 * smallest-first merge intersection. parking (419) AND animaux (339) walks
 * 758 entries, not 2 798. Uint16Array bounds the catalogue at 65 535 records;
 * the ingest build asserts that ceiling, buildIndexes re-asserts it here.
 */

import {
  type Catalog,
  type FilterInput,
  type FilterResult,
  type Place,
  type Vocab,
  CLUSTERS,
  fold,
} from './types';

const EMPTY = new Uint16Array(0);

export interface Indexes {
  /** term id -> ascending record indices */
  readonly postings: ReadonlyMap<number, Uint16Array>;
  /** folded town name -> town index in vocab.towns */
  readonly townByFold: ReadonlyMap<string, number>;
  /** tag slug (and alias slugs) -> canonical term id */
  readonly idBySlug: ReadonlyMap<string, number>;
  /** geo grid: "cellLat:cellLng" -> ascending record indices */
  readonly grid: ReadonlyMap<string, Uint16Array>;
  /** record indices per cluster */
  readonly byCluster: readonly Uint16Array[];
}

export const GRID_CELL_DEG = 0.05;

export function buildIndexes(catalog: Catalog, vocab: Vocab): Indexes {
  const { places } = catalog;
  if (places.length > 0xffff) {
    throw new Error(
      `catalog has ${places.length} records; Uint16Array indexing caps at 65535`,
    );
  }

  // Two-pass postings build: count, allocate exact, fill. No intermediate
  // number[] churn for ~84k tag references.
  const counts = new Map<number, number>();
  for (const p of places) {
    for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const postings = new Map<number, Uint16Array>();
  const cursors = new Map<number, number>();
  for (const [t, n] of counts) {
    postings.set(t, new Uint16Array(n));
    cursors.set(t, 0);
  }
  const gridLists = new Map<string, number[]>();
  const clusterLists: number[][] = CLUSTERS.map(() => []);

  places.forEach((p, i) => {
    for (const t of p.tags) {
      const arr = postings.get(t)!;
      const at = cursors.get(t)!;
      arr[at] = i;
      cursors.set(t, at + 1);
    }
    if (p.lat !== null && p.lng !== null) {
      const key = gridKey(p.lat, p.lng);
      let list = gridLists.get(key);
      if (!list) gridLists.set(key, (list = []));
      list.push(i);
    }
    clusterLists[p.c]?.push(i);
  });

  const grid = new Map<string, Uint16Array>();
  for (const [k, list] of gridLists) grid.set(k, Uint16Array.from(list));

  const townByFold = new Map<string, number>();
  vocab.towns.forEach((t, i) => townByFold.set(fold(t), i));

  // Base pass: every tag's own slug. Second pass: alias slugs override to the
  // canonical id so either input finds the same postings (the "Acceptés" vs
  // "Animaux acceptés" trap). Two passes because iteration order must never
  // decide whether the alias mapping survives.
  const idBySlug = new Map<string, number>();
  for (const [idStr, tag] of Object.entries(vocab.tags)) {
    idBySlug.set(tag.slug, Number(idStr));
  }
  for (const [idStr, tag] of Object.entries(vocab.tags)) {
    for (const aliasId of tag.aliases ?? []) {
      const alias = vocab.tags[String(aliasId)];
      if (alias) idBySlug.set(alias.slug, Number(idStr));
    }
  }

  return {
    postings,
    townByFold,
    idBySlug,
    grid,
    byCluster: clusterLists.map((l) => Uint16Array.from(l)),
  };
}

export function gridKey(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`;
}

/** Merge-walk intersection of two ascending arrays. */
function intersect2(a: Uint16Array, b: Uint16Array): Uint16Array {
  const out = new Uint16Array(Math.min(a.length, b.length));
  let i = 0,
    j = 0,
    o = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!,
      y = b[j]!;
    if (x === y) {
      out[o++] = x;
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return out.subarray(0, o);
}

/** AND across postings lists, smallest first. */
export function intersectAll(lists: readonly Uint16Array[]): Uint16Array {
  if (lists.length === 0) return EMPTY;
  const sorted = [...lists].sort((a, b) => a.length - b.length);
  let acc = sorted[0]!;
  for (let k = 1; k < sorted.length && acc.length > 0; k++) {
    acc = intersect2(acc, sorted[k]!);
  }
  return acc;
}

/** OR across postings lists: k-way ascending merge with dedupe. */
export function unionAll(lists: readonly Uint16Array[]): Uint16Array {
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return EMPTY;
  if (nonEmpty.length === 1) return nonEmpty[0]!;
  const seen = new Set<number>();
  for (const l of nonEmpty) for (const v of l) seen.add(v);
  return Uint16Array.from([...seen].sort((a, b) => a - b));
}

export class UnknownSlugError extends Error {
  constructor(
    readonly slug: string,
    readonly suggestions: readonly string[],
  ) {
    super(`unknown tag slug: ${slug}`);
    this.name = 'UnknownSlugError';
  }
}

export class UnknownTownError extends Error {
  constructor(
    readonly town: string,
    readonly suggestions: readonly string[],
  ) {
    super(`unknown town: ${town}`);
    this.name = 'UnknownTownError';
  }
}

/** Rank known values by prefix/inclusion overlap with the bad input. */
export function nearest(
  input: string,
  known: Iterable<string>,
  max = 5,
): string[] {
  const needle = fold(input);
  const scored: Array<[number, string]> = [];
  for (const k of known) {
    let score = 0;
    if (k.includes(needle) || needle.includes(k)) score += 3;
    let p = 0;
    while (p < k.length && p < needle.length && k[p] === needle[p]) p++;
    score += p;
    if (score > 0) scored.push([score, k]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))
    .slice(0, max)
    .map(([, k]) => k);
}

function resolveSlugs(
  slugs: readonly string[],
  idx: Indexes,
): number[] {
  const ids: number[] = [];
  for (const raw of slugs) {
    const slug = fold(raw);
    const id = idx.idBySlug.get(slug);
    if (id === undefined) {
      throw new UnknownSlugError(slug, nearest(slug, idx.idBySlug.keys()));
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Run a filter. Throws UnknownSlugError / UnknownTownError for closed-vocabulary
 * misses so the caller can return a self-correcting typed error instead of an
 * empty set (an empty set reads to an agent as "no hotels have parking").
 */
export function runFilter(
  catalog: Catalog,
  idx: Indexes,
  input: FilterInput,
): FilterResult {
  const { places } = catalog;

  let candidates: Uint16Array | null = null;

  if (input.tags && input.tags.length > 0) {
    const ids = resolveSlugs(input.tags, idx);
    candidates = intersectAll(ids.map((id) => idx.postings.get(id) ?? EMPTY));
  }

  if (input.anyTags && input.anyTags.length > 0) {
    const ids = resolveSlugs(input.anyTags, idx);
    const anyList = unionAll(ids.map((id) => idx.postings.get(id) ?? EMPTY));
    candidates = candidates === null ? anyList : intersect2(candidates, anyList);
  }

  const clusterIdx =
    input.cluster === undefined
      ? -1
      : CLUSTERS.findIndex((c) => c.key === input.cluster);

  let townIdx = -1;
  if (input.town !== undefined) {
    const t = idx.townByFold.get(fold(input.town));
    if (t === undefined) {
      throw new UnknownTownError(input.town, nearest(input.town, idx.townByFold.keys()));
    }
    townIdx = t;
  }

  const passes = (p: Place): boolean => {
    if (clusterIdx >= 0 && p.c !== clusterIdx) return false;
    if (townIdx >= 0 && p.t !== townIdx) return false;
    if (input.minGrade !== undefined && (p.g === null || p.g < input.minGrade))
      return false;
    return true;
  };

  const matched: number[] = [];
  if (candidates !== null) {
    for (const i of candidates) if (passes(places[i]!)) matched.push(i);
  } else if (clusterIdx >= 0) {
    for (const i of idx.byCluster[clusterIdx] ?? EMPTY)
      if (passes(places[i]!)) matched.push(i);
  } else {
    for (let i = 0; i < places.length; i++) if (passes(places[i]!)) matched.push(i);
  }

  return {
    total: matched.length,
    indices: matched.slice(input.offset, input.offset + input.limit),
  };
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface NearResult {
  readonly total: number;
  readonly items: readonly { index: number; distanceKm: number }[];
}

/** Radius search: covering grid cells first, exact haversine second. */
export function runFindNear(
  catalog: Catalog,
  idx: Indexes,
  center: { lat: number; lng: number },
  radiusKm: number,
  cluster: number, // -1 = all
  limit: number,
): NearResult {
  const { places } = catalog;
  // Degrees per km: lat is ~1/111; lng shrinks with cos(lat).
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const latMin = Math.floor((center.lat - dLat) / GRID_CELL_DEG);
  const latMax = Math.floor((center.lat + dLat) / GRID_CELL_DEG);
  const lngMin = Math.floor((center.lng - dLng) / GRID_CELL_DEG);
  const lngMax = Math.floor((center.lng + dLng) / GRID_CELL_DEG);

  const hits: Array<{ index: number; distanceKm: number }> = [];
  for (let a = latMin; a <= latMax; a++) {
    for (let b = lngMin; b <= lngMax; b++) {
      const cell = idx.grid.get(`${a}:${b}`);
      if (!cell) continue;
      for (const i of cell) {
        const p = places[i]!;
        if (cluster >= 0 && p.c !== cluster) continue;
        const d = haversineKm(center.lat, center.lng, p.lat!, p.lng!);
        if (d <= radiusKm) hits.push({ index: i, distanceKm: Math.round(d * 10) / 10 });
      }
    }
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm || a.index - b.index);
  return { total: hits.length, items: hits.slice(0, limit) };
}
