/**
 * GeoTravel bridge internals (issue #610), extracted from the middleware so
 * the pure parts are unit-testable: agent-UA detection, the outbound-forward
 * token bucket, and the CrawlerEventRequest payload builder.
 *
 * The forward limiter exists because the trigger is an attacker-controlled
 * header: anyone can spoof "ChatGPT-User" and every match costs an outbound
 * POST to the Railway API. Per-instance, best-effort — the same posture as
 * the other public-endpoint brakes in this repo.
 */

export interface AgentMatch {
  readonly type: string;
  readonly provider: string;
}

/** Same bot families as the destination's own Cloudflare Worker (specific first). */
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

export function detectAgent(userAgent: string): AgentMatch | null {
  if (!userAgent) return null;
  const hit = AI_PATTERNS.find((p) => p.pattern.test(userAgent));
  return hit ? { type: hit.type, provider: hit.provider } : null;
}

/** Global cap on outbound forwards, refilled continuously. */
const FORWARD_CAP = 120; // per minute per instance
const REFILL_PER_MS = FORWARD_CAP / 60_000;
let forwardTokens = FORWARD_CAP;
let forwardAt = 0;

export function allowForward(now: number): boolean {
  forwardTokens = Math.min(FORWARD_CAP, forwardTokens + (now - forwardAt) * REFILL_PER_MS);
  forwardAt = now;
  if (forwardTokens < 1) return false;
  forwardTokens -= 1;
  return true;
}

/** Test seam only. */
export function resetForwardBucket(): void {
  forwardTokens = FORWARD_CAP;
  forwardAt = 0;
}

export interface BridgeRequestInfo {
  readonly hostname: string;
  readonly pathname: string;
  readonly search: string;
  readonly method: string;
  readonly userAgent: string;
  readonly country: string | null;
  readonly referrer: string | null;
}

/** Exact CrawlerEventRequest shape (backend crawler_analytics.py). */
export function buildCrawlerEvent(info: BridgeRequestInfo, match: AgentMatch, now: Date) {
  return {
    hostname: info.hostname,
    path: info.pathname,
    query_string: info.search ? info.search.slice(1) : null,
    http_method: info.method,
    // The reference Worker reports before fetch() resolves too.
    status_code: 200,
    content_type: null,
    bot_type: match.type,
    bot_provider: match.provider,
    user_agent: info.userAgent.slice(0, 500),
    client_country: info.country,
    referrer: info.referrer,
    timestamp: now.toISOString(),
  };
}
