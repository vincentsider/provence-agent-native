/**
 * URL-query parsing for the fetch-only agent APIs (/api/events, /api/places).
 * Pure and unit-tested: URLSearchParams in, the SAME zod-validated inputs the
 * WebMCP tools take out, so all surfaces share one contract and one set of
 * bounds. Unknown parameters are rejected by name — the strict-schema
 * posture of the tools, kept at the HTTP boundary.
 */

import type { z } from 'zod';
import { filterPlacesInput, findEventsInput } from '@/webmcp/schemas';

export type ParamsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues?: Array<{ path: string; message: string }> };

const EVENT_KEYS = new Set(['query', 'month', 'from', 'to', 'category', 'town', 'tag', 'limit', 'offset']);
const PLACE_KEYS = new Set(['query', 'cluster', 'tag', 'anyTag', 'town', 'minGrade', 'limit', 'offset']);

function reject<T>(error: string, issues?: Array<{ path: string; message: string }>): ParamsResult<T> {
  return { ok: false, error, issues };
}

function unknownKeys(params: URLSearchParams, allowed: ReadonlySet<string>): string[] {
  return [...new Set([...params.keys()])].filter((k) => !allowed.has(k));
}

function num(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function parseEventsParams(
  params: URLSearchParams,
): ParamsResult<z.output<typeof findEventsInput>> {
  const unknown = unknownKeys(params, EVENT_KEYS);
  if (unknown.length > 0) {
    return reject(`unknown parameter(s): ${unknown.join(', ')}`);
  }
  const parsed = findEventsInput.safeParse({
    query: params.get('query') ?? undefined,
    month: params.get('month') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    category: params.get('category') ?? undefined,
    town: params.get('town') ?? undefined,
    tags: params.getAll('tag').length > 0 ? params.getAll('tag') : undefined,
    limit: num(params, 'limit'),
    offset: num(params, 'offset'),
  });
  if (!parsed.success) {
    return reject('invalid parameters', parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })));
  }
  return { ok: true, value: parsed.data };
}

export function parsePlacesParams(
  params: URLSearchParams,
): ParamsResult<z.output<typeof filterPlacesInput>> {
  const unknown = unknownKeys(params, PLACE_KEYS);
  if (unknown.length > 0) {
    return reject(`unknown parameter(s): ${unknown.join(', ')}`);
  }
  const parsed = filterPlacesInput.safeParse({
    query: params.get('query') ?? undefined,
    cluster: params.get('cluster') ?? undefined,
    town: params.get('town') ?? undefined,
    minGrade: num(params, 'minGrade'),
    tags: params.getAll('tag').length > 0 ? params.getAll('tag') : undefined,
    anyTags: params.getAll('anyTag').length > 0 ? params.getAll('anyTag') : undefined,
    limit: num(params, 'limit'),
    offset: num(params, 'offset'),
  });
  if (!parsed.success) {
    return reject('invalid parameters', parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })));
  }
  return { ok: true, value: parsed.data };
}
