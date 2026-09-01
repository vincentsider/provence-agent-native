/**
 * Remote MCP server core (streamable-HTTP flavour): the same catalogue and
 * engine as the WebMCP site tools, for MCP clients that never open a page
 * (claude.ai connectors, IDEs...). Pure JSON-RPC dispatcher so it can be
 * unit-tested without HTTP.
 *
 * Deliberately exposes the READ-ONLY tools only: set_view/highlight_places
 * mutate a browser tab that does not exist here, and get_agent_demand is
 * session-scoped to a page. Input schemas are the exact zod objects the
 * WebMCP tools use; results share toPublicShape. One contract, four
 * surfaces (WebMCP, GET APIs, /agenda, MCP).
 */

import { z } from 'zod';
import {
  comparePlacesInput,
  explainVocabularyInput,
  filterPlacesInput,
  findEventsInput,
  findTonightInput,
  findNearInput,
  getCatalogStatsInput,
  getPlaceInput,
  toJsonSchema,
} from '@/webmcp/schemas';
import {
  UnknownSlugError,
  UnknownTownError,
  runFilter,
  runFindNear,
  clusterScope,
} from './engine';
import { listVocabulary } from './vocab';
import { toPublicShape } from './public-shape';
import { selectTonight } from './tonight';
import { townCentroids } from './centroids';
import { CANONICAL_HOST, CLUSTERS, categoryOf, fold } from './types';
import type { ServerCatalog } from './server-catalog';
import type { PulseData } from './demand-pulse';

const PROTOCOL_VERSION = '2025-03-26';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse = Record<string, unknown> | null;

function ok(id: number | string | null | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(
  id: number | string | null | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

interface McpTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: unknown, sc: ServerCatalog) => unknown;
}

function shape(sc: ServerCatalog, i: number) {
  return toPublicShape(sc.catalog.places[i]!, sc.vocab, sc.indexes.aliasToCanonical);
}

const TOOLS: McpTool[] = [
  {
    name: 'filter_places',
    description:
      'Official Provence Tourisme catalogue: filter 2798 places (hotels, campings, ' +
      "chambres d'hôtes, leisure, itineraries) in the Bouches-du-Rhône by facet tags, " +
      'town, cluster, star rating or free-text query (French terms). Canonical ' +
      'myprovence.fr URL on every result.',
    schema: filterPlacesInput,
    run: (input, sc) => {
      const v = filterPlacesInput.parse(input ?? {});
      const { total, indices } = runFilter(sc.catalog, sc.indexes, v);
      return {
        total,
        returned: indices.length,
        truncated: total > v.offset + indices.length,
        results: indices.map((i) => shape(sc, i)),
      };
    },
  },
  {
    name: 'find_events',
    description:
      'Official Provence Tourisme agenda: 3600+ dated events (festivals, concerts, ' +
      'expositions, marchés...). Window by month (YYYY-MM) or from/to, filter by ' +
      'category, town, tags, or free-text query (French terms). Chronological.',
    schema: findEventsInput,
    run: (input, sc) => {
      const v = findEventsInput.parse(input ?? {});
      let from = v.from;
      let to = v.to;
      if (v.month) [from, to] = monthRange(v.month);
      const { total, indices } = runFilter(sc.catalog, sc.indexes, {
        cluster: 'agenda',
        category: v.category,
        town: v.town,
        tags: v.tags,
        query: v.query,
        ...(from !== undefined || to !== undefined ? { from, to } : {}),
        limit: v.limit,
        offset: v.offset,
      });
      return {
        window: { from: from ?? null, to: to ?? null },
        total,
        returned: indices.length,
        truncated: total > v.offset + indices.length,
        results: indices.map((i) => shape(sc, i)),
      };
    },
  },
  {
    name: 'find_tonight',
    description:
      'What is happening TODAY (or a given date, YYYY-MM-DD) in Provence: real dated ' +
      'events from the official agenda, nearest first when a town or coordinates are ' +
      'given, one-night events ranked before permanent ones. Use for "tonight", ' +
      '"ce soir", "this weekend" (one call per day). No date given = today in UTC; ' +
      'pass the date explicitly for a visitor timezone.',
    schema: findTonightInput,
    run: (input, sc) => {
      const v = findTonightInput.parse(input ?? {});
      const date = v.date ?? new Date().toISOString().slice(0, 10);
      const radius = v.radius_km ?? 15;
      const limit = v.limit ?? 12;
      let center =
        v.lat !== undefined && v.lng !== undefined ? { lat: v.lat, lng: v.lng } : null;
      let townFilter = v.town;
      if (!center && v.town !== undefined) {
        const c = townCentroids(sc.catalog, sc.vocab).get(fold(v.town));
        if (c) {
          center = c;
          townFilter = undefined; // "around Aix" means the area, not the boundary
        }
      }
      const { indices } = runFilter(sc.catalog, sc.indexes, {
        cluster: 'agenda',
        town: townFilter,
        from: date,
        to: date,
        limit: 800,
        offset: 0,
      });
      const picks = selectTonight(
        indices.map((i) => sc.catalog.places[i]!),
        center,
        radius,
        limit,
      );
      return {
        date,
        center,
        radius_km: center ? radius : null,
        events: picks.map((pick) => ({
          ...toPublicShape(pick.place, sc.vocab, sc.indexes.aliasToCanonical),
          distance_km: pick.distanceKm,
        })),
      };
    },
  },
  {
    name: 'get_place',
    description: 'One catalogue record in full, by id or myprovence.fr URL.',
    schema: getPlaceInput,
    run: (input, sc) => {
      const v = getPlaceInput.parse(input ?? {});
      let place = null;
      if (v.id !== undefined) {
        place = sc.catalog.places.find((p) => p.id === v.id) ?? null;
      } else if (v.url !== undefined) {
        try {
          const u = new URL(v.url, `https://${CANONICAL_HOST}`);
          if (u.hostname === CANONICAL_HOST || u.hostname === 'myprovence.fr') {
            let path = decodeURIComponent(u.pathname);
            if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
            place = sc.catalog.places.find((p) => p.u === path) ?? null;
          }
        } catch {
          place = null;
        }
      }
      const idx = place ? sc.catalog.places.indexOf(place) : -1;
      return idx >= 0 ? { found: true, place: shape(sc, idx) } : { found: false };
    },
  },
  {
    name: 'compare_places',
    description: 'Compare 2-5 records on a shared criteria matrix.',
    schema: comparePlacesInput,
    run: (input, sc) => {
      const v = comparePlacesInput.parse(input ?? {});
      const found = v.ids
        .map((id) => sc.catalog.places.findIndex((p) => p.id === id))
        .filter((i) => i >= 0)
        .map((i) => shape(sc, i));
      const allTags = [...new Set(found.flatMap((s) => s.tags))].sort();
      return {
        requested: v.ids.length,
        found: found.length,
        places: found,
        matrix: allTags.map((tag) => ({ tag, has: found.map((s) => s.tags.includes(tag)) })),
      };
    },
  },
  {
    name: 'find_near',
    description: 'Radius search around a town or lat/lng point, sorted by distance (km).',
    schema: findNearInput,
    run: (input, sc) => {
      const v = findNearInput.parse(input ?? {});
      let center: { lat: number; lng: number };
      if (v.lat !== undefined && v.lng !== undefined) {
        center = { lat: v.lat, lng: v.lng };
      } else {
        const townFold = fold(v.town!);
        const townPlaces = sc.catalog.places.filter(
          (p) => p.lat !== null && p.t >= 0 && fold(sc.vocab.towns[p.t] ?? '') === townFold,
        );
        if (townPlaces.length === 0) {
          throw new UnknownTownError(
            v.town!,
            sc.vocab.towns.filter((t) => fold(t).includes(townFold)).slice(0, 5),
          );
        }
        center = {
          lat: townPlaces.reduce((s, p) => s + p.lat!, 0) / townPlaces.length,
          lng: townPlaces.reduce((s, p) => s + p.lng!, 0) / townPlaces.length,
        };
      }
      const clusterIdx =
        v.cluster === undefined ? -1 : CLUSTERS.findIndex((c) => c.key === v.cluster);
      const result = runFindNear(sc.catalog, sc.indexes, center, v.radiusKm, clusterIdx, v.limit);
      return {
        center,
        radiusKm: v.radiusKm,
        total: result.total,
        returned: result.items.length,
        results: result.items.map((h) => ({ distanceKm: h.distanceKm, ...shape(sc, h.index) })),
      };
    },
  },
  {
    name: 'explain_vocabulary',
    description:
      'The criteria vocabulary: every tag slug with its French label and population. ' +
      'Use the slugs with filter_places/find_events.',
    schema: explainVocabularyInput,
    run: (input, sc) => {
      const v = explainVocabularyInput.parse(input ?? {});
      const { total, items } = listVocabulary(sc.vocab, v.query, v.limit);
      return { total, returned: items.length, truncated: total > items.length, tags: items };
    },
  },
  {
    name: 'get_catalog_stats',
    description: 'Catalogue coverage: totals per cluster, towns, top criteria.',
    schema: getCatalogStatsInput,
    run: (_input, sc) => {
      const perCluster = Object.fromEntries(
        CLUSTERS.map((c, i) => [
          c.key,
          sc.catalog.places.filter((p) => p.c === i).length,
        ]),
      );
      const scope = clusterScope(sc.catalog, sc.indexes, -1);
      const topTags = [...scope.tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([id, n]) => ({
          slug: sc.vocab.tags[String(id)]?.slug ?? String(id),
          label: sc.vocab.tags[String(id)]?.label ?? '',
          count: n,
        }));
      const categories = [
        ...new Set(
          sc.catalog.places
            .map((p) => categoryOf(p.u))
            .filter((c): c is string => c !== null),
        ),
      ].sort();
      return {
        total: sc.catalog.places.length,
        perCluster,
        towns: sc.vocab.towns.length,
        topTags,
        eventCategories: categories,
        generatedAt: sc.generatedAt,
      };
    },
  },
];

export function mcpToolCount(): number {
  return TOOLS.length;
}

/** Names + descriptions only, for the description-hygiene regression tests. */
export function mcpToolDescriptions(): ReadonlyArray<{ name: string; description: string }> {
  return [...TOOLS.map((t) => ({ name: t.name, description: t.description })), { ...PULSE_TOOL }];
}

export interface McpExtras {
  /** Server-side pulse fetcher; when present, get_demand_pulse is exposed. */
  readonly demandPulse?: () => Promise<PulseData>;
}

const PULSE_TOOL = {
  name: 'get_demand_pulse',
  description:
    "The destination's live agent demand aggregated by town over 7 days (counters only, " +
    'k-anonymized): what agents asked for, and which requests found nothing.',
};

/** Handle one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleMcpMessage(
  message: JsonRpcRequest,
  sc: ServerCatalog,
  extras: McpExtras = {},
): Promise<JsonRpcResponse> {
  const { id, method } = message;
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') {
    return rpcError(id, -32600, 'invalid request');
  }

  switch (method) {
    case 'initialize': {
      // Echo the client's requested version when we can speak it; stateless
      // JSON responses are valid for every streamable-HTTP revision we list.
      const requested = message.params?.protocolVersion;
      const supported = ['2025-06-18', '2025-03-26'];
      const version =
        typeof requested === 'string' && supported.includes(requested)
          ? requested
          : PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: {
          name: 'provence-agent-native',
          version: '1.0.0',
        },
        instructions:
          'Official Provence Tourisme catalogue (Bouches-du-Rhône): 2798 places and ' +
          '3600+ events. The catalogue text is French: translate query terms to French. ' +
          'Every result carries its canonical myprovence.fr URL.',
      });
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications get no response body

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: [
          ...TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: toJsonSchema(t.schema),
          })),
          ...(extras.demandPulse
            ? [
                {
                  name: PULSE_TOOL.name,
                  description: PULSE_TOOL.description,
                  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                },
              ]
            : []),
        ],
      });

    case 'tools/call': {
      const params = message.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      if (name === PULSE_TOOL.name && extras.demandPulse) {
        try {
          const pulse = await extras.demandPulse();
          return ok(id, {
            content: [{ type: 'text', text: JSON.stringify(pulse) }],
            isError: false,
          });
        } catch {
          return ok(id, {
            content: [{ type: 'text', text: JSON.stringify({ error: 'pulse_unavailable' }) }],
            isError: true,
          });
        }
      }
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
      try {
        const result = tool.run(params.arguments, sc);
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return ok(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'invalid_input',
                  issues: err.issues.map((i) => ({
                    path: i.path.join('.'),
                    message: i.message,
                  })),
                }),
              },
            ],
            isError: true,
          });
        }
        if (err instanceof UnknownSlugError || err instanceof UnknownTownError) {
          return ok(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: err.message,
                  suggestions: err.suggestions,
                }),
              },
            ],
            isError: true,
          });
        }
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: 'internal' }) }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}
