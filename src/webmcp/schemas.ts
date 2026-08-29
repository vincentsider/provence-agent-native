/**
 * Tool input schemas. Zod is the single definition; the JSON Schema the agent
 * reads is derived from it (z.toJSONSchema), so the two cannot drift.
 *
 * Every schema is .strict(): an open object is an exfiltration channel — a
 * confused or compromised agent can smuggle arbitrary payloads through an
 * ignored property. Unknown keys are a rejection, not an ignore.
 *
 * No tool accepts a URL (get_place validates against the canonical host),
 * path, selector or template. Nothing in this surface can be made to address
 * something other than a catalogue record.
 */

import { z } from 'zod';
import { CLUSTER_KEYS } from '@/lib/types';

const clusterEnum = z
  .enum(CLUSTER_KEYS)
  .describe('One of the five myProvence guide clusters.');

const tagSlug = z.string().min(1).max(64);

export const filterPlacesInput = z
  .object({
    cluster: clusterEnum
      .optional()
      .describe('Restrict to one cluster. Omit to search all 2798 places.'),
    tags: z
      .array(tagSlug)
      .max(12)
      .optional()
      .describe(
        'Tag slugs, ALL of which must be present. Example: ' +
          '["parking","animaux-acceptes"]. Call explain_vocabulary for the full list.',
      ),
    anyTags: z
      .array(tagSlug)
      .max(12)
      .optional()
      .describe('Tag slugs, ANY of which is enough.'),
    town: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('Town name, e.g. "Marseille". Matched case- and accent-insensitively.'),
    minGrade: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Minimum star rating (hotels).'),
    query: z
      .string()
      .min(2)
      .max(80)
      .optional()
      .describe('Free-text keyword search over names, towns, summaries and criteria labels, accent-insensitive. The catalogue is FRENCH: translate terms to French first ("Schwimmbad" -> "piscine", "dog friendly" -> "animaux acceptes"). Example: "street food".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(40)
      .default(20)
      .describe('Maximum results. Hard cap 40 to keep the response small.'),
    offset: z.number().int().min(0).max(5000).default(0),
  })
  .strict();

export const explainVocabularyInput = z
  .object({
    query: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('Optional label/slug fragment to search for, e.g. "piscine".'),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const getPlaceInput = z
  .object({
    id: z.number().int().optional().describe('The place id, from filter_places results.'),
    url: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe('A myprovence.fr page URL or path, e.g. "/les-guides/hebergements/hotels/...".'),
  })
  .strict()
  .refine((v) => v.id !== undefined || v.url !== undefined, {
    message: 'Provide id or url.',
  });

export const comparePlacesInput = z
  .object({
    ids: z
      .array(z.number().int())
      .min(2)
      .max(5)
      .describe('2 to 5 place ids to compare side by side.'),
  })
  .strict();

export const findNearInput = z
  .object({
    town: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe('Centre on a known town, e.g. "Cassis".'),
    lat: z.number().min(42.5).max(44.5).optional(),
    lng: z.number().min(3.5).max(7.5).optional(),
    radiusKm: z.number().min(0.5).max(80).default(15),
    cluster: clusterEnum.optional(),
    limit: z.number().int().min(1).max(40).default(20),
  })
  .strict()
  .refine((v) => v.town !== undefined || (v.lat !== undefined && v.lng !== undefined), {
    message: 'Provide town, or lat and lng.',
  });

export const getCatalogStatsInput = z.object({}).strict();

export const setViewInput = z
  .object({
    lat: z.number().min(42.5).max(44.5),
    lng: z.number().min(3.5).max(7.5),
    zoom: z.number().int().min(7).max(17).default(11),
  })
  .strict();

export const highlightPlacesInput = z
  .object({
    ids: z
      .array(z.number().int())
      .min(1)
      .max(80)
      .describe('Place ids to highlight on the shared map and list.'),
  })
  .strict();

const isoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD expected');

export const findEventsInput = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM expected')
      .optional()
      .describe('Whole-month shorthand, e.g. "2026-10" for October 2026. Overrides from/to.'),
    from: isoDate.optional().describe('Window start (inclusive).'),
    to: isoDate.optional().describe('Window end (inclusive).'),
    category: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        'Agenda category slug from the event URLs, e.g. "concert", "marche", ' +
          '"visites-guidees", "exposition". Unknown values return the valid list.',
      ),
    town: z.string().min(1).max(80).optional(),
    tags: z.array(tagSlug).max(12).optional(),
    query: z
      .string()
      .min(2)
      .max(80)
      .optional()
      .describe('Free-text keyword search over event names, towns and summaries, accent-insensitive. The catalogue is FRENCH: translate terms to French first ("Weihnachtsmarkt" -> "marche de noel"). Example: "street food festival".'),
    limit: z.number().int().min(1).max(40).default(20),
    offset: z.number().int().min(0).max(5000).default(0),
  })
  .strict();

export const askVisitorInput = z
  .object({
    question: z
      .string()
      .min(5)
      .max(160)
      .describe('One short question, in the visitor language (French here).'),
    options: z
      .array(z.string().min(1).max(40))
      .min(2)
      .max(4)
      .describe('2-4 short tappable choices.'),
  })
  .strict();

export const getInputResultInput = z
  .object({
    input_id: z
      .string()
      .regex(/^q-[a-z0-9-]{1,40}$/, 'input_id from a previous ask_visitor call')
      .describe('The pending ticket returned by ask_visitor.'),
  })
  .strict();

export const getVisitorSignalsInput = z.object({}).strict();

export const getDemandPulseInput = z.object({}).strict();

const monthField = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('Month, YYYY-MM.');

export const sendScoutsInput = z
  .object({
    mission: z
      .string()
      .min(5)
      .max(120)
      .describe("The visitor's desire in one short French sentence, shown on screen."),
    scouts: z
      .array(
        z
          .object({
            label: z
              .string()
              .min(2)
              .max(40)
              .describe('Short French label for this scout, e.g. "villages du Luberon".'),
            query: z.string().min(2).max(80).optional()
              .describe('Free-text search, FRENCH terms.'),
            tags: z.array(tagSlug).max(4).optional()
              .describe('Tag slugs (ALL required). Call explain_vocabulary for slugs.'),
            town: z.string().min(1).max(80).optional(),
            cluster: clusterEnum.optional(),
            month: monthField.optional(),
          })
          .strict()
          .refine(
            (b) => b.query !== undefined || (b.tags?.length ?? 0) > 0 || b.town !== undefined || b.cluster !== undefined || b.month !== undefined,
            { message: 'A scout brief needs at least one search criterion.' },
          ),
      )
      .min(2)
      .max(4)
      .describe('2 to 4 DIFFERENT search angles on the same desire.'),
  })
  .strict();

export const getScoutReportsInput = z.object({}).strict();

export const findTonightInput = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .optional()
      .describe("Day to look at, YYYY-MM-DD. Omit for today (the visitor's day)."),
    town: z.string().min(1).max(80).optional()
      .describe('Center the search on this town.'),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius_km: z.number().min(1).max(50).optional()
      .describe('Walking/driving range in km. Default 15.'),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng come together.',
  });

export const getVisitorViewInput = z.object({}).strict();

export const pinVisiblePlaceInput = (names: readonly string[]) =>
  z
    .object({
      name: z
        .enum(names as [string, ...string[]])
        .describe('EXACT name of a place currently visible on the shared map.'),
    })
    .strict();

export const writePostcardInput = z
  .object({
    title: z.string().min(3).max(60)
      .describe('Postcard title, French, e.g. "Trois jours entre Luberon et mer".'),
    body: z
      .string()
      .min(40)
      .max(700)
      .describe(
        'The letter, written from day 2 or 3 of the trip, first person, French. ' +
          'Mention ONLY places and events from the visitor\'s kept selection ' +
          '(the factual footer is printed automatically from that selection).',
      ),
    day: z.number().int().min(1).max(7).optional()
      .describe('Which trip day the letter is written from.'),
  })
  .strict();

export const getAgentDemandInput = z
  .object({
    zeroResultsOnly: z
      .boolean()
      .default(false)
      .describe('Return only the requests that found nothing.'),
  })
  .strict();

/** JSON Schema for the agent, derived (draft-7 structure) — never
 *  hand-written. The $schema marker is stripped: MCP-style inputSchema
 *  conventionally omits it, and a strict host validator rejecting the extra
 *  key would silently cost us the whole tool. */
export function toJsonSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}
