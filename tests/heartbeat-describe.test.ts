/**
 * describeContext is what a cooperating agent reads BEFORE any tool call
 * (description-as-heartbeat). Wish box v4: the page no longer dispatches
 * scouts, so a wish with no mission must tell the agent to act, and a live
 * mission must never be described as the page's own doing.
 */

import { describeContext } from '@/webmcp/heartbeat';
import type { Mission } from '@/lib/scouts';

const mission: Mission = {
  missionId: 'm-test',
  mission: 'un séjour à Cassis',
  reports: [
    { scoutId: 's1', label: 'hôtels à Cassis', total: 3, findings: [], verdicts: {} },
    { scoutId: 's2', label: "l'agenda", total: 0, findings: [], verdicts: {} },
  ],
};

describe('describeContext', () => {
  it('tells the agent to send scouts when a wish has no mission yet', () => {
    const d = describeContext({ wish: 'un hôtel près de la mer', mission: null, kept: [] });
    expect(d).toContain('un hôtel près de la mer');
    expect(d).toContain('call send_scouts');
  });

  it('drops the nudge once a mission is out and lists the scout labels', () => {
    const d = describeContext({ wish: 'un hôtel près de la mer', mission, kept: [] });
    expect(d).not.toContain('call send_scouts');
    expect(d).toContain('2 scouts are already out');
    expect(d).toContain('hôtels à Cassis');
  });

  it('stays under the 950-char registration budget with maximal state', () => {
    const d = describeContext({
      wish: 'x'.repeat(400),
      mission,
      kept: Array.from({ length: 9 }, (_, i) => ({
        id: i,
        name: `Résidence au très long nom numéro ${i}`,
        town: 'Cassis',
        url: 'https://www.myprovence.fr/x',
        image: null,
        summary: '',
      })) as never,
    });
    expect(d.length).toBeLessThanOrEqual(950);
  });
});
