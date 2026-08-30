/**
 * Security audit 30 Aug: the token bucket is the only abuse brake on the
 * public endpoints, so its IP source must prefer the proxy-set single-valued
 * header, and a full bucket map must evict one entry — a global clear()
 * would un-throttle everyone at once.
 */

import { allowRequest, clientIpOf } from '@/lib/rate-limit';

describe('clientIpOf', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const h = new Headers({
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1, 203.0.113.9',
    });
    expect(clientIpOf(h)).toBe('203.0.113.9');
  });

  it('falls back to leftmost x-forwarded-for, then unknown', () => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
    expect(clientIpOf(new Headers())).toBe('unknown');
  });
});

describe('allowRequest', () => {
  it('throttles a single ip after its bucket drains', () => {
    const ip = 'test-throttle-ip';
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (allowRequest(ip)) allowed += 1;
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(60);
    expect(allowRequest(ip)).toBe(false);
  });

  it('evicts oldest entries at the cap, never everyone at once', () => {
    // Fill close to the 10k cap with old keys, THEN throttle the victim so
    // its bucket is among the newest, then push past the cap. The old code
    // called buckets.clear() at the cap, handing the throttled caller a
    // fresh bucket; eviction-of-oldest must keep the recent throttle alive.
    for (let i = 0; i < 9_990; i++) allowRequest(`flood-a-${i}`);
    const ip = 'test-survivor-ip';
    for (let i = 0; i < 100; i++) allowRequest(ip);
    expect(allowRequest(ip)).toBe(false);
    for (let i = 0; i < 200; i++) allowRequest(`flood-b-${i}`);
    expect(allowRequest(ip)).toBe(false);
  });
});
