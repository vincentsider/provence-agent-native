/**
 * find_tonight ranking (audit pass 7): permanent events must not drown the
 * one-night ones, the radius must brake, and both surfaces (page tool +
 * remote MCP) share this exact ranker.
 */

import { selectTonight } from '@/lib/tonight';
import { handleMcpMessage } from '@/lib/mcp-server';
import { buildIndexes } from '@/lib/engine';
import type { ServerCatalog } from '@/lib/server-catalog';
import { CLUSTERS, type Catalog, type Place, type Vocab } from '@/lib/types';

const AGENDA_IDX = CLUSTERS.findIndex((c) => c.key === 'agenda');

function event(id: number, name: string, d1: string, d2: string, lat: number | null, lng: number | null): Place {
  return {
    id, c: AGENDA_IDX, n: name, t: 0, lat, lng, g: null, tags: [],
    u: `/agenda/festival/marseille/e${id}`, s: '', img: null, d1, d2,
  };
}

const PERMANENT = event(1, 'Exposition permanente', '2026-01-01', '2026-12-31', 43.30, 5.37);
const CONCERT = event(2, 'Concert du soir', '2026-08-29', '2026-08-29', 43.31, 5.38);
const FESTIVAL = event(3, 'Festival trois jours', '2026-08-28', '2026-08-30', 43.29, 5.36);
const FARAWAY = event(4, 'Concert lointain', '2026-08-29', '2026-08-29', 44.05, 6.20);
const NO_GEO = event(5, 'Sans coordonnées', '2026-08-29', '2026-08-29', null, null);

describe('selectTonight', () => {
  it('without a center, one-night events outrank permanent ones', () => {
    const picks = selectTonight([PERMANENT, CONCERT, FESTIVAL], null, 15, 10);
    expect(picks.map((p) => p.place.n)).toEqual([
      'Concert du soir',
      'Festival trois jours',
      'Exposition permanente',
    ]);
    expect(picks[0]!.distanceKm).toBeNull();
  });

  it('with a center, distance rules and the radius brakes — for GPS-less events too', () => {
    const center = { lat: 43.3, lng: 5.37 };
    const picks = selectTonight([FARAWAY, CONCERT, PERMANENT, NO_GEO], center, 15, 10);
    // FARAWAY (~100km) is out; nearest first; a coordinate-less event with
    // no resolvable town is OUT too (field bug 1 Sep: GPS-less expos from
    // 70km away answered "tonight near Marseille").
    expect(picks.map((p) => p.place.n)).toEqual([
      'Exposition permanente',
      'Concert du soir',
    ]);
    expect(picks[0]!.distanceKm).toBe(0);
  });

  it('a GPS-less event rides its town centroid: in-radius stays, far drops', () => {
    const center = { lat: 43.3, lng: 5.37 };
    const near = { lat: 43.31, lng: 5.38 };
    const far = { lat: 44.05, lng: 6.2 };
    const inTown = selectTonight([NO_GEO], center, 15, 10, () => near);
    expect(inTown).toHaveLength(1);
    expect(inTown[0]!.distanceKm).not.toBeNull();
    const outTown = selectTonight([NO_GEO], center, 15, 10, () => far);
    expect(outTown).toHaveLength(0);
  });

  it('caps at limit', () => {
    expect(selectTonight([PERMANENT, CONCERT, FESTIVAL], null, 15, 2)).toHaveLength(2);
  });
});

describe('remote MCP find_tonight', () => {
  function sc(): ServerCatalog {
    const vocab: Vocab = { version: 1, tags: {}, towns: ['Marseille'] };
    const catalog: Catalog = { version: 1, places: [PERMANENT, CONCERT, FESTIVAL, FARAWAY] };
    return { catalog, vocab, indexes: buildIndexes(catalog, vocab), generatedAt: 'x' };
  }

  it('answers the given date with the shared ranking', async () => {
    const reply = (await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'find_tonight', arguments: { date: '2026-08-29' } },
      },
      sc(),
    )) as { result: { content: Array<{ text: string }> } };
    const data = JSON.parse(reply.result.content[0]!.text) as {
      date: string;
      events: Array<{ name: string }>;
    };
    expect(data.date).toBe('2026-08-29');
    expect(data.events[0]!.name).toBe('Concert du soir');
    expect(data.events.map((e) => e.name)).toContain('Exposition permanente');
  });
});

describe('remote MCP find_tonight around a town (centroid semantics)', () => {
  function sc2(): ServerCatalog {
    const vocab: Vocab = { version: 1, tags: {}, towns: ['Marseille'] };
    // NOTE: the shared event() helper gives every record town index 0, so
    // FARAWAY drags the centroid north-east (~27 km from the coast trio,
    // ~80 km from FARAWAY itself). The radius below splits those two.
    const anchor = event(9, 'Ancre', '2026-01-01', '2026-12-31', 43.30, 5.37);
    const catalog: Catalog = { version: 1, places: [anchor, PERMANENT, CONCERT, FARAWAY] };
    return { catalog, vocab, indexes: buildIndexes(catalog, vocab), generatedAt: 'x' };
  }

  it('town + radius means "the area around", distance-sorted, far events excluded', async () => {
    const reply = (await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'find_tonight',
          arguments: { date: '2026-08-29', town: 'marseille', radius_km: 35 },
        },
      },
      sc2(),
    )) as { result: { content: Array<{ text: string }> } };
    const data = JSON.parse(reply.result.content[0]!.text) as {
      center: { lat: number } | null;
      events: Array<{ name: string; distance_km: number | null }>;
    };
    expect(data.center).not.toBeNull();
    const names = data.events.map((e) => e.name);
    expect(names).toContain('Concert du soir');
    expect(names).not.toContain('Concert lointain');
    expect(data.events[0]!.distance_km).not.toBeNull();
  });
});
