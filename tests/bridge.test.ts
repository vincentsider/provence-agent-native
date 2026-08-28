/**
 * GeoTravel bridge internals (issue #610): UA detection must match the
 * destination Worker's families, the payload must be the exact
 * CrawlerEventRequest shape, and the forward limiter must brake a
 * spoofed-UA flood without starving legitimate traffic.
 */

import {
  allowForward,
  buildCrawlerEvent,
  detectAgent,
  resetForwardBucket,
} from '@/lib/bridge';

describe('detectAgent', () => {
  it.each([
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'chatgpt_user', 'openai'],
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2)', 'gptbot', 'openai'],
    ['Mozilla/5.0 (compatible; Claude-User/1.0)', 'claude_user', 'anthropic'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'claudebot', 'anthropic'],
    ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'perplexity', 'perplexity'],
  ])('%s → %s/%s', (ua, type, provider) => {
    expect(detectAgent(ua)).toEqual({ type, provider });
  });

  it('specific OpenAI agents win over the generic GPTBot pattern', () => {
    expect(detectAgent('GPTBot ChatGPT-User')?.type).toBe('chatgpt_user');
  });

  it('ignores humans and empty UAs', () => {
    expect(detectAgent('Mozilla/5.0 (Macintosh) Safari/605.1')).toBeNull();
    expect(detectAgent('')).toBeNull();
  });
});

describe('buildCrawlerEvent', () => {
  it('produces the exact CrawlerEventRequest field set', () => {
    const event = buildCrawlerEvent(
      {
        hostname: 'webmcp.myprovence.fr',
        pathname: '/agenda',
        search: '?v=2',
        method: 'GET',
        userAgent: 'x'.repeat(600),
        country: 'FR',
        referrer: null,
      },
      { type: 'chatgpt_user', provider: 'openai' },
      new Date('2026-08-29T10:00:00Z'),
    );
    expect(Object.keys(event).sort()).toEqual([
      'bot_provider', 'bot_type', 'client_country', 'content_type', 'hostname',
      'http_method', 'path', 'query_string', 'referrer', 'status_code',
      'timestamp', 'user_agent',
    ]);
    expect(event.query_string).toBe('v=2');
    expect(event.user_agent).toHaveLength(500);
    expect(event.timestamp).toBe('2026-08-29T10:00:00.000Z');
  });

  it('empty search becomes null, matching the Worker payload', () => {
    const event = buildCrawlerEvent(
      { hostname: 'h', pathname: '/', search: '', method: 'GET', userAgent: 'u', country: null, referrer: null },
      { type: 'gptbot', provider: 'openai' },
      new Date(0),
    );
    expect(event.query_string).toBeNull();
  });
});

describe('allowForward', () => {
  beforeEach(() => resetForwardBucket());

  it('brakes a burst at the cap and refills with time', () => {
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 500; i++) if (allowForward(t0)) allowed += 1;
    expect(allowed).toBe(120);
    expect(allowForward(t0)).toBe(false);
    // 30s later half the bucket is back.
    let refilled = 0;
    for (let i = 0; i < 500; i++) if (allowForward(t0 + 30_000)) refilled += 1;
    expect(refilled).toBe(60);
  });
});
