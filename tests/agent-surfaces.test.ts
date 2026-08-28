/**
 * The fetch-only agent surfaces: URL-param parsing and the pure MCP
 * dispatcher, exercised against a synthetic ServerCatalog. These exist
 * because of the 28 Aug field failure: claude.ai fetched the SPA shell,
 * found no data, guessed /fr/agenda, and fell back to Wikipedia.
 */

import { parseEventsParams, parsePlacesParams } from '@/lib/api-params';
import { handleMcpMessage, mcpToolCount } from '@/lib/mcp-server';
import { buildIndexes } from '@/lib/engine';
import type { ServerCatalog } from '@/lib/server-catalog';
import type { Catalog, Place, Vocab } from '@/lib/types';
import { CLUSTERS } from '@/lib/types';

const AGENDA_IDX = CLUSTERS.findIndex((c) => c.key === 'agenda');

function sc(): ServerCatalog {
  const places: Place[] = [
    {
      id: 1, c: 0, n: 'Hôtel Paul', t: 0, lat: 43.5, lng: 5.4, g: 2,
      tags: [469], u: '/les-guides/hebergements/hotels/aix-en-provence/hotel-paul',
      s: 'Petit hôtel avec parking', img: null,
    },
    {
      id: 2, c: AGENDA_IDX, n: 'Street Food Festival 2026', t: 1, lat: null, lng: null,
      g: null, tags: [], u: '/agenda/festival/marseille/street-food-festival-2026',
      s: 'Cuisines du monde', img: null, d1: '2026-09-10', d2: '2026-09-12',
    },
  ];
  const vocab: Vocab = {
    version: 1,
    tags: { '469': { label: 'Parking', n: 1, slug: 'parking', source: 'facet' } },
    towns: ['Aix-en-Provence', 'Marseille'],
  };
  const catalog: Catalog = { version: 1, places };
  return { catalog, vocab, indexes: buildIndexes(catalog, vocab), generatedAt: '2026-08-28T00:00:00Z' };
}

describe('parseEventsParams', () => {
  it('accepts the shapes agents will send', () => {
    const r = parseEventsParams(new URLSearchParams('month=2026-10&limit=5'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.month).toBe('2026-10');
  });
  it('rejects unknown parameters by name', () => {
    const r = parseEventsParams(new URLSearchParams('month=2026-10&evil=1'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('evil');
  });
  it('collects repeated tag params', () => {
    const r = parseEventsParams(new URLSearchParams('tag=a&tag=b'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual(['a', 'b']);
  });
  it('rejects calendar-invalid months', () => {
    expect(parseEventsParams(new URLSearchParams('month=2026-13')).ok).toBe(false);
  });
});

describe('parsePlacesParams', () => {
  it('parses cluster, tags and numeric bounds', () => {
    const r = parsePlacesParams(
      new URLSearchParams('cluster=hotels&tag=parking&minGrade=3&limit=10'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cluster).toBe('hotels');
      expect(r.value.minGrade).toBe(3);
    }
  });
  it('rejects a non-numeric limit instead of coercing to default', () => {
    expect(parsePlacesParams(new URLSearchParams('limit=abc')).ok).toBe(false);
  });
});

describe('handleMcpMessage', () => {
  const catalog = sc();

  it('initialize returns protocol, capabilities and French-catalogue instructions', async () => {
    const r = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, catalog)) as {
      result: { protocolVersion: string; instructions: string };
    };
    expect(r.result.protocolVersion).toBeTruthy();
    expect(r.result.instructions).toContain('French');
  });

  it('notifications get no reply', async () => {
    await expect(
      handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, catalog),
    ).resolves.toBeNull();
  });

  it('tools/list exposes the read-only tools with strict schemas', async () => {
    const r = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, catalog)) as {
      result: { tools: Array<{ name: string; inputSchema: { additionalProperties?: boolean } }> };
    };
    expect(r.result.tools).toHaveLength(mcpToolCount());
    const names = r.result.tools.map((t) => t.name);
    expect(names).toContain('find_events');
    expect(names).not.toContain('set_view'); // page-state tools stay on the page
    expect(names).not.toContain('get_agent_demand');
    for (const t of r.result.tools) expect(t.inputSchema.additionalProperties).toBe(false);
  });

  it('tools/call find_events finds the festival by query', async () => {
    const r = (await handleMcpMessage(
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'find_events', arguments: { query: 'street food' } },
      },
      catalog,
    )) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(r.result.isError).toBe(false);
    const data = JSON.parse(r.result.content[0]!.text) as {
      total: number; results: Array<{ name: string; url: string; startDate: string }>;
    };
    expect(data.total).toBe(1);
    expect(data.results[0]!.name).toBe('Street Food Festival 2026');
    expect(data.results[0]!.url).toContain('myprovence.fr/agenda/festival');
    expect(data.results[0]!.startDate).toBe('2026-09-10');
  });

  it('tools/call with invalid input answers isError content, never a crash', async () => {
    const r = (await handleMcpMessage(
      {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'find_events', arguments: { month: 'octobre' } },
      },
      catalog,
    )) as { result: { isError: boolean } };
    expect(r.result.isError).toBe(true);
  });

  it('unknown tool and unknown method return JSON-RPC errors', async () => {
    const a = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
      catalog,
    )) as { error: { code: number } };
    expect(a.error.code).toBe(-32602);
    const b = (await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'wat' }, catalog)) as {
      error: { code: number };
    };
    expect(b.error.code).toBe(-32601);
  });
});

describe('pickDataOrigin (Host-spoof defence)', () => {
  const { pickDataOrigin } = require('@/lib/server-catalog') as {
    pickDataOrigin: (o: string, env?: Record<string, string | undefined>) => string;
  };
  const env = { VERCEL_PROJECT_PRODUCTION_URL: 'provence-agent-native.vercel.app' };

  it('honours a request origin that matches the deployment', () => {
    expect(pickDataOrigin('https://provence-agent-native.vercel.app', env)).toBe(
      'https://provence-agent-native.vercel.app',
    );
  });

  it('NEVER follows a spoofed Host: falls back to the pinned origin', () => {
    expect(pickDataOrigin('https://evil.example', env)).toBe(
      'https://provence-agent-native.vercel.app',
    );
    expect(pickDataOrigin('http://127.0.0.1:9999', env)).toBe(
      'https://provence-agent-native.vercel.app',
    );
  });

  it('local dev origins stay usable without any env', () => {
    expect(pickDataOrigin('http://127.0.0.1:3040', {})).toBe('http://127.0.0.1:3040');
  });

  it('an explicit NEXT_PUBLIC_SITE_ORIGIN wins the fallback order', () => {
    expect(
      pickDataOrigin('https://evil.example', {
        NEXT_PUBLIC_SITE_ORIGIN: 'https://webmcp.myprovence.fr',
        VERCEL_URL: 'x.vercel.app',
      }),
    ).toBe('https://webmcp.myprovence.fr');
  });
});

describe('MCP protocol version negotiation', () => {
  const catalog = ((): import('@/lib/server-catalog').ServerCatalog => {
    const places = [] as never[];
    const vocab = { version: 1 as const, tags: {}, towns: [] };
    const cat = { version: 1 as const, places };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildIndexes } = require('@/lib/engine');
    return { catalog: cat, vocab, indexes: buildIndexes(cat, vocab), generatedAt: 'x' };
  })();

  it('echoes a supported requested version', async () => {
    const r = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      catalog,
    )) as { result: { protocolVersion: string } };
    expect(r.result.protocolVersion).toBe('2025-06-18');
  });

  it('falls back to our default on an unknown version', async () => {
    const r = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      catalog,
    )) as { result: { protocolVersion: string } };
    expect(r.result.protocolVersion).toBe('2025-03-26');
  });
});

describe('selectUpcoming (landing-page strip)', () => {
  const { selectUpcoming } = require('@/lib/build-data') as {
    selectUpcoming: typeof import('@/lib/build-data').selectUpcoming;
  };
  const AGENDA = CLUSTERS.findIndex((c) => c.key === 'agenda');
  const vocab = { version: 1 as const, tags: {}, towns: ['Marseille'] };
  const mk = (id: number, d1: string | null, c = AGENDA): Place => ({
    id, c, n: `E${id}`, t: 0, lat: null, lng: null, g: null, tags: [],
    u: `/agenda/festival/marseille/e${id}`, s: '', img: null, d1, d2: null,
  });

  it('keeps only agenda events starting on/after today, soonest first, id tiebreak', () => {
    const events = [mk(5, '2026-09-01'), mk(2, '2026-08-30'), mk(9, '2026-08-30'),
      mk(3, '2026-08-01'), mk(4, null), mk(7, '2026-09-01', 0)];
    const out = selectUpcoming(events, vocab, '2026-08-28', 10);
    expect(out.map((e) => e.name)).toEqual(['E2', 'E9', 'E5']);
    expect(out[0]!.category).toBe('festival');
    expect(out[0]!.town).toBe('Marseille');
  });

  it('respects the limit', () => {
    const events = Array.from({ length: 30 }, (_, i) => mk(i + 1, '2026-09-15'));
    expect(selectUpcoming(events, vocab, '2026-08-28', 12)).toHaveLength(12);
  });
});
