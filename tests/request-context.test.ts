/**
 * Field feedback 1 Sep, three behaviors pinned:
 *  - a new agent search RETIRES the running mission (banner/flags follow the
 *    current request), verdicts intact and restorable;
 *  - the carnet clusters keeps per REQUEST, not one undifferentiated pile;
 *  - the agent-context label is bounded and null-safe.
 */

import { ScoutMissionStore, type Mission } from '@/lib/scouts';
import { buildDefaultCarnet } from '@/lib/carnet';
import { getAgentRequest, setAgentRequest } from '@/lib/agent-context';
import type { ShortlistItem } from '@/lib/shortlist';

const mission = (id: string, text: string, towns: string[] = []): Mission => ({
  missionId: id,
  mission: text,
  reports: [{ scoutId: 's1', label: 'l1', total: 1, findings: [], verdicts: { 7: 'kept' } }],
  towns,
});

describe('ScoutMissionStore.retire', () => {
  it('archives the active mission, verdicts intact, restorable', () => {
    const store = new ScoutMissionStore();
    store.start(mission('m1', 'week-end romantique'));
    store.retire();
    expect(store.getSnapshot()).toBeNull();
    expect(store.history()[0]?.missionId).toBe('m1');
    expect(store.history()[0]?.reports[0]?.verdicts[7]).toBe('kept');
    expect(store.restore('m1')?.missionId).toBe('m1');
    store.destroy();
  });

  it('retireIfIdle spares a fresh mission and a mission being judged', () => {
    const store = new ScoutMissionStore();
    store.start(mission('m1', 'week-end romantique'));
    const t0 = Date.now();
    // The agent's refinement search lands seconds later: mission stays.
    expect(store.retireIfIdle(120_000, t0 + 5_000)).toBe(false);
    expect(store.getSnapshot()).not.toBeNull();
    // A verdict tap resets the idle clock.
    store.setVerdict(7, 'kept');
    expect(store.retireIfIdle(120_000, t0 + 60_000)).toBe(false);
    // Idle past the grace: a new request may take the stage.
    expect(store.retireIfIdle(120_000, Date.now() + 180_000)).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    store.destroy();
  });

  it('retireForNewContext: a different town retires NOW, same town waits for idle', () => {
    const store = new ScoutMissionStore();
    store.start(mission('m1', 'séjour à Tarascon', ['tarascon']));
    // Same town seconds later: a refinement, mission stays.
    expect(store.retireForNewContext('Tarascon')).toBe(false);
    expect(store.getSnapshot()).not.toBeNull();
    // Town-less search inside the grace: also spared.
    expect(store.retireForNewContext(undefined)).toBe(false);
    // A DIFFERENT town is a context switch: retires immediately, no grace.
    expect(store.retireForNewContext('Marseille')).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    store.destroy();
  });

  it('retireForNewContext falls back to the idle grace for town-less missions', () => {
    const store = new ScoutMissionStore();
    store.start(mission('m1', 'week-end romantique'));
    expect(store.retireForNewContext('Marseille')).toBe(false); // fresh, no mission towns
    expect(store.retireForNewContext('Marseille', Date.now() + 180_000)).toBe(true);
    store.destroy();
  });

  it('is a no-op with nothing on stage and never duplicates history', () => {
    const store = new ScoutMissionStore();
    store.retire();
    expect(store.history()).toHaveLength(0);
    store.start(mission('m1', 'a'));
    store.retire();
    store.retire();
    expect(store.history().filter((m) => m.missionId === 'm1')).toHaveLength(1);
    store.destroy();
  });
});

describe('buildDefaultCarnet request clustering', () => {
  const item = (id: number, request: string | null, d1: string | null = null): ShortlistItem => ({
    id,
    name: `p${id}`,
    town: 'Cassis',
    url: 'https://www.myprovence.fr/x',
    d1,
    d2: null,
    request,
  });

  it('groups one section per request, in exploration order', () => {
    const carnet = buildDefaultCarnet(
      [item(1, 'week-end romantique'), item(2, 'ce soir à Marseille'), item(3, 'week-end romantique')],
      'title',
      'anytime',
      (iso) => iso,
    );
    expect(carnet.days.map((d) => d.label)).toEqual(['week-end romantique', 'ce soir à Marseille']);
    expect(carnet.days[0]!.items.map((i) => i.id)).toEqual([1, 3]);
    expect(carnet.days[1]!.items.map((i) => i.id)).toEqual([2]);
  });

  it('sends request-less keeps to the anytime section', () => {
    const carnet = buildDefaultCarnet(
      [item(1, 'ce soir'), item(2, null)],
      'title',
      'anytime',
      (iso) => iso,
    );
    expect(carnet.days.map((d) => d.label)).toEqual(['ce soir', 'anytime']);
  });

  it('keeps the day-grouped layout when no item carries a request', () => {
    const carnet = buildDefaultCarnet(
      [item(1, null, '2026-09-05'), item(2, null)],
      'title',
      'anytime',
      (iso) => `day:${iso}`,
    );
    expect(carnet.days.map((d) => d.label)).toEqual(['day:2026-09-05', 'anytime']);
  });
});

describe('agent-context label', () => {
  it('trims, bounds at 80 chars, and nulls out empties', () => {
    setAgentRequest(`  ${'x'.repeat(120)}  `);
    expect(getAgentRequest()!.length).toBeLessThanOrEqual(80);
    setAgentRequest('   ');
    expect(getAgentRequest()).toBeNull();
    setAgentRequest(null);
    expect(getAgentRequest()).toBeNull();
  });
});
