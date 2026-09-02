/**
 * PresenceBus (issue #607): bounded, unsubscribable, destroyable, and the
 * intent lines stay short and factual (anti-Clippy: one intent per action).
 */

import { PresenceBus, intentFor, setPresenceLocale } from '@/lib/presence';

describe('PresenceBus', () => {
  it('caps the ring at 100 events and keeps the newest', () => {
    const bus = new PresenceBus();
    for (let i = 0; i < 250; i++) bus.emit({ phase: 'done', tool: `t${i}`, at: i });
    expect(bus.getSnapshot()).toHaveLength(100);
    expect(bus.last()).toMatchObject({ tool: 't249' });
    bus.destroy();
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const bus = new PresenceBus();
    let n = 0;
    const un = bus.subscribe(() => n++);
    bus.emit({ phase: 'yield' });
    expect(n).toBe(1);
    un();
    bus.emit({ phase: 'yield' });
    expect(n).toBe(1);
    bus.destroy();
  });

  it('destroy is idempotent and clears state', () => {
    const bus = new PresenceBus();
    bus.emit({ phase: 'yield' });
    bus.destroy();
    bus.destroy();
    expect(bus.getSnapshot()).toHaveLength(0);
    expect(bus.last()).toBeNull();
  });

  it('preserves variant payloads (the distributive-omit regression)', () => {
    const bus = new PresenceBus();
    bus.emit({ phase: 'act', tool: 'find_near', center: { lat: 43.2, lng: 5.5 }, radiusKm: 15 });
    const e = bus.last();
    expect(e).toMatchObject({ phase: 'act', radiusKm: 15 });
    bus.destroy();
  });
});

describe('intentFor', () => {
  afterEach(() => setPresenceLocale('fr'));

  it('speaks the page language (field bug 2 Sep: French bubbles on the EN site)', () => {
    setPresenceLocale('en');
    expect(intentFor('find_tonight', { town: 'Marseille' })).toBe(
      "checking what's on tonight in Marseille",
    );
    expect(intentFor('send_scouts', { scouts: [1, 2, 3] })).toBe('sending 3 scouts across the map');
    setPresenceLocale('fr');
    expect(intentFor('find_tonight', { town: 'Marseille' })).toContain('ce soir à Marseille');
    // Unknown locales fall back to French, never to broken output.
    setPresenceLocale('de');
    expect(intentFor('get_place', {})).toBe('je lis une fiche');
  });

  it('is specific when the args are', () => {
    expect(intentFor('filter_places', { tags: ['parking'], town: 'Cassis' })).toContain('Cassis');
    expect(intentFor('find_events', { month: '2026-10' })).toContain('2026-10');
    expect(intentFor('find_near', { town: 'Arles' })).toContain('Arles');
  });

  it('never exceeds one short line', () => {
    for (const tool of ['filter_places', 'find_events', 'find_near', 'get_place', 'unknown_tool']) {
      const line = intentFor(tool, { query: 'x'.repeat(200), tags: ['a'.repeat(64)] });
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).not.toContain('\n');
    }
  });
});
