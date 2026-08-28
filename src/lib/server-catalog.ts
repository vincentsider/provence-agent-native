/**
 * Server-side catalogue for the fetch-only agent surfaces (/api/events,
 * /api/places, /agenda, /api/mcp). Loads the same content-hashed artefacts
 * the browser uses, by self-fetching this deployment's own /data files, and
 * builds the same pure indexes once per warm instance.
 *
 * Why self-fetch instead of fs: the artefacts live in public/ (never in the
 * repo, spec 13.2) and Vercel serves them from the static layer; reading
 * them over HTTP keeps one source of truth and works identically in local
 * `next start` and production. The promise is memoized per origin, so a warm
 * instance pays the load exactly once; a failure clears the memo so the next
 * request retries instead of caching an error forever.
 */

import { buildIndexes, type Indexes } from './engine';
import type { Catalog, Manifest, Vocab } from './types';

export interface ServerCatalog {
  readonly catalog: Catalog;
  readonly vocab: Vocab;
  readonly indexes: Indexes;
  readonly generatedAt: string;
}

/**
 * SECURITY: the self-fetch origin must NEVER be trusted from the request.
 * request.nextUrl.origin derives from the Host header; a spoofed Host would
 * point our server's own fetch at an attacker's /data/manifest.json (SSRF +
 * poisoned catalogue for that caller). The origin is therefore pinned to the
 * deployment's own known URLs, and the request origin is only honoured when
 * it matches one of them.
 */
export function pickDataOrigin(
  requestOrigin: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const allowed = new Set(
    [
      env.NEXT_PUBLIC_SITE_ORIGIN,
      env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
      env.VERCEL_URL && `https://${env.VERCEL_URL}`,
      env.VERCEL_BRANCH_URL && `https://${env.VERCEL_BRANCH_URL}`,
      'http://127.0.0.1:3040',
      'http://localhost:3040',
    ].filter((o): o is string => Boolean(o)),
  );
  if (allowed.has(requestOrigin)) return requestOrigin;
  // Spoofed or unexpected Host: fall back to the pinned deployment URL.
  for (const o of allowed) return o;
  return 'http://127.0.0.1:3040';
}

let cached: { origin: string; promise: Promise<ServerCatalog> } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function load(origin: string): Promise<ServerCatalog> {
  const manifest = await fetchJson<Manifest>(`${origin}/data/manifest.json`);
  const [catalog, vocab, events] = await Promise.all([
    fetchJson<Catalog>(`${origin}/data/${manifest.files.catalog}`),
    fetchJson<Vocab>(`${origin}/data/${manifest.files.vocab}`),
    manifest.files.events
      ? fetchJson<Catalog>(`${origin}/data/${manifest.files.events}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const merged: Catalog =
    events && events.places.length > 0
      ? { version: 1, places: [...catalog.places, ...events.places] }
      : catalog;
  return {
    catalog: merged,
    vocab,
    indexes: buildIndexes(merged, vocab),
    generatedAt: manifest.generatedAt,
  };
}

export function getServerCatalog(requestOrigin: string): Promise<ServerCatalog> {
  const origin = pickDataOrigin(requestOrigin);
  if (cached && cached.origin === origin) return cached.promise;
  const promise = load(origin).catch((err) => {
    // Do not memoize failures: the static layer may simply not be warm yet.
    if (cached?.promise === promise) cached = null;
    throw err;
  });
  cached = { origin, promise };
  return promise;
}
