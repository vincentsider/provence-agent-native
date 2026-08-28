/**
 * GeoTravel bridge (issue #610): AI-agent visits to this demo land in the
 * destination's existing crawler-analytics workspace.
 *
 * Grounded on the real backend: POST {GEOTRAVEL_API_URL}/v1/crawler/events,
 * header X-API-Key (workspace key), CrawlerEventRequest payload; property is
 * matched by hostname server-side. The reference Cloudflare Worker fires
 * BEFORE fetch(), so reporting before the response with status 200 matches
 * the platform's own practice.
 *
 * Safety rules: entirely env-gated (no envs => total no-op, so public forks
 * and CI never call anything), a per-instance token bucket caps outbound
 * forwards (the trigger is a spoofable header), fire-and-forget via
 * event.waitUntil with a 2s abort, and a thrown error can never affect the
 * visitor's response. Privacy: UA-derived bot identity and the path — the
 * same fields the destination's own Worker already reports. No client IP.
 */

import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { allowForward, buildCrawlerEvent, detectAgent } from '@/lib/bridge';

export function middleware(request: NextRequest, event: NextFetchEvent): NextResponse {
  const apiUrl = process.env.GEOTRAVEL_API_URL;
  const apiKey = process.env.GEOTRAVEL_CRAWLER_API_KEY;
  if (apiUrl && apiKey) {
    try {
      const ua = request.headers.get('user-agent') ?? '';
      const match = detectAgent(ua);
      if (match && allowForward(Date.now())) {
        const body = JSON.stringify(
          buildCrawlerEvent(
            {
              hostname: request.nextUrl.hostname,
              pathname: request.nextUrl.pathname,
              search: request.nextUrl.search,
              method: request.method,
              userAgent: ua,
              country: request.headers.get('x-vercel-ip-country'),
              referrer: request.headers.get('referer'),
            },
            match,
            new Date(),
          ),
        );
        event.waitUntil(
          fetch(`${apiUrl}/v1/crawler/events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
              'X-Workspace-Domain': request.nextUrl.hostname,
            },
            body,
            signal: AbortSignal.timeout(2_000),
          }).catch(() => {
            /* telemetry must never matter to the visitor */
          }),
        );
      }
    } catch {
      /* never let the bridge touch the response */
    }
  }
  return NextResponse.next();
}

export const config = {
  // Pages and agent surfaces; static assets and data files stay out.
  matcher: ['/', '/fr', '/en', '/agenda', '/fr/agenda', '/en/agenda', '/events', '/llms.txt', '/api/:path*'],
};
