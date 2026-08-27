/**
 * SSRF-guarded, robots-respecting, disk-cached fetcher (spec 8.8).
 *
 * - Host allowlist of exactly www.myprovence.fr; redirects followed manually
 *   and only same-host (max 3).
 * - Private/loopback/link-local ranges rejected after DNS resolution, before
 *   connect (same posture as backend/src/agent_readiness/ssrf_guard.py in the
 *   geotravel repo).
 * - robots.txt honoured: /api/poi is disallowed there and refused here;
 *   Crawl-delay: 1 respected between network fetches (cache hits skip it).
 * - Responses cached to ingest/.cache so re-runs do not re-fetch.
 */

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

import { CANONICAL_HOST } from '../src/lib/types';

const USER_AGENT =
  'GeoTravelAgentReadiness/1.0 (+https://geotravel.ai; catalogue snapshot for the agent-native demo)';
const CACHE_DIR = path.join(__dirname, '.cache');
const CRAWL_DELAY_MS = 1_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 3_000_000;

/** Paths disallowed by the site's robots.txt that this job could plausibly hit. */
const ROBOTS_DISALLOWED_PREFIXES = ['/api/poi', '/admin/', '/core/', '/search/', '/user/'];

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase();
    return (
      low === '::1' ||
      low.startsWith('fe80:') ||
      low.startsWith('fc') ||
      low.startsWith('fd') ||
      low.startsWith('::ffff:127.') ||
      low.startsWith('::ffff:10.') ||
      low.startsWith('::ffff:192.168.')
    );
  }
  const parts = ip.split('.').map(Number);
  const [a, b] = [parts[0] ?? 0, parts[1] ?? 0];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicHost(host: string): Promise<void> {
  const results = await lookup(host, { all: true });
  for (const { address } of results) {
    if (isPrivateIp(address)) {
      throw new Error(`SSRF guard: ${host} resolves to private address ${address}`);
    }
  }
}

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'https:') throw new Error(`refusing non-https URL: ${url}`);
  if (url.hostname !== CANONICAL_HOST) {
    throw new Error(`refusing off-host URL: ${url.hostname} (allowlist: ${CANONICAL_HOST})`);
  }
  for (const prefix of ROBOTS_DISALLOWED_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      throw new Error(`refusing robots-disallowed path: ${url.pathname}`);
    }
  }
}

let lastNetworkFetch = 0;

async function politeDelay(): Promise<void> {
  const wait = lastNetworkFetch + CRAWL_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNetworkFetch = Date.now();
}

export interface FetchStats {
  network: number;
  cached: number;
}

export const fetchStats: FetchStats = { network: 0, cached: 0 };

export async function fetchCached(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  assertAllowedUrl(url);

  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash('sha1').update(url.toString()).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    const cached = await readFile(cachePath, 'utf-8');
    fetchStats.cached += 1;
    return cached;
  } catch {
    // Not cached; fall through to the network.
  }

  await assertPublicHost(url.hostname);

  let current = url;
  for (let redirects = 0; ; redirects++) {
    await politeDelay();
    const res = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    fetchStats.network += 1;

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || redirects >= MAX_REDIRECTS) {
        throw new Error(`redirect dead end at ${current} (${res.status})`);
      }
      const next = new URL(loc, current);
      assertAllowedUrl(next); // same-host only; off-host redirects are refused
      current = next;
      continue;
    }
    if (!res.ok) throw new Error(`GET ${current} -> ${res.status}`);

    const body = await res.text();
    if (Buffer.byteLength(body, 'utf-8') > MAX_BODY_BYTES) {
      throw new Error(`response too large from ${current}`);
    }
    await writeFile(cachePath, body, 'utf-8');
    return body;
  }
}
