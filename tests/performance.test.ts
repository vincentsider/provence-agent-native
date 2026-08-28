/**
 * Performance budgets asserted in CI (spec 7.3, criterion S3):
 * filter_places p95 <= 15 ms, p99 <= 30 ms over 1 000 randomised queries on a
 * catalogue-sized fixture; index build <= 40 ms.
 *
 * Runs against the REAL artefacts when data-out/ exists (the honest number),
 * else against a 3 000-record synthetic fixture shaped like the real one.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildIndexes, runFilter } from '@/lib/engine';
import type { Catalog, FilterInput, Place, Vocab, VocabTag } from '@/lib/types';
import { CLUSTERS } from '@/lib/types';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadRealOrSynthetic(): { catalog: Catalog; vocab: Vocab; label: string } {
  const outDir = path.join(__dirname, '..', 'data-out');
  try {
    if (existsSync(path.join(outDir, 'manifest.json'))) {
      const manifest = JSON.parse(
        readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'),
      ) as { files: { catalog: string; vocab: string; events?: string } };
      const catalog = JSON.parse(
        readFileSync(path.join(outDir, manifest.files.catalog), 'utf-8'),
      ) as Catalog;
      const vocab = JSON.parse(
        readFileSync(path.join(outDir, manifest.files.vocab), 'utf-8'),
      ) as Vocab;
      // Measure what the browser actually indexes: guides + events merged.
      if (manifest.files.events) {
        const events = JSON.parse(
          readFileSync(path.join(outDir, manifest.files.events), 'utf-8'),
        ) as Catalog;
        return {
          catalog: { version: 1, places: [...catalog.places, ...events.places] },
          vocab,
          label: `real merged (${catalog.places.length + events.places.length} records)`,
        };
      }
      return { catalog, vocab, label: `real (${catalog.places.length} records)` };
    }
  } catch {
    // fall through to synthetic
  }
  const rand = rng(9);
  const TAGS = Array.from({ length: 900 }, (_, i) => 100 + i);
  const places: Place[] = Array.from({ length: 3000 }, (_, i) => ({
    id: i + 1,
    c: Math.floor(rand() * CLUSTERS.length),
    n: `Place ${i}`,
    t: Math.floor(rand() * 100),
    lat: 43 + rand(),
    lng: 4.5 + rand() * 2,
    g: rand() < 0.3 ? 1 + Math.floor(rand() * 5) : null,
    tags: TAGS.filter(() => rand() < 0.03).sort((a, b) => a - b),
    u: `/les-guides/loisirs/x/p-${i}`,
    s: '',
    img: null,
  }));
  const tags: Record<string, VocabTag> = {};
  for (const id of TAGS) {
    tags[String(id)] = {
      label: `Tag ${id}`,
      n: places.filter((p) => p.tags.includes(id)).length,
      slug: `tag-${id}`,
      source: 'facet',
    };
  }
  return {
    catalog: { version: 1, places },
    vocab: { version: 1, tags, towns: Array.from({ length: 100 }, (_, i) => `Town ${i}`) },
    label: 'synthetic (3000 records)',
  };
}

describe('performance budgets', () => {
  const { catalog, vocab, label } = loadRealOrSynthetic();

  it(`index build <= 40 ms on ${label}`, () => {
    const t0 = performance.now();
    buildIndexes(catalog, vocab);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThanOrEqual(40);
  });

  it(`keyword query full scan p95 <= 25 ms on ${label}`, () => {
    const idx = buildIndexes(catalog, vocab);
    const rand = rng(555);
    const words = ['piscine', 'marche', 'festival', 'visite', 'street food', 'concert jazz', 'parking', 'aix'];
    const durations: number[] = [];
    for (let i = 0; i < 200; i++) {
      const q = words[Math.floor(rand() * words.length)]!;
      const t0 = performance.now();
      runFilter(catalog, idx, { query: q, limit: 40, offset: 0 });
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    expect(durations[Math.floor(durations.length * 0.95)]!).toBeLessThanOrEqual(25);
  });

  it(`filter_places p95 <= 15 ms, p99 <= 30 ms over 1000 queries on ${label}`, () => {
    const idx = buildIndexes(catalog, vocab);
    const rand = rng(4242);
    const slugs = Object.values(vocab.tags)
      .filter((t) => t.n > 0)
      .map((t) => t.slug);
    const durations: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const nTags = 1 + Math.floor(rand() * 3);
      const input: FilterInput = {
        cluster: rand() < 0.4 ? CLUSTERS[Math.floor(rand() * CLUSTERS.length)]!.key : undefined,
        tags: Array.from(
          { length: nTags },
          () => slugs[Math.floor(rand() * slugs.length)]!,
        ),
        minGrade: rand() < 0.2 ? 3 : undefined,
        limit: 40,
        offset: 0,
      };
      const t0 = performance.now();
      runFilter(catalog, idx, input);
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    const p99 = durations[Math.floor(durations.length * 0.99)]!;
    expect(p95).toBeLessThanOrEqual(15);
    expect(p99).toBeLessThanOrEqual(30);
  });
});
