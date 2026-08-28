/**
 * Elicitation store (issue #608): the hybrid contract under fake timers.
 */

import { ElicitationStore } from '@/lib/elicitation';
import { SignalsLog } from '@/lib/signals';

describe('ElicitationStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves on the visitor tap with the MCP-elicitation shape', async () => {
    const store = new ElicitationStore();
    const { id, promise } = store.ask('Plutôt mer ou village ?', ['Mer', 'Village']);
    store.answer(id, 'Mer');
    await expect(promise).resolves.toMatchObject({
      status: 'answered',
      action: 'accept',
      choice: 'Mer',
    });
    store.destroy();
  });

  it('degrades to a pending ticket at the block ceiling and NEVER rejects', async () => {
    const store = new ElicitationStore();
    const { id, promise } = store.ask('Question lente ?', ['A', 'B']);
    jest.advanceTimersByTime(45_001);
    const r = await promise;
    expect(r.status).toBe('pending');
    expect(r.instruction).toContain(id);
    // The cards stayed; a late tap still lands and get_input_result sees it.
    store.answer(id, 'B');
    expect(store.result(id)).toMatchObject({ status: 'answered', choice: 'B' });
    store.destroy();
  });

  it('dedups a normalized-identical question onto the same ticket', () => {
    const store = new ElicitationStore();
    const a = store.ask('Plutôt MER ou village ?', ['Mer', 'Village']);
    const b = store.ask('plutôt mer ou village ?', ['Mer', 'Village']);
    expect(b.id).toBe(a.id);
    expect(store.getSnapshot()).toHaveLength(1);
    store.destroy();
  });

  it('abort dismisses: cards torn down, status dismissed', async () => {
    const store = new ElicitationStore();
    const controller = new AbortController();
    const { id, promise } = store.ask('On annule ?', ['Oui', 'Non'], controller.signal);
    controller.abort();
    await expect(promise).resolves.toMatchObject({ status: 'dismissed', action: 'cancel' });
    expect(store.getSnapshot()).toHaveLength(0);
    expect(store.result(id).status).toBe('dismissed');
    store.destroy();
  });

  it('a decline is remembered so the agent can respect it', async () => {
    const store = new ElicitationStore();
    const { id, promise } = store.ask('Encore une question ?', ['Oui', 'Non']);
    store.decline(id);
    await expect(promise).resolves.toMatchObject({ status: 'dismissed', action: 'decline' });
    store.destroy();
  });

  it('bounds concurrent questions: the oldest yields its slot', () => {
    const store = new ElicitationStore();
    const first = store.ask('Q1 ?', ['a', 'b']);
    store.ask('Q2 ?', ['a', 'b']);
    store.ask('Q3 ?', ['a', 'b']);
    store.ask('Q4 ?', ['a', 'b']);
    expect(store.getSnapshot()).toHaveLength(3);
    expect(store.result(first.id).status).toBe('dismissed');
    store.destroy();
  });

  it('unknown ticket answers dismissed, never throws', () => {
    const store = new ElicitationStore();
    expect(store.result('q-nope').status).toBe('dismissed');
    store.destroy();
  });
});

describe('SignalsLog', () => {
  it('drainForAgent returns only what arrived since the previous read', () => {
    const log = new SignalsLog();
    log.addPing('plus-comme-ca', 43.2, 5.5);
    log.toggleLock(42);
    const first = log.drainForAgent();
    expect(first.newSignals).toHaveLength(2);
    expect(first.locks).toEqual([42]);
    const second = log.drainForAgent();
    expect(second.newSignals).toHaveLength(0);
    expect(second.locks).toEqual([42]); // durable state always included
    log.addYield();
    expect(log.drainForAgent().newSignals).toHaveLength(1);
    log.destroy();
  });

  it('drain survives ring overflow without replaying old events', () => {
    const log = new SignalsLog();
    log.addYield();
    log.drainForAgent();
    for (let i = 0; i < 150; i++) log.toggleLock(i);
    const drained = log.drainForAgent();
    expect(drained.newSignals.length).toBeLessThanOrEqual(100);
    log.destroy();
  });

  it('caps pings at 20, keeps toggle semantics for locks, rounds coordinates', () => {
    const log = new SignalsLog();
    for (let i = 0; i < 30; i++) log.addPing('question', 43.123456789, 5.1);
    expect(log.pings()).toHaveLength(20);
    expect(log.pings()[0]!.lat).toBe(43.12346);
    expect(log.toggleLock(7)).toBe(true);
    expect(log.toggleLock(7)).toBe(false);
    expect(log.lockedIds()).toEqual([]);
    log.destroy();
  });
});
