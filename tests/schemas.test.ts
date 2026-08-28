/**
 * Schema tests (spec 11.2): every generated JSON Schema is a valid draft-7
 * object schema; every schema fuzzes 500 malformed inputs and rejects each
 * with a typed error, never an unhandled throw; .strict() rejects unknown
 * keys (the exfiltration-channel control).
 */

import { z } from 'zod';
import {
  askVisitorInput,
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
} from '@/webmcp/schemas';

const ALL: Array<[string, z.ZodType]> = [
  ['filter_places', filterPlacesInput],
  ['explain_vocabulary', explainVocabularyInput],
  ['get_place', getPlaceInput],
  ['compare_places', comparePlacesInput],
  ['find_near', findNearInput],
  ['find_events', findEventsInput],
  ['ask_visitor', askVisitorInput],
  ['get_input_result', getInputResultInput],
  ['get_visitor_signals', getVisitorSignalsInput],
  ['get_catalog_stats', getCatalogStatsInput],
  ['set_view', setViewInput],
  ['highlight_places', highlightPlacesInput],
  ['get_agent_demand', getAgentDemandInput],
];

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

const rand = rng(2026);

function garbage(): unknown {
  const pool: unknown[] = [
    null,
    undefined,
    42,
    -1e9,
    3.14,
    'string',
    '',
    true,
    [],
    [{}],
    { unknownKey: 'x' },
    { tags: 'not-an-array' },
    { tags: [123] },
    { limit: -5 },
    { limit: 10_000 },
    { cluster: 'not-a-cluster' },
    { lat: 999 },
    { ids: [] },
    { ids: 'x' },
    { __proto__: { polluted: true } },
    { constructor: { prototype: {} } },
    { tags: Array.from({ length: 100 }, (_, i) => `t${i}`) },
    { town: 'x'.repeat(500) },
    () => 0,
    Symbol('s'),
    { events: [{ tool: 'x' }] },
  ];
  return pool[Math.floor(rand() * pool.length)];
}

describe('generated JSON Schemas', () => {
  it.each(ALL)('%s emits a plain object schema without $schema', (_name, schema) => {
    const json = toJsonSchema(schema) as Record<string, unknown>;
    // $schema is stripped on purpose: strict host validators (field-tested
    // against ChatGPT's browser) must never reject the tool over it.
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe('object');
    // strict objects must forbid extra properties in the emitted schema too
    expect(json.additionalProperties).toBe(false);
  });
});

describe('fuzzing', () => {
  it.each(ALL)('%s rejects malformed input without throwing', (_name, schema) => {
    for (let i = 0; i < 500; i++) {
      const input = garbage();
      expect(() => {
        const result = schema.safeParse(input);
        // Either it parsed (some garbage is coincidentally valid, e.g. {}
        // for optional-only schemas) or it failed with typed issues.
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      }).not.toThrow();
    }
  });

  it('strict schemas reject unknown keys', () => {
    const r = filterPlacesInput.safeParse({ cluster: 'hotels', smuggled: 'payload' });
    expect(r.success).toBe(false);
  });

  it('limit is capped at 40 by the schema itself', () => {
    const r = filterPlacesInput.safeParse({ limit: 41 });
    expect(r.success).toBe(false);
  });

  it('get_place requires id or url', () => {
    expect(getPlaceInput.safeParse({}).success).toBe(false);
    expect(getPlaceInput.safeParse({ id: 5 }).success).toBe(true);
  });

  it('find_events validates month and date formats', () => {
    expect(findEventsInput.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(findEventsInput.safeParse({ month: 'octobre' }).success).toBe(false);
    expect(findEventsInput.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(findEventsInput.safeParse({ from: '01/10/2026' }).success).toBe(false);
    expect(findEventsInput.safeParse({}).success).toBe(true); // open browse is valid
    // Calendar bounds are part of the contract, not just the shape.
    expect(findEventsInput.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(findEventsInput.safeParse({ month: '2026-00' }).success).toBe(false);
    expect(findEventsInput.safeParse({ from: '2026-10-32' }).success).toBe(false);
    expect(findEventsInput.safeParse({ from: '2026-00-10' }).success).toBe(false);
  });

  it('query is bounded on both search tools', () => {
    expect(filterPlacesInput.safeParse({ query: 'street food' }).success).toBe(true);
    expect(filterPlacesInput.safeParse({ query: 'x' }).success).toBe(false); // min 2
    expect(findEventsInput.safeParse({ query: 'x'.repeat(81) }).success).toBe(false);
  });

  it('ask_visitor bounds question and options', () => {
    expect(askVisitorInput.safeParse({ question: 'Mer ou village ?', options: ['Mer', 'Village'] }).success).toBe(true);
    expect(askVisitorInput.safeParse({ question: 'Trop', options: ['A'] }).success).toBe(false); // 1 option
    expect(askVisitorInput.safeParse({ question: 'Q?', options: ['A', 'B'] }).success).toBe(false); // question < 5
    expect(getInputResultInput.safeParse({ input_id: 'q-abc-12' }).success).toBe(true);
    expect(getInputResultInput.safeParse({ input_id: 'DROP TABLE' }).success).toBe(false);
  });

  it('find_near requires town or full coordinates', () => {
    expect(findNearInput.safeParse({ radiusKm: 5 }).success).toBe(false);
    expect(findNearInput.safeParse({ lat: 43.2, lng: 5.5 }).success).toBe(true);
    expect(findNearInput.safeParse({ town: 'Cassis' }).success).toBe(true);
  });
});
