/**
 * The engine's inverted-index filter must agree exactly with a naive
 * reference implementation over 1 000 randomised constraint sets (spec 11.1).
 * This is the guard against an intersection bug shipping as quietly wrong
 * answers.
 */

import { buildIndexes, runFilter, runFindNear, haversineKm } from '@/lib/engine';
import type { Catalog, FilterInput, Place, Vocab, VocabTag } from '@/lib/types';
import { CLUSTERS, fold } from '@/lib/types';

/** Deterministic PRNG (mulberry32) so failures reproduce. */
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

const TAG_IDS = Array.from({ length: 60 }, (_, i) => 100 + i);
const TOWNS = ['Marseille', 'Aix-en-Provence', 'Cassis', 'Arles', 'Aubagne'];

function synthCatalog(n: number, seed: number): { catalog: Catalog; vocab: Vocab } {
  const rand = rng(seed);
  const places: Place[] = [];
  for (let i = 0; i < n; i++) {
    const tags = TAG_IDS.filter(() => rand() < 0.15).sort((a, b) => a - b);
    const hasGeo = rand() < 0.9;
    places.push({
      id: i + 1,
      c: Math.floor(rand() * CLUSTERS.length),
      n: `Place ${i + 1}`,
      t: rand() < 0.95 ? Math.floor(rand() * TOWNS.length) : -1,
      lat: hasGeo ? 43 + rand() * 1.2 : null,
      lng: hasGeo ? 4.5 + rand() * 1.8 : null,
      g: rand() < 0.4 ? 1 + Math.floor(rand() * 5) : null,
      tags,
      u: `/les-guides/loisirs/ville/place-${i + 1}`,
      s: '',
    });
  }
  const tags: Record<string, VocabTag> = {};
  for (const id of TAG_IDS) {
    tags[String(id)] = {
      label: `Tag ${id}`,
      n: places.filter((p) => p.tags.includes(id)).length,
      slug: `tag-${id}`,
      source: 'facet',
    };
  }
  return {
    catalog: { version: 1, places },
    vocab: { version: 1, tags, towns: TOWNS },
  };
}

/** Naive reference: full scan, Set membership. */
function referenceFilter(catalog: Catalog, vocab: Vocab, input: FilterInput): number[] {
  const slugToId = new Map(
    Object.entries(vocab.tags).map(([id, t]) => [t.slug, Number(id)]),
  );
  const out: number[] = [];
  catalog.places.forEach((p, i) => {
    if (input.cluster !== undefined) {
      const ci = CLUSTERS.findIndex((c) => c.key === input.cluster);
      if (p.c !== ci) return;
    }
    if (input.town !== undefined) {
      const ti = vocab.towns.findIndex((t) => fold(t) === fold(input.town!));
      if (p.t !== ti) return;
    }
    if (input.minGrade !== undefined && (p.g === null || p.g < input.minGrade)) return;
    if (input.tags) {
      for (const s of input.tags) {
        const id = slugToId.get(s);
        if (id === undefined || !p.tags.includes(id)) return;
      }
    }
    if (input.anyTags && input.anyTags.length > 0) {
      const hit = input.anyTags.some((s) => {
        const id = slugToId.get(s);
        return id !== undefined && p.tags.includes(id);
      });
      if (!hit) return;
    }
    out.push(i);
  });
  return out;
}

describe('runFilter vs reference', () => {
  const { catalog, vocab } = synthCatalog(3000, 42);
  const idx = buildIndexes(catalog, vocab);
  const rand = rng(1337);

  it('agrees on 1000 randomised constraint sets', () => {
    for (let round = 0; round < 1000; round++) {
      const nTags = Math.floor(rand() * 4);
      const nAny = Math.floor(rand() * 3);
      const pick = () => `tag-${TAG_IDS[Math.floor(rand() * TAG_IDS.length)]}`;
      const input: FilterInput = {
        cluster: rand() < 0.4 ? CLUSTERS[Math.floor(rand() * CLUSTERS.length)]!.key : undefined,
        tags: nTags > 0 ? Array.from({ length: nTags }, pick) : undefined,
        anyTags: nAny > 0 ? Array.from({ length: nAny }, pick) : undefined,
        town: rand() < 0.3 ? TOWNS[Math.floor(rand() * TOWNS.length)] : undefined,
        minGrade: rand() < 0.3 ? 1 + Math.floor(rand() * 5) : undefined,
        limit: 40,
        offset: 0,
      };
      const expected = referenceFilter(catalog, vocab, input);
      const got = runFilter(catalog, idx, input);
      expect(got.total).toBe(expected.length);
      expect([...got.indices]).toEqual(expected.slice(0, 40));
    }
  });

  it('paginates consistently', () => {
    const all = referenceFilter(catalog, vocab, { limit: 40, offset: 0 });
    const page2 = runFilter(catalog, idx, { limit: 40, offset: 40 });
    expect([...page2.indices]).toEqual(all.slice(40, 80));
    expect(page2.total).toBe(all.length);
  });

  it('throws a typed error with suggestions on an unknown slug', () => {
    expect(() =>
      runFilter(catalog, idx, { tags: ['tag-1000'], limit: 40, offset: 0 }),
    ).toThrow(/unknown tag slug/);
  });

  it('findNear returns only places within the radius, sorted by distance', () => {
    const center = { lat: 43.5, lng: 5.4 };
    const result = runFindNear(catalog, idx, center, 20, -1, 40);
    let prev = 0;
    for (const item of result.items) {
      const p = catalog.places[item.index]!;
      const d = haversineKm(center.lat, center.lng, p.lat!, p.lng!);
      expect(d).toBeLessThanOrEqual(20.05);
      expect(item.distanceKm).toBeGreaterThanOrEqual(prev);
      prev = item.distanceKm;
    }
    // Reference: brute force count.
    const brute = catalog.places.filter(
      (p) => p.lat !== null && haversineKm(center.lat, center.lng, p.lat, p.lng!) <= 20,
    ).length;
    expect(result.total).toBe(brute);
  });
});

describe('alias resolution', () => {
  it('an alias slug resolves to the canonical postings', () => {
    const { catalog, vocab } = synthCatalog(500, 7);
    const canonical = vocab.tags['100']!;
    const aliased: Vocab = {
      ...vocab,
      tags: {
        ...vocab.tags,
        '100': { ...canonical, aliases: [101] },
      },
    };
    const idx = buildIndexes(catalog, aliased);
    const viaCanonical = runFilter(catalog, idx, { tags: ['tag-100'], limit: 40, offset: 0 });
    const viaAlias = runFilter(catalog, idx, { tags: ['tag-101'], limit: 40, offset: 0 });
    expect(viaAlias.total).toBe(viaCanonical.total);
    expect([...viaAlias.indices]).toEqual([...viaCanonical.indices]);
  });
});
