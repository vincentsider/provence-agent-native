/**
 * Les éclaireurs (v3, issue #612): mission execution against the pure
 * engine, and the verdict/shortlist stores' bounds. The Store is stubbed to
 * its two used capabilities (ScoutEngine) so no window or fetch exists here.
 */

import { buildIndexes, runFilter } from '@/lib/engine';
import { toPublicShape } from '@/lib/public-shape';
import { runMission, ScoutMissionStore, MAX_FINDINGS, MAX_SCOUTS, type ScoutEngine } from '@/lib/scouts';
import { ShortlistStore } from '@/lib/shortlist';
import { ViewportStore } from '@/lib/viewport';
import { CLUSTERS, type Catalog, type FilterInput, type Place, type Vocab } from '@/lib/types';

const AGENDA_IDX = CLUSTERS.findIndex((c) => c.key === 'agenda');

function fixtureEngine(): ScoutEngine {
  const places: Place[] = [
    {
      id: 1, c: 0, n: 'Hôtel du Port', t: 0, lat: 43.21, lng: 5.53, g: 3,
      tags: [469], u: '/les-guides/hebergements/hotels/cassis/hotel-du-port',
      s: 'Face au port', img: null,
    },
    {
      id: 2, c: 0, n: 'Hôtel des Calanques', t: 0, lat: 43.22, lng: 5.54, g: 4,
      tags: [469], u: '/les-guides/hebergements/hotels/cassis/hotel-des-calanques',
      s: 'Vue mer', img: null,
    },
    {
      id: 3, c: AGENDA_IDX, n: 'Marché nocturne de Cassis', t: 0, lat: 43.214, lng: 5.537,
      g: null, tags: [], u: '/agenda/marche/cassis/marche-nocturne',
      s: 'Producteurs locaux', img: null, d1: '2026-09-05', d2: '2026-09-05',
    },
    {
      id: 4, c: AGENDA_IDX, n: 'Fête du vent', t: 1, lat: 43.26, lng: 5.38, g: null,
      tags: [], u: '/agenda/festival/marseille/fete-du-vent',
      s: 'Cerfs-volants', img: null, d1: '2026-09-20', d2: '2026-09-21',
    },
  ];
  const vocab: Vocab = {
    version: 1,
    tags: { '469': { label: 'Parking', n: 2, slug: 'parking', source: 'facet' } },
    towns: ['Cassis', 'Marseille'],
  };
  const catalog: Catalog = { version: 1, places };
  const indexes = buildIndexes(catalog, vocab);
  return {
    peekFilter: (input: FilterInput) => {
      const { total, indices } = runFilter(catalog, indexes, input);
      return { total, indices: [...indices], places: indices.map((i) => catalog.places[i]!) };
    },
    toPublicShape: (p: Place) => toPublicShape(p, vocab, indexes.aliasToCanonical),
    vocab,
  };
}

describe('runMission', () => {
  const today = '2026-09-01';

  it('runs each brief and enriches place findings with the next town event', () => {
    const mission = runMission(
      fixtureEngine(),
      'un village avec un marché, près de la mer',
      [
        { label: 'hôtels à Cassis', town: 'Cassis', cluster: 'hotels' },
        { label: 'marchés', query: 'marché' },
      ],
      today,
    );
    expect(mission.reports).toHaveLength(2);
    const hotels = mission.reports[0]!;
    expect(hotels.findings.map((f) => f.name)).toEqual(['Hôtel du Port', 'Hôtel des Calanques']);
    // Place findings carry the town's next dated event as evidence.
    expect(hotels.findings[0]!.upcoming).toMatchObject({
      name: 'Marché nocturne de Cassis',
      date: '2026-09-05',
    });
    // Event findings carry their own dates and no upcoming.
    const markets = mission.reports[1]!;
    const nocturne = markets.findings.find((f) => f.name === 'Marché nocturne de Cassis')!;
    expect(nocturne.d1).toBe('2026-09-05');
    expect(nocturne.upcoming).toBeNull();
  });

  it('caps scouts and findings and initialises every verdict to pending', () => {
    const briefs = Array.from({ length: 6 }, (_, i) => ({
      label: `angle ${i}`,
      town: 'Cassis' as const,
    }));
    const mission = runMission(fixtureEngine(), 'trop d’angles', briefs, today);
    expect(mission.reports.length).toBeLessThanOrEqual(MAX_SCOUTS);
    for (const r of mission.reports) {
      expect(r.findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
      expect(Object.values(r.verdicts).every((v) => v === 'pending')).toBe(true);
    }
  });
});

describe('runMission dedupe', () => {
  it('never lets two scouts claim the same place', () => {
    const mission = runMission(
      fixtureEngine(),
      'double angle',
      [
        { label: 'hôtels A', town: 'Cassis', cluster: 'hotels' },
        { label: 'hôtels B', tags: ['parking'] }, // same two hotels match
      ],
      '2026-09-01',
    );
    const ids = mission.reports.flatMap((r) => r.findings.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ScoutMissionStore', () => {
  it('records verdicts and rejects unknown finding ids', () => {
    const store = new ScoutMissionStore();
    const mission = runMission(fixtureEngine(), 'test', [{ label: 'a', town: 'Cassis' }, { label: 'b', query: 'vent' }], '2026-09-01');
    store.start(mission);
    expect(store.setVerdict(1, 'kept')).toBe(true);
    expect(store.getSnapshot()!.reports[0]!.verdicts[1]).toBe('kept');
    expect(store.setVerdict(999, 'kept')).toBe(false);
    store.destroy();
  });
});

describe('ShortlistStore', () => {
  it('dedupes, caps at 20 dropping the oldest, and removes', () => {
    const store = new ShortlistStore();
    const item = (id: number) => ({ id, name: `p${id}`, town: 't', url: 'u', d1: null, d2: null });
    for (let i = 1; i <= 22; i++) store.keep(item(i));
    store.keep(item(22)); // duplicate is a no-op
    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(20);
    expect(snapshot[0]!.id).toBe(3);
    store.remove(3);
    expect(store.getSnapshot()).toHaveLength(19);
    store.destroy();
  });
});

describe('ViewportStore', () => {
  it('answers containment only once bounds exist and copies filter arrays', () => {
    const store = new ViewportStore();
    expect(store.contains(43.3, 5.4)).toBe(false);
    store.setBounds({ north: 43.5, south: 43.1, east: 5.6, west: 5.2 }, 11);
    expect(store.contains(43.3, 5.4)).toBe(true);
    expect(store.contains(44.0, 5.4)).toBe(false);
    const tags = ['parking'];
    store.setFilter({ cluster: 'hotels', tags, town: null });
    tags.push('mutated');
    expect(store.getSnapshot().filter.tags).toEqual(['parking']);
    store.destroy();
  });
});
