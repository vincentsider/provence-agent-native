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

const HUB_CLUSTER_COUNT = CLUSTERS.filter((c) => c.hubPath !== null).length;
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
      // Guides fixtures live only in hub clusters, like real guides records:
      // the sixth cluster (agenda) is reserved for dated event fixtures.
      c: Math.floor(rand() * HUB_CLUSTER_COUNT),
      n: `Place ${i + 1}`,
      t: rand() < 0.95 ? Math.floor(rand() * TOWNS.length) : -1,
      lat: hasGeo ? 43 + rand() * 1.2 : null,
      lng: hasGeo ? 4.5 + rand() * 1.8 : null,
      g: rand() < 0.4 ? 1 + Math.floor(rand() * 5) : null,
      tags,
      u: `/les-guides/loisirs/ville/place-${i + 1}`,
      s: '',
      img: null,
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

describe('date-overlap filtering (events)', () => {
  // Synthetic agenda records appended after the guides fixture, exactly as
  // the Store merges the events artefact behind the catalogue.
  const base = synthCatalog(300, 11);
  const AGENDA_IDX = CLUSTERS.findIndex((c) => c.key === 'agenda');
  const rand = rng(77);
  const events: Place[] = Array.from({ length: 400 }, (_, i) => {
    const m = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 27);
    const undated = rand() < 0.15;
    const spanDays = rand() < 0.4 ? Math.floor(rand() * 40) : 0;
    const d1 = undated ? null : `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let d2: string | null = null;
    if (d1 && spanDays > 0) {
      const end = new Date(`${d1}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + spanDays);
      d2 = end.toISOString().slice(0, 10);
    }
    return {
      id: 100000 + i,
      c: AGENDA_IDX,
      n: `Event ${i}`,
      t: Math.floor(rand() * TOWNS.length),
      lat: null,
      lng: null,
      g: null,
      tags: [],
      u: `/agenda/${i % 2 ? 'concert' : 'marche'}/ville/event-${i}`,
      s: '',
      img: null,
      d1,
      d2,
    };
  });
  const catalog: Catalog = { version: 1, places: [...base.catalog.places, ...events] };
  const idx = buildIndexes(catalog, base.vocab);

  const overlaps = (p: Place, from: string, to: string) => {
    if (p.d1 === undefined || p.d1 === null) return false;
    const end = p.d2 ?? p.d1;
    return !(end < from || p.d1 > to);
  };

  it('matches the naive overlap reference for October 2026, sorted by start', () => {
    const from = '2026-10-01';
    const to = '2026-10-31';
    const expected = catalog.places
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.c === AGENDA_IDX && overlaps(p, from, to))
      .sort((a, b) => {
        const da = a.p.d1 ?? '';
        const db = b.p.d1 ?? '';
        return da < db ? -1 : da > db ? 1 : a.i - b.i;
      })
      .map(({ i }) => i);
    const got = runFilter(catalog, idx, {
      cluster: 'agenda',
      from,
      to,
      limit: 500,
      offset: 0,
    });
    expect(got.total).toBe(expected.length);
    expect([...got.indices]).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('a spanning event matches a window inside its range', () => {
    const spanning = catalog.places.findIndex(
      (p) => p.d1 && p.d2 && p.d1 < '2026-06-01' && p.d2 > '2026-06-30',
    );
    if (spanning >= 0) {
      const got = runFilter(catalog, idx, {
        cluster: 'agenda',
        from: '2026-06-10',
        to: '2026-06-12',
        limit: 500,
        offset: 0,
      });
      expect([...got.indices]).toContain(spanning);
    }
  });

  it('undated records never match a dated query but appear in open browse', () => {
    const dated = runFilter(catalog, idx, {
      cluster: 'agenda', from: '2026-01-01', to: '2026-12-31', limit: 500, offset: 0,
    });
    const open = runFilter(catalog, idx, { cluster: 'agenda', limit: 500, offset: 0 });
    const undatedCount = events.filter((e) => e.d1 === null).length;
    expect(open.total - dated.total).toBe(undatedCount);
  });

  it('category narrows by URL segment', () => {
    const got = runFilter(catalog, idx, {
      cluster: 'agenda', category: 'concert', limit: 500, offset: 0,
    });
    const expected = catalog.places.filter(
      (p) => p.c === AGENDA_IDX && p.u.startsWith('/agenda/concert/'),
    ).length;
    expect(got.total).toBe(expected);
  });
});

describe('free-text query search', () => {
  const { catalog, vocab } = synthCatalog(500, 21);
  // Give a few records distinctive names/summaries.
  const places: Place[] = catalog.places.map((p, i) =>
    i === 42
      ? { ...p, n: 'Street Food Festival 2026', s: 'Cuisine du monde au parc' }
      : i === 77
        ? { ...p, n: 'Marché nocturne', s: 'food trucks et créateurs' }
        : p,
  );
  const cat2: Catalog = { version: 1, places };
  const idx = buildIndexes(cat2, vocab);

  it('finds records by name, accent- and case-insensitively', () => {
    const got = runFilter(cat2, idx, { query: 'STREET food', limit: 40, offset: 0 });
    expect([...got.indices]).toContain(42);
    expect([...got.indices]).not.toContain(77); // has food but not street
  });

  it('matches across name AND summary (all terms must hit)', () => {
    const got = runFilter(cat2, idx, { query: 'food trucks', limit: 40, offset: 0 });
    expect([...got.indices]).toContain(77);
    expect([...got.indices]).not.toContain(42);
  });

  it('folds accents: marche matches Marché', () => {
    const got = runFilter(cat2, idx, { query: 'marche nocturne', limit: 40, offset: 0 });
    expect([...got.indices]).toContain(77);
  });

  it('combines with other constraints', () => {
    const p42 = places[42]!;
    const got = runFilter(cat2, idx, {
      query: 'festival',
      cluster: CLUSTERS[p42.c]!.key,
      limit: 40,
      offset: 0,
    });
    expect([...got.indices]).toContain(42);
  });
});

describe('alias resolution', () => {
  it('canonical and alias slugs both search the UNION of both ids', () => {
    // Real-world shape: the same criterion lives under two term ids on
    // different surfaces (463 "Animaux acceptés" vs 20813 "Acceptés"), so a
    // redirect-only alias silently misses whole clusters. Union is required.
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
    const expectedUnion = catalog.places
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.tags.includes(100) || p.tags.includes(101))
      .map(({ i }) => i);
    const viaCanonical = runFilter(catalog, idx, { tags: ['tag-100'], limit: 500, offset: 0 });
    const viaAlias = runFilter(catalog, idx, { tags: ['tag-101'], limit: 500, offset: 0 });
    expect(viaCanonical.total).toBe(expectedUnion.length);
    expect([...viaCanonical.indices]).toEqual(expectedUnion);
    expect([...viaAlias.indices]).toEqual(expectedUnion);
  });
});
