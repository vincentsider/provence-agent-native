/**
 * GET paging contract (raised 1 Sep after a fetch agent called a
 * 20-of-1164 sample "not an answer"): the public /api routes accept
 * limit up to 100 and page with offset, and /agenda publishes exactly
 * that pattern as a clickable link — so this must never regress.
 */

import { parseEventsParams, parsePlacesParams } from '@/lib/api-params';

const qs = (s: string) => new URLSearchParams(s);

describe('GET paging limits', () => {
  it('events accept limit=100 with offset, reject 101', () => {
    const ok = parseEventsParams(qs('month=2026-09&limit=100&offset=100'));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.limit).toBe(100);
      expect(ok.value.offset).toBe(100);
    }
    expect(parseEventsParams(qs('month=2026-09&limit=101')).ok).toBe(false);
  });

  it('places accept the published family-outings example at limit=100', () => {
    const ok = parsePlacesParams(qs('cluster=loisirs&town=Marseille&tag=familles&limit=100'));
    expect(ok.ok).toBe(true);
    expect(parsePlacesParams(qs('cluster=loisirs&limit=101')).ok).toBe(false);
  });
});
