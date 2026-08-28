/**
 * GeoTravel bridge (issue #610): AI-agent visits to this demo land in the
 * destination's existing crawler-analytics workspace.
 *
 * Grounded on the real backend: POST {GEOTRAVEL_API_URL}/v1/crawler/events,
 * header X-API-Key (workspace key), CrawlerEventRequest payload; property is
 * matched by hostname server-side (crawler_analytics.py:554). The reference
 * Cloudflare Worker fires BEFORE fetch(), so reporting before the response
 * with status 200 matches the platform's own practice.
 *
 * Safety rules: entirely env-gated (no envs => total no-op, so public forks
 * and CI never call anything), fire-and-forget via event.waitUntil with a
 * 2s abort, and a thrown error can never affect the visitor's response.
 * Privacy: the payload carries UA-derived bot identity and the path — the
 * same fields the destination's own Worker already reports for its site.
 */

import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

/** Same bot families as the destination's Worker snippet (specific first). */
const AI_PATTERNS: ReadonlyArray<{ pattern: RegExp; type: string; provider: string }> = [
  { pattern: /ChatGPT-User/i, type: 'chatgpt_user', provider: 'openai' },
  { pattern: /OAI-SearchBot/i, type: 'oai_search', provider: 'openai' },
  { pattern: /GPTBot/i, type: 'gptbot', provider: 'openai' },
  { pattern: /Claude-User/i, type: 'claude_user', provider: 'anthropic' },
  { pattern: /Claude-Web/i, type: 'claude_web', provider: 'anthropic' },
  { pattern: /Claude-SearchBot/i, type: 'claude_search', provider: 'anthropic' },
  { pattern: /ClaudeBot|anthropic-ai/i, type: 'claudebot', provider: 'anthropic' },
  { pattern: /NotebookLM/i, type: 'notebooklm', provider: 'google' },
  { pattern: /Google-Extended/i, type: 'google_extended', provider: 'google' },
  { pattern: /Gemini/i, type: 'gemini_research', provider: 'google' },
  { pattern: /PerplexityBot|Perplexity-User/i, type: 'perplexity', provider: 'perplexity' },
  { pattern: /Bytespider/i, type: 'bytespider', provider: 'bytedance' },
  { pattern: /meta-externalagent/i, type: 'meta_external', provider: 'meta' },
];

export function middleware(request: NextRequest, event: NextFetchEvent): NextResponse {
  const apiUrl = process.env.GEOTRAVEL_API_URL;
  const apiKey = process.env.GEOTRAVEL_CRAWLER_API_KEY;
  if (apiUrl && apiKey) {
    try {
      const ua = request.headers.get('user-agent') ?? '';
      const match = AI_PATTERNS.find((p) => p.pattern.test(ua));
      if (match) {
        const body = JSON.stringify({
          hostname: request.nextUrl.hostname,
          path: request.nextUrl.pathname,
          query_string: request.nextUrl.search ? request.nextUrl.search.slice(1) : null,
          http_method: request.method,
          // The reference Worker reports before fetch() resolves too.
          status_code: 200,
          content_type: null,
          bot_type: match.type,
          bot_provider: match.provider,
          user_agent: ua.slice(0, 500),
          client_country: request.headers.get('x-vercel-ip-country'),
          referrer: request.headers.get('referer'),
          timestamp: new Date().toISOString(),
        });
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
