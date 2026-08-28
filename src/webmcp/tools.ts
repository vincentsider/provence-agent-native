/**
 * The nine WebMCP site tools (issue #602, spec section 6).
 *
 * Contracts that are easy to get wrong:
 *  - Registration is synchronous with module evaluation and does NOT await
 *    the catalogue: an agent that lands and calls getTools() immediately must
 *    see the complete list, or it falls back to scraping and never re-checks.
 *  - signal.throwIfAborted() sits either side of every await, so an abandoned
 *    call stops working instead of mutating the view late.
 *  - Results state `truncated` explicitly. Silent truncation reads to an
 *    agent as "that is all of them", which is the failure mode we are fixing.
 *  - Every result leaves through envelope(); free text is labelled untrusted.
 *  - execute never throws raw errors (information leak): unexpected failures
 *    return a typed 'internal' error. Aborts re-throw, as the spec expects.
 */

import { errorEnvelope, envelope } from '@/lib/envelope';
import { getDemandLog } from '@/lib/demand';
import { UnknownSlugError, UnknownTownError } from '@/lib/engine';
import { getStore, type Store } from '@/lib/store';
import { CLUSTERS, categoryOf, fold } from '@/lib/types';
import { listVocabulary } from '@/lib/vocab';
import { patchWebMcpStatus, recordRegistration } from './status';
import {
  comparePlacesInput,
  findEventsInput,
  explainVocabularyInput,
  filterPlacesInput,
  findNearInput,
  getAgentDemandInput,
  getCatalogStatsInput,
  getPlaceInput,
  highlightPlacesInput,
  setViewInput,
  toJsonSchema,
} from './schemas';
import type { z } from 'zod';

type Handler<S extends z.ZodType> = (
  input: z.output<S>,
  store: Store,
  signal: AbortSignal,
) => { data: unknown; total: number | null };

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

let neverAbortedSignal: AbortSignal | null = null;
/** Stand-in when the browser omits the options bag (Chrome 151 DevTrial). */
function neverAborted(): AbortSignal {
  if (!neverAbortedSignal) neverAbortedSignal = new AbortController().signal;
  return neverAbortedSignal;
}

function makeExecute<S extends z.ZodType>(
  name: string,
  schema: S,
  handler: Handler<S>,
): (raw: unknown, options?: { signal?: AbortSignal }) => Promise<string> {
  // Interop note (measured on Chrome 151, DevTrial): the browser may invoke
  // execute WITHOUT the options bag, and may hand the input over as a JSON
  // string rather than an object. Both are normalised here; the spec shape
  // (object input, {signal}) is handled identically.
  return async (raw, options) => {
    const signal = options?.signal;
    const t0 = performance.now();
    try {
      signal?.throwIfAborted();
      const store = getStore();
      await store.ready;
      signal?.throwIfAborted();

      if (typeof raw === 'string') {
        try {
          raw = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
        } catch {
          return errorEnvelope({
            code: 'invalid_input',
            message: 'Input was a string but not valid JSON.',
          });
        }
      }

      if (!store.isReady) {
        return errorEnvelope({
          code: 'catalogue_unavailable',
          message: 'The catalogue failed to load in this session.',
        });
      }

      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) {
        return errorEnvelope({
          code: 'invalid_input',
          message: 'Input did not match the tool schema.',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const { data, total } = handler(parsed.data, store, signal ?? neverAborted());
      getDemandLog().record(
        name,
        parsed.data as Record<string, unknown>,
        total,
        performance.now() - t0,
      );
      return envelope(data);
    } catch (err) {
      if (isAbort(err)) throw err;
      if (err instanceof UnknownSlugError) {
        getDemandLog().record(name, { badSlug: err.slug }, 0, performance.now() - t0);
        return errorEnvelope({
          code: 'unknown_tag',
          message: `No tag has the slug "${err.slug}". Nearest valid slugs are listed; call explain_vocabulary for the full table.`,
          suggestions: err.suggestions,
        });
      }
      if (err instanceof UnknownTownError) {
        getDemandLog().record(name, { badTown: err.town }, 0, performance.now() - t0);
        return errorEnvelope({
          code: 'unknown_town',
          message: `"${err.town}" is not a town in this catalogue.`,
          suggestions: err.suggestions,
        });
      }
      return errorEnvelope({
        code: 'internal',
        message: 'The tool failed unexpectedly.',
      });
    }
  };
}

/** "2026-10" -> ["2026-10-01", "2026-10-31"]; month lengths matter. */
function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType;
  readOnly: boolean;
  untrusted: boolean;
  execute: (raw: unknown, options?: { signal?: AbortSignal }) => Promise<string>;
}

/** Captures the schema generic per tool so handlers keep their input types. */
function tool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  schema: S;
  readOnly: boolean;
  untrusted: boolean;
  handler: Handler<S>;
}): ToolDef {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    schema: def.schema,
    readOnly: def.readOnly,
    untrusted: def.untrusted,
    execute: makeExecute(def.name, def.schema, def.handler),
  };
}

function defs(): ToolDef[] {
  return [
    tool({
      name: 'filter_places',
      title: 'Filter places',
      description:
        'Filter all 2798 places published in the myProvence guides by facet tags, town, ' +
        'cluster and star rating. This is the only way to query the full catalogue: the ' +
        'website paginates with JavaScript and marks every filter link rel="nofollow", so ' +
        'browsing cannot reach beyond the first 40 results of each cluster. Returns the ' +
        'canonical myprovence.fr URL for every result and highlights the results on the ' +
        "map the visitor is watching. Tags must be slugs from explain_vocabulary.",
      schema: filterPlacesInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof filterPlacesInput>, store) => {
        const { total, places } = store.filter(input, 'agent');
        // input.query flows through FilterInput untouched.
        return {
          total,
          data: {
            total,
            returned: places.length,
            offset: input.offset,
            truncated: total > input.offset + places.length,
            results: places.map((p) => store.toPublicShape(p)),
          },
        };
      },
    }),
    tool({
      name: 'explain_vocabulary',
      title: 'Explain the tag vocabulary',
      description:
        'The catalogue filters by opaque numeric tags (parking is term 469). This tool ' +
        'publishes the human vocabulary: every tag slug, its French label, which Drupal ' +
        'vocabulary it belongs to, and how many places carry it. Pass query to search, ' +
        'omit it for the most common tags. Use the returned slugs with filter_places.',
      schema: explainVocabularyInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof explainVocabularyInput>, store) => {
        const { total, items } = listVocabulary(store.vocab, input.query, input.limit);
        return {
          total,
          data: {
            total,
            returned: items.length,
            truncated: total > items.length,
            tags: items,
          },
        };
      },
    }),
    tool({
      name: 'get_place',
      title: 'Get one place',
      description:
        'Return one place in full by its id or its myprovence.fr URL: name, town, ' +
        'cluster, star rating, all tags as readable slugs, coordinates, summary and the ' +
        'canonical page URL. Use after filter_places when the visitor wants detail.',
      schema: getPlaceInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof getPlaceInput>, store) => {
        const place = store.getByIdOrUrl(input);
        if (!place) {
          return {
            total: 0,
            data: {
              found: false,
              note: 'No catalogue record matches. Ids come from filter_places; URLs must be myprovence.fr pages.',
            },
          };
        }
        return { total: 1, data: { found: true, place: store.toPublicShape(place) } };
      },
    }),
    tool({
      name: 'compare_places',
      title: 'Compare places',
      description:
        'Compare 2 to 5 places side by side on a shared attribute matrix: town, rating, ' +
        'and which of the tags each one has or lacks. Highlights the compared places on ' +
        'the shared map so the visitor sees the same comparison.',
      schema: comparePlacesInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof comparePlacesInput>, store) => {
        const found = input.ids
          .map((id) => store.getByIdOrUrl({ id }))
          .filter((p): p is NonNullable<typeof p> => p !== null);
        store.setHighlightedIds(found.map((p) => p.id), 'agent');
        const shapes = found.map((p) => store.toPublicShape(p));
        const allTags = [...new Set(shapes.flatMap((s) => s.tags))].sort();
        return {
          total: found.length,
          data: {
            requested: input.ids.length,
            found: found.length,
            places: shapes,
            matrix: allTags.map((tag) => ({
              tag,
              has: shapes.map((s) => s.tags.includes(tag)),
            })),
          },
        };
      },
    }),
    tool({
      name: 'find_near',
      title: 'Find places near',
      description:
        'Radius search around a named town or a lat/lng point, optionally within one ' +
        'cluster. Returns places sorted by distance in km and recentres the map the ' +
        'visitor is watching. Only places with known coordinates are searched.',
      schema: findNearInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof findNearInput>, store, _signal) => {
        let center: { lat: number; lng: number };
        if (input.lat !== undefined && input.lng !== undefined) {
          center = { lat: input.lat, lng: input.lng };
        } else {
          // Centre on the mean position of the town's own places.
          const townFold = fold(input.town!);
          const townPlaces = store.catalog.places.filter(
            (p) =>
              p.lat !== null &&
              p.t >= 0 &&
              fold(store.vocab.towns[p.t] ?? '') === townFold,
          );
          if (townPlaces.length === 0) {
            throw new UnknownTownError(
              input.town!,
              store.vocab.towns.filter((t) => fold(t).includes(townFold)).slice(0, 5),
            );
          }
          center = {
            lat: townPlaces.reduce((s, p) => s + p.lat!, 0) / townPlaces.length,
            lng: townPlaces.reduce((s, p) => s + p.lng!, 0) / townPlaces.length,
          };
        }
        const result = store.findNear(center, input.radiusKm, input.cluster, input.limit, 'agent');
        return {
          total: result.total,
          data: {
            center,
            radiusKm: input.radiusKm,
            total: result.total,
            returned: result.items.length,
            truncated: result.total > result.items.length,
            results: result.items.map((h) => ({
              distanceKm: h.distanceKm,
              ...store.toPublicShape(store.catalog.places[h.index]!),
            })),
          },
        };
      },
    }),
    tool({
      name: 'find_events',
      title: 'Find events',
      description:
        "Search the myProvence agenda: 3800+ dated events (concerts, guided tours, " +
        'exhibitions, markets, festivals...) in the Bouches-du-Rhône. Filter by a date ' +
        'window (month: "2026-10" for October) or from/to dates, by category slug, town ' +
        'and tags, or free-text query over names up front (query: "street food"). ' +
        'Results come back chronologically with startDate/endDate, the ' +
        'canonical myprovence.fr URL and a photo, and highlight on the shared map. ' +
        'Undated permanent events never match a dated query.',
      schema: findEventsInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof findEventsInput>, store) => {
        let from = input.from;
        let to = input.to;
        if (input.month) [from, to] = monthRange(input.month);

        // Closed vocabulary for categories, derived from the data itself so
        // it can never drift from the catalogue (same self-correcting error
        // pattern as tags and towns).
        if (input.category !== undefined) {
          const agendaIdx = CLUSTERS.findIndex((c) => c.key === 'agenda');
          const known = new Set<string>();
          for (const p of store.catalog.places) {
            if (p.c === agendaIdx) {
              const cat = categoryOf(p.u);
              if (cat) known.add(cat);
            }
          }
          if (!known.has(input.category)) {
            return {
              total: 0,
              data: {
                error: 'unknown_category',
                requested: input.category,
                validCategories: [...known].sort(),
              },
            };
          }
        }

        const { total, places } = store.filter(
          {
            cluster: 'agenda',
            category: input.category,
            town: input.town,
            tags: input.tags,
            query: input.query,
            // Only constrain (and sort) by date when the agent asked for a
            // window: an open browse must still surface undated permanent
            // events, which a window excludes by design.
            ...(from !== undefined || to !== undefined ? { from, to } : {}),
            limit: input.limit,
            offset: input.offset,
          },
          'agent',
        );
        return {
          total,
          data: {
            window: { from: from ?? null, to: to ?? null },
            total,
            returned: places.length,
            offset: input.offset,
            truncated: total > input.offset + places.length,
            results: places.map((p) => store.toPublicShape(p)),
          },
        };
      },
    }),
    tool({
      name: 'get_catalog_stats',
      title: 'Catalogue statistics',
      description:
        'Coverage of the catalogue: total places, count per cluster, number of towns, ' +
        'how many places carry coordinates and tags, and the 25 most common tags with ' +
        'their populations. Call this first to understand what can be asked.',
      schema: getCatalogStatsInput,
      readOnly: true,
      untrusted: false,
      handler: (_input, store) => {
        const stats = store.stats();
        return { total: stats.total, data: stats };
      },
    }),
    tool({
      name: 'set_view',
      title: 'Set the map view',
      description:
        'Steer the map the visitor is looking at: recentre and zoom. Mutates only the ' +
        'view state of this browser tab; changes nothing anywhere else.',
      schema: setViewInput,
      readOnly: false,
      untrusted: false,
      handler: (input: z.output<typeof setViewInput>, store) => {
        store.setView({ lat: input.lat, lng: input.lng }, input.zoom, 'agent');
        return { total: null, data: { ok: true, center: { lat: input.lat, lng: input.lng }, zoom: input.zoom } };
      },
    }),
    tool({
      name: 'highlight_places',
      title: 'Highlight places',
      description:
        'Mark a set of places on the shared map and result list so the visitor sees ' +
        'what you are talking about. Mutates only the view state of this browser tab.',
      schema: highlightPlacesInput,
      readOnly: false,
      untrusted: false,
      handler: (input: z.output<typeof highlightPlacesInput>, store) => {
        const matched = store.setHighlightedIds(input.ids, 'agent');
        return { total: matched, data: { requested: input.ids.length, highlighted: matched } };
      },
    }),
    tool({
      name: 'get_agent_demand',
      title: 'Agent demand this session',
      description:
        'The Demand Mirror: every tool call made in this session with its arguments and ' +
        'result count. Zero-result calls are demand the catalogue could not answer. ' +
        'Session-scoped; nothing here identifies the visitor.',
      schema: getAgentDemandInput,
      readOnly: true,
      untrusted: false,
      handler: (input: z.output<typeof getAgentDemandInput>) => {
        const log = getDemandLog();
        const entries = input.zeroResultsOnly ? log.zeroResults() : log.getSnapshot();
        return {
          total: entries.length,
          data: {
            total: entries.length,
            entries: entries.slice(-100),
          },
        };
      },
    }),
  ];
}

/** Single source of truth for the registered tool count (badge, tests, E2E). */
export const TOOL_COUNT = 10;

let registered = false;

/**
 * Register all nine tools. Called at module evaluation from the client entry;
 * must never await the catalogue (each execute does that internally).
 */
export function registerAll(): void {
  if (registered) return;
  if (typeof document === 'undefined') return;
  let mc: ModelContext | undefined;
  try {
    mc = document.modelContext;
  } catch {
    return; // a hostile/browser-quirk getter must not break the page
  }
  if (!mc || typeof mc.registerTool !== 'function') return;
  registered = true;

  patchWebMcpStatus({ supported: true });

  // Exception-safe on BOTH paths (S6): a synchronous IDL TypeError from the
  // browser's registerTool, or a schema-generation failure, must cost us that
  // one tool, never the page. This module evaluates at hydration; an
  // unhandled throw here would take the whole React tree down with it.
  // Every outcome is RECORDED (webmcp/status.ts): a silent failure once made
  // a field test undiagnosable.
  const all = defs().map((def) => {
    try {
      return mc
        .registerTool({
          name: def.name,
          title: def.title,
          description: def.description,
          inputSchema: toJsonSchema(def.schema),
          annotations: {
            readOnlyHint: def.readOnly,
            untrustedContentHint: def.untrusted,
          },
          execute: def.execute,
        })
        .then(
          () => recordRegistration(true, def.name),
          (err: unknown) => recordRegistration(false, def.name, String(err).slice(0, 200)),
        );
    } catch (err) {
      recordRegistration(false, def.name, String(err).slice(0, 200));
      return Promise.resolve();
    }
  });

  // After everything settles, ask the browser what IT thinks is registered.
  // getTools() is optional in some implementations; null means "not checkable".
  void Promise.allSettled(all).then(async () => {
    try {
      if (typeof mc.getTools === 'function') {
        const names = new Set(defs().map((d) => d.name));
        const visible = (await mc.getTools()).filter((t) => names.has(t.name)).length;
        patchWebMcpStatus({ verified: visible });
        // eslint-disable-next-line no-console
        console.info(`[webmcp] ${visible}/${TOOL_COUNT} site tools verified via getTools()`);
      }
    } catch {
      patchWebMcpStatus({ verified: null });
    }
  });
}

/** Exported for tests: the tool definitions without side effects. */
export function toolDefinitions(): ReadonlyArray<{
  name: string;
  description: string;
  schema: z.ZodType;
  readOnly: boolean;
}> {
  return defs().map((d) => ({
    name: d.name,
    description: d.description,
    schema: d.schema,
    readOnly: d.readOnly,
  }));
}
