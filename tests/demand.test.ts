/**
 * Demand log: bounded memory (ring cap), zero-result surfacing, and clean
 * teardown (no timers or listeners left behind).
 */

import { DemandLog } from '@/lib/demand';

describe('DemandLog', () => {
  it('caps the ring buffer at 200 entries', () => {
    const log = new DemandLog(false);
    for (let i = 0; i < 500; i++) log.record('filter_places', { i }, i, 1);
    expect(log.getSnapshot()).toHaveLength(200);
    // Oldest dropped, newest kept.
    expect(log.getSnapshot().at(-1)?.total).toBe(499);
    log.destroy();
  });

  it('surfaces zero-result entries', () => {
    const log = new DemandLog(false);
    log.record('filter_places', { tags: ['piscine'] }, 12, 1);
    log.record('filter_places', { tags: ['piscine', 'parking'] }, 0, 1);
    expect(log.zeroResults()).toHaveLength(1);
    expect(log.zeroResults()[0]?.args).toEqual({ tags: ['piscine', 'parking'] });
    log.destroy();
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const log = new DemandLog(false);
    let calls = 0;
    const unsub = log.subscribe(() => calls++);
    log.record('t', {}, 1, 0);
    expect(calls).toBe(1);
    unsub();
    log.record('t', {}, 1, 0);
    expect(calls).toBe(1);
    log.destroy();
  });

  it('destroy is idempotent', () => {
    const log = new DemandLog(false);
    log.destroy();
    log.destroy();
  });
});
