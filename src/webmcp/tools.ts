/**
 * The fourteen WebMCP site tools (issues #602, #607-#609).
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
import { getPresenceBus, intentFor } from '@/lib/presence';
import { getElicitationStore } from '@/lib/elicitation';
import { getSignalsLog } from '@/lib/signals';
import { getPulseStore } from '@/lib/pulse-client';
import type { PulseData } from '@/lib/demand-pulse';
import { selectTonight } from '@/lib/tonight';
import { townCentroids } from '@/lib/centroids';
import { getScoutStore, runMission } from '@/lib/scouts';
import { getPinStore } from '@/lib/pin';
import { pickGlyph } from '@/lib/glyphs';
import { getAgentRequest, setAgentRequest } from '@/lib/agent-context';
import { deriveViewportContext } from '@/lib/viewport-context';
import { getShortlistStore, type ShortlistItem } from '@/lib/shortlist';
import { getViewportStore } from '@/lib/viewport';
import { getPostcardStore } from '@/lib/postcard';
import { composeCarnet, getCarnetStore } from '@/lib/carnet';
import { patchWebMcpStatus, recordRegistration } from './status';
import {
  askVisitorInput,
  composeCarnetInput,
  sendScoutsInput,
  getScoutReportsInput,
  findTonightInput,
  getVisitorViewInput,
  writePostcardInput,
  comparePlacesInput,
  findEventsInput,
  getDemandPulseInput,
  getInputResultInput,
  getVisitorSignalsInput,
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

/** Tools whose `total` counts CATALOGUE results: only their zeros mean "the
 *  offer is missing" and may feed the Demand Mirror's unmet-demand callout.
 *  State-reading tools (read_visitor_wish, get_scout_reports…) legitimately
 *  return 0 — counting those as gaps showed "Demande sans réponse" to a
 *  visitor who had just received an answer (field bug, 30 Aug). */
const DEMAND_TOOLS = new Set([
  'send_scouts',
  'filter_places',
  'find_near',
  'find_events',
  'find_tonight',
]);

type Handler<S extends z.ZodType> = (
  input: z.output<S>,
  store: Store,
  signal: AbortSignal,
) => { data: unknown; total: number | null } | Promise<{ data: unknown; total: number | null }>;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

let neverAbortedSignal: AbortSignal | null = null;
/** Stand-in when the browser omits the options bag (Chrome 151 DevTrial). */
function neverAborted(): AbortSignal {
  if (!neverAbortedSignal) neverAbortedSignal = new AbortController().signal;
  return neverAbortedSignal;
}

export function makeExecute<S extends z.ZodType>(
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

      // The body announces its intent BEFORE acting (issue #607). Presence is
      // pure theatre: emission is a bounded push, entirely outside the
      // measured engine path, and a presence failure must never cost a tool.
      try {
        getPresenceBus().emit({
          phase: 'announce',
          tool: name,
          intent: intentFor(name, parsed.data as Record<string, unknown>),
        });
      } catch {
        /* theatre only */
      }

      const { data, total } = await handler(parsed.data, store, signal ?? neverAborted());
      try {
        getPresenceBus().emit({ phase: 'done', tool: name });
      } catch {
        /* theatre only */
      }
      getDemandLog().record(
        name,
        parsed.data as Record<string, unknown>,
        DEMAND_TOOLS.has(name) ? total : null,
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

/** The visitor's CHOICES, not just their GARDER taps (field bug 1 Sep: a
 *  session of pins and locks ended with the postcard refusing on
 *  'empty_selection'). Locked cards and the agent's accepted pin are
 *  adopted into the shortlist — the single source of truth the postcard
 *  footer and carnet render — then the live shortlist is returned.
 *  Bounded by the shortlist's own cap; every failure is theatre-only. */
export function adoptChoicesIntoShortlist(store: Store): readonly ShortlistItem[] {
  const shortlist = getShortlistStore();
  const seen = new Set(shortlist.getSnapshot().map((i) => i.id));
  const adopt = (id: number, request: string | null) => {
    if (seen.has(id)) return;
    const place = store.getByIdOrUrl({ id });
    if (!place) return;
    const pub = store.toPublicShape(place);
    seen.add(id);
    shortlist.keep({
      id: pub.id,
      name: pub.name,
      town: pub.town ?? '',
      url: pub.url,
      d1: place.d1 ?? null,
      d2: place.d2 ?? null,
      img: pub.image,
      glyph: pickGlyph(place, store.vocab),
      request,
    });
  };
  try {
    const pin = getPinStore().getSnapshot();
    if (pin) adopt(pin.id, getAgentRequest());
  } catch {
    /* client-only store */
  }
  try {
    for (const id of getSignalsLog().lockedIds()) adopt(id, null);
  } catch {
    /* client-only store */
  }
  return shortlist.getSnapshot();
}

/** The visitor's own calendar day (their timezone, not UTC). */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      name: 'send_scouts',
      title: 'Envoyer les éclaireurs',
      description:
        'Plans a stay or outing in Provence (Bouches-du-Rhône) from one fuzzy wish in ' +
        "any language: 'romantic weekend, good food, not too touristy', 'j'hésite entre " +
        "les Alpilles et la côte'. Use when the visitor expresses " +
        'a desire rather than a precise query, even with no place named. Runs 2-4 scout ' +
        'searches over the official Provence Tourisme catalogue (2798 places, 3600+ ' +
        'dated events) and plants keep/dismiss flags on the shared map. Search terms in ' +
        "French; mission and labels in the visitor's language.",
      schema: sendScoutsInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof sendScoutsInput>, store) => {
        const scoutTowns = [...new Set(input.scouts.map((b) => b.town).filter(Boolean))];
        setAgentRequest(input.mission, scoutTowns.length === 1 ? scoutTowns[0] : null);
        const today = localDay();
        const mission = runMission(store, input.mission, input.scouts, today);
        getScoutStore().start(mission);
        // The whole page answers, not just the map: the findings become the
        // shared result set (grid, count, agent chip).
        const ids = mission.reports.flatMap((r) => r.findings.map((f) => f.id));
        if (ids.length > 0) store.setHighlightedIds(ids, 'agent');
        try {
          getPresenceBus().emit({ phase: 'focus', target: 'map' });
          getPresenceBus().emit({ phase: 'act', tool: 'send_scouts' });
        } catch {
          /* theatre only */
        }
        const found = mission.reports.reduce((n, r) => n + r.findings.length, 0);
        return {
          total: found,
          data: {
            mission: mission.mission,
            reports: mission.reports.map((r) => ({
              scoutId: r.scoutId,
              label: r.label,
              total: r.total,
              findings: r.findings,
            })),
            instruction:
              'The scouts are now travelling the map and planting flags. The visitor will ' +
              'tap to keep or dismiss each one — keep helping, then call get_scout_reports ' +
              'to read their verdicts before proposing anything final.',
          },
        };
      },
    }),
    tool({
      name: 'filter_places',
      title: 'Guides Provence (catalogue officiel)',
      description:
        'Searches the official Provence Tourisme catalogue: 2798 hotels, campings, ' +
        "chambres d'hôtes, leisure and 232 walking/cycling routes in the " +
        'Bouches-du-Rhône. Use for precise lodging or activity questions about ' +
        'Provence, any language: "hôtel avec piscine", "que faire à ' +
        'Marseille". Translate query terms and tags to French. Filters: tag slugs ' +
        '(see explain_vocabulary), town, cluster, stars, free-text. Results carry ' +
        'canonical myprovence.fr URLs and light the shared map. A fuzzy wish fits send_scouts.',
      schema: filterPlacesInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof filterPlacesInput>, store) => {
        // A fresh search supersedes the mission on stage: the banner must
        // reflect the CURRENT request, never a previous one (field bug 1 Sep).
        setAgentRequest(intentFor('filter_places', input as Record<string, unknown>), input.town ?? null);
        try {
          getScoutStore().retireForNewContext(input.town);
        } catch {
          /* client-only store */
        }
        try {
          getPresenceBus().emit({ phase: 'focus', target: 'filters' });
          getPresenceBus().emit({ phase: 'act', tool: 'filter_places', tags: input.tags });
        } catch {
          /* theatre only */
        }
        const { total, places } = store.filter(input, 'agent');
        // input.query flows through FilterInput untouched.
        // Locked items are the visitor's decisions (issue #608): they lead
        // the list and carry the flag, and the description tells the agent
        // never to argue with them.
        const signals = getSignalsLog();
        const shaped = places.map((p) => ({
          ...store.toPublicShape(p),
          ...(signals.isLocked(p.id) ? { locked: true } : {}),
        }));
        shaped.sort((a, b) => Number('locked' in b) - Number('locked' in a));
        return {
          total,
          data: {
            total,
            returned: shaped.length,
            offset: input.offset,
            truncated: total > input.offset + shaped.length,
            results: shaped,
            instruction:
              'The shared grid now shows ALL matches. To spotlight the specific picks ' +
              'you cite in your answer, call highlight_places with their ids; to feature ' +
              'one single choice, pin_visible_place.',
          },
        };
      },
    }),
    tool({
      name: 'explain_vocabulary',
      title: 'Critères disponibles',
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
      title: "Fiche officielle d'un lieu",
      description:
        'Returns the full official record of one Provence place instantly: name, town, ' +
        'cluster, star rating, all tags as readable slugs, coordinates, summary and the ' +
        'canonical myprovence.fr URL. Use when the visitor asks about one specific place ' +
        '— "tell me more about that hotel", "does it have parking?", "c\'est comment, ce ' +
        'camping ?". Look it up by id (from any earlier result) or by its myprovence.fr ' +
        'URL.',
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
      title: 'Comparer des adresses',
      description:
        'Compares 2 to 5 catalogue places side by side on a shared attribute matrix ' +
        '(town, rating, which tags each has or lacks) straight from the official record. ' +
        'Use when the visitor hesitates between places already found here — "which of ' +
        'the two has parking AND a pool?", "lequel est le mieux placé ?". Highlights the ' +
        'compared places on the shared map so the visitor sees the same comparison.',
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
      title: "Autour d'un point (rayon en km)",
      description:
        'Radius search over the official catalogue around a named town or a lat/lng ' +
        'point, optionally within one cluster. Use for any distance-shaped question ' +
        'about Provence places: "near Cassis", "within 10 km of Aix", "autour des ' +
        'calanques", "close to the station". Returns places sorted by distance in km ' +
        'and recentres the map the visitor is watching. Only places with known ' +
        'coordinates are searched.',
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
        try {
          getPresenceBus().emit({ phase: 'focus', target: center });
          getPresenceBus().emit({
            phase: 'act',
            tool: 'find_near',
            center,
            radiusKm: input.radiusKm,
          });
        } catch {
          /* theatre only */
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
      title: 'Agenda Provence (catalogue officiel)',
      description:
        'Searches the official Provence Tourisme agenda: 3600+ dated events in the ' +
        'Bouches-du-Rhône (festivals, concerts, marchés, expos). Use for ' +
        'what-is-happening questions in Provence — "que faire ce week-end", a month, a ' +
        'town — any language; translate query terms to French. Filters: free-text ' +
        'query, month ("2026-10"), from/to, category, town, tags. Chronological ' +
        'results with dates and canonical myprovence.fr URLs, lit on the shared map. ' +
        'find_tonight covers "tonight"; send_scouts covers fuzzy wishes.',
      schema: findEventsInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof findEventsInput>, store) => {
        setAgentRequest(intentFor('find_events', input as Record<string, unknown>), input.town ?? null);
        try {
          getScoutStore().retireForNewContext(input.town); // new request, banner follows (1 Sep)
        } catch {
          /* client-only store */
        }
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
        'Marks a set of places on the shared map and result list so the visitor sees ' +
        'the places being discussed. Each search call replaces the map selection, so a ' +
        'final answer stays fully visible when this receives the complete set of cited ' +
        'ids (hotels and events together; events without exact coordinates get ' +
        'town-level pins). Mutates only the view state of this browser tab.',
      schema: highlightPlacesInput,
      readOnly: false,
      untrusted: false,
      handler: (input: z.output<typeof highlightPlacesInput>, store) => {
        const matched = store.setHighlightedIds(input.ids, 'agent');
        store.frameHighlighted();
        return { total: matched, data: { requested: input.ids.length, highlighted: matched } };
      },
    }),
    tool({
      name: 'ask_visitor',
      title: 'Question au visiteur',
      description:
        'Ask the visitor ONE short question by placing tappable choice cards on the page ' +
        'they are looking at — never ask preferences in chat when this tool is available. ' +
        'Resolves with their tap. If they take longer than ~45s you receive ' +
        '{status:"pending", input_id}: keep helping and collect the answer later with ' +
        'get_input_result. Their choices are decisions, not suggestions.',
      schema: askVisitorInput,
      readOnly: false,
      untrusted: false,
      handler: async (input: z.output<typeof askVisitorInput>, _store, signal) => {
        const { promise } = getElicitationStore().ask(input.question, input.options, signal);
        const result = await promise;
        return { total: result.status === 'answered' ? 1 : 0, data: result };
      },
    }),
    tool({
      name: 'get_input_result',
      title: 'Réponse du visiteur',
      description:
        'Collect the answer to a pending ask_visitor ticket. Statuses: answered (their ' +
        'choice), pending (still deciding — continue helping, retry later), dismissed ' +
        '(they closed the question: respect it, do not re-ask).',
      schema: getInputResultInput,
      readOnly: true,
      untrusted: false,
      handler: (input: z.output<typeof getInputResultInput>) => {
        const result = getElicitationStore().result(input.input_id);
        return { total: result.status === 'answered' ? 1 : 0, data: result };
      },
    }),
    tool({
      name: 'get_visitor_signals',
      title: 'Gestes du visiteur',
      description:
        'The visitor talks with their hands: pings dropped on the map ' +
        '(plus-comme-ca = more like this here, eviter = avoid this area, question = ' +
        'curious about this spot), locks on results (their firm choices — never argue), ' +
        'card answers, typed WISHES (they wrote a desire into the page box: the page ' +
        'only records it — it is waiting for YOU to interpret it and call send_scouts), ' +
        'and yields. Returns gestures since your last call plus ' +
        'current locks and pings. Worth reading before any search or proposal.',
      schema: getVisitorSignalsInput,
      readOnly: true,
      untrusted: false,
      handler: () => {
        const drained = getSignalsLog().drainForAgent();
        // Grounding ack (issue #608): acknowledge the latest ping visibly.
        const lastPing = drained.pings[drained.pings.length - 1];
        if (lastPing) {
          try {
            getPresenceBus().emit({ phase: 'focus', target: { lat: lastPing.lat, lng: lastPing.lng } });
            getPresenceBus().emit({
              phase: 'act',
              tool: 'get_visitor_signals',
              center: { lat: lastPing.lat, lng: lastPing.lng },
            });
          } catch {
            /* theatre only */
          }
        }
        return {
          total: drained.newSignals.length,
          data: {
            newSignals: drained.newSignals,
            locks: drained.locks,
            pings: drained.pings,
          },
        };
      },
    }),
    tool({
      name: 'get_demand_pulse',
      title: 'Le pouls de la demande',
      description:
        "The destination's live agent demand, aggregated by town over the last 7 days " +
        '(counters only, k-anonymized). Calling it lights the demand layer on the shared ' +
        'map: coral for served demand, bright yellow for requests that found NOTHING — ' +
        'the invisible demand. Narrate one factual line from it, e.g. "84 asks around ' +
        'Marseille this week; the zero-result ones are the offer gaps".',
      schema: getDemandPulseInput,
      readOnly: true,
      untrusted: false,
      handler: async (_input, _store, signal) => {
        signal?.throwIfAborted();
        const res = await fetch('/api/demand-pulse', { credentials: 'omit', signal });
        signal?.throwIfAborted();
        if (!res.ok) {
          return { total: 0, data: { error: 'pulse_unavailable' } };
        }
        const pulse = (await res.json()) as PulseData;
        signal?.throwIfAborted();
        // Same-origin, but never trust a shape you did not check: an error
        // body with a 200 must not reach the map layer.
        if (!Array.isArray(pulse?.towns) || typeof pulse?.totalRequests !== 'number') {
          return { total: 0, data: { error: 'pulse_unavailable' } };
        }
        getPulseStore().set(pulse);
        try {
          getPresenceBus().emit({ phase: 'focus', target: 'map' });
          getPresenceBus().emit({ phase: 'act', tool: 'get_demand_pulse' });
        } catch {
          /* theatre only */
        }
        return { total: pulse.towns.length, data: pulse };
      },
    }),
    tool({
      name: 'get_scout_reports',
      title: 'Rapports des éclaireurs',
      description:
        "The last scout mission with the visitor's verdicts: kept (their decision, treat " +
        'as fixed), dismissed (do not re-propose), pending (still deciding). Any plan or ' +
        'postcard grounds itself in these verdicts.',
      schema: getScoutReportsInput,
      readOnly: true,
      untrusted: false,
      handler: () => {
        // A retired mission (superseded by a newer search) still answers:
        // its verdicts are decisions, not stage props (1 Sep).
        const scoutStore = getScoutStore();
        const mission = scoutStore.getSnapshot() ?? scoutStore.history()[0] ?? null;
        if (!mission) {
          return { total: 0, data: { error: 'no_mission', message: 'No scouts sent yet.' } };
        }
        const kept = mission.reports.reduce(
          (n, r) => n + Object.values(r.verdicts).filter((v) => v === 'kept').length,
          0,
        );
        return { total: kept, data: mission };
      },
    }),
    tool({
      name: 'find_tonight',
      title: 'Ce soir en Provence',
      description:
        "What is ACTUALLY happening tonight (or a given day) near the visitor: real dated " +
        'events from the official agenda, sorted by distance when a town or coordinates ' +
        'are given, else within the area the visitor is currently looking at. Use for ' +
        '\"ce soir\", \"tonight\", \"que faire maintenant\", \"this weekend\" (call once per day). ' +
        'Results carry distance_km and light up on the shared map.',
      schema: findTonightInput,
      readOnly: true,
      untrusted: true,
      handler: (input: z.output<typeof findTonightInput>, store) => {
        setAgentRequest(intentFor('find_tonight', input as Record<string, unknown>), input.town ?? null);
        try {
          getScoutStore().retireForNewContext(input.town); // new request, banner follows (1 Sep)
        } catch {
          /* client-only store */
        }
        const date = input.date ?? localDay();
        const radius = input.radius_km ?? 15;
        const limit = input.limit ?? 12;
        // Where is "near"? Explicit coordinates, else the named town's
        // centroid ("around Aix, within 10 km" means the area, not the
        // administrative boundary — field report 29 Aug), else the center
        // of what the human is looking at.
        let center: { lat: number; lng: number } | null =
          input.lat !== undefined && input.lng !== undefined
            ? { lat: input.lat, lng: input.lng }
            : null;
        let townFilter = input.town;
        if (!center && input.town !== undefined) {
          const c = townCentroids(store.catalog, store.vocab).get(fold(input.town));
          if (c) {
            center = c;
            townFilter = undefined; // the radius replaces the boundary
          }
        }
        if (!center && townFilter === undefined) {
          // "Near me" = the middle of what the human is LOOKING at. The
          // viewport store is fed by the map itself, so it stays true after
          // camera frames; the store center only tracks explicit setView
          // calls (audit 8).
          const b = getViewportStore().getSnapshot().bounds;
          center = b
            ? { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 }
            : store.getView().center;
        }
        // 800-candidate pool: a big town's day overlaps hundreds of
        // long-running events, and a 200 cap was cutting the one-night ones
        // the ranker exists to surface (audit pass 7).
        const { places } = store.peekFilter({
          cluster: 'agenda',
          town: townFilter,
          from: date,
          to: date,
          limit: 800,
          offset: 0,
        });
        const centroids = townCentroids(store.catalog, store.vocab);
        const townFallback = (p: (typeof places)[number]) => {
          const town = p.t >= 0 ? store.vocab.towns[p.t] : undefined;
          return (town && centroids.get(fold(town))) || null;
        };
        const shaped = selectTonight(places, center, radius, limit, townFallback).map((pick) => ({
          ...store.toPublicShape(pick.place),
          distance_km: pick.distanceKm,
        }));
        store.setHighlightedIds(shaped.map((e) => e.id), 'agent');
        // The camera frames what was found; a result off-screen is a result
        // that does not exist for the visitor.
        store.frameHighlighted();
        return {
          total: shaped.length,
          data: {
            date,
            center,
            radius_km: center ? radius : null,
            events: shaped,
            note:
              shaped.length === 0
                ? 'Nothing on this exact day in range. Widen radius_km or try the next days with find_events.'
                : undefined,
          },
        };
      },
    }),
    tool({
      name: 'get_visitor_view',
      title: 'Ce que le visiteur regarde',
      description:
        "The visitor's CURRENT context, live: map viewport with the TOWNS it frames " +
        '(townsInView, ranked; dominantTown when one leads), zoom, hand-set filters, ' +
        'kept selection, and visible place names. Use when they say "here", "around ' +
        'this", "what am I looking at", and before proposing anything. The viewport is ' +
        "the visitor's true focus: a zoom on one town with the town filter still on " +
        '"all towns" means THAT town, dominantTown says which.',
      schema: getVisitorViewInput,
      readOnly: true,
      untrusted: false,
      handler: (_input, store) => {
        const vp = getViewportStore().getSnapshot();
        const view = store.getView();
        const visible: string[] = [];
        if (vp.bounds) {
          const b = vp.bounds;
          for (const i of view.highlighted) {
            const p = store.catalog.places[i];
            if (!p || p.lat === null || p.lng === null) continue;
            if (p.lat <= b.north && p.lat >= b.south && p.lng <= b.east && p.lng >= b.west) {
              visible.push(p.n);
              if (visible.length >= 30) break;
            }
          }
        }
        const context = deriveViewportContext(store.catalog, store.vocab, vp.bounds);
        return {
          total: visible.length,
          data: {
            viewport: vp.bounds ? { ...vp.bounds, zoom: vp.zoom } : null,
            // The viewport IS the visitor's focus: derived here because raw
            // bounds mean nothing to a model (field bug 1 Sep, the agent
            // answered "no city selected" over a zoom on one town).
            townsInView: context.townsInView,
            dominantTown: context.dominantTown,
            humanFilter: vp.filter,
            resultTotal: view.total,
            highlightedCount: view.highlighted.length,
            lastActor: view.lastActor,
            keptSelection: getShortlistStore().getSnapshot(),
            visiblePlaces: visible,
          },
        };
      },
    }),
    tool({
      name: 'write_postcard',
      title: 'La carte postale du futur',
      description:
        'Composes the closing keepsake: a short letter from day 2-3 of the trip, first ' +
        "person, in the visitor's language, grounded ONLY in their choices — kept flags, " +
        'locked cards and the accepted pin all count. The factual footer (places, towns, ' +
        'dates, links) prints automatically from that selection; the body text is the ' +
        'prose on top. Displays full-screen on the page; refuses while no choice exists.',
      schema: writePostcardInput,
      readOnly: false,
      untrusted: false,
      handler: (input: z.output<typeof writePostcardInput>, store) => {
        const selection = adoptChoicesIntoShortlist(store);
        if (selection.length === 0) {
          return {
            total: 0,
            data: {
              error: 'empty_selection',
              message:
                'The visitor has not chosen anything yet: no kept flag (GARDER), no ' +
                'locked card, no accepted pin. Send scouts or pin a place and ask them ' +
                'to keep what they like, then compose.',
            },
          };
        }
        getPostcardStore().set({ title: input.title, body: input.body, day: input.day ?? 3 });
        return {
          total: selection.length,
          data: { status: 'displayed', selection },
        };
      },
    }),
    tool({
      name: 'compose_carnet',
      title: 'Le carnet de voyage',
      description:
        "Composes the briefing pack from the visitor's choices (kept flags, locked " +
        'cards, accepted pin): a print-ready carnet de voyage with the real photographs, ' +
        'one section per day. Reference ONLY ids from that selection — unknown ids are ' +
        'refused with the valid list. Assign dated events to their day, places to ' +
        "arrival/anytime sections; day labels and notes in the visitor's language. The " +
        'visitor gets a Download-PDF button.',
      schema: composeCarnetInput,
      readOnly: false,
      untrusted: false,
      handler: (input: z.output<typeof composeCarnetInput>, store) => {
        const kept = adoptChoicesIntoShortlist(store);
        if (kept.length === 0) {
          return {
            total: 0,
            data: {
              error: 'empty_selection',
              message:
                'Nothing chosen yet: no kept flag (GARDER), no locked card, no accepted ' +
                'pin. Send scouts or pin a place first.',
            },
          };
        }
        const result = composeCarnet(kept, input.title, input.days, input.signoff);
        if ('error' in result) {
          return {
            total: 0,
            data: {
              error: result.error,
              unknownIds: result.unknownIds,
              validIds: result.validIds,
              message: 'Use only ids from the kept selection.',
            },
          };
        }
        getCarnetStore().set(result.carnet);
        return { total: kept.length, data: { status: 'displayed', days: result.carnet.days.length } };
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
export const TOOL_COUNT = 20;

let registered = false;

/**
 * Register all fourteen tools. Called at module evaluation from the client entry;
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
