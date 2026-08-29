/** Le carnet de voyage (29 Aug): grounding and day-grouping rules. */

import { buildDefaultCarnet, composeCarnet } from '@/lib/carnet';
import type { ShortlistItem } from '@/lib/shortlist';

const item = (id: number, d1: string | null = null): ShortlistItem => ({
  id, name: `p${id}`, town: 'Cassis', url: 'u', d1, d2: d1, img: null, glyph: '🛏',
});

describe('composeCarnet', () => {
  it('refuses ids outside the kept selection, listing the valid ones', () => {
    const out = composeCarnet([item(1), item(2)], 'T', [
      { label: 'Samedi', itemIds: [1, 99] },
    ]);
    expect(out).toEqual({ error: 'unknown_items', unknownIds: [99], validIds: [1, 2] });
  });

  it('builds days from kept items in the agent order', () => {
    const out = composeCarnet([item(1), item(2)], 'T', [
      { label: 'Samedi', itemIds: [2], note: 'matin calme' },
      { label: 'Dimanche', itemIds: [1] },
    ], 'Bon voyage');
    if ('error' in out) throw new Error('unexpected');
    expect(out.carnet.days[0]!.items[0]!.id).toBe(2);
    expect(out.carnet.days[0]!.note).toBe('matin calme');
    expect(out.carnet.signoff).toBe('Bon voyage');
  });
});

describe('buildDefaultCarnet long-running rule', () => {
  it('a season-long activity goes to anytime, not to its opening day', () => {
    const long = { ...item(9, '2026-01-01'), d2: '2026-12-31' };
    const carnet = buildDefaultCarnet([long, item(2, '2026-09-06')], 'T', 'ANY', (iso) => iso);
    expect(carnet.days.map((d) => d.label)).toEqual(['2026-09-06', 'ANY']);
    expect(carnet.days[1]!.items[0]!.id).toBe(9);
  });
});

describe('buildDefaultCarnet', () => {
  it('groups dated items chronologically and parks places under anytime', () => {
    const carnet = buildDefaultCarnet(
      [item(1), item(2, '2026-09-06'), item(3, '2026-09-05'), item(4, '2026-09-05')],
      'T',
      'À tout moment',
      (iso) => iso,
    );
    expect(carnet.days.map((d) => d.label)).toEqual(['2026-09-05', '2026-09-06', 'À tout moment']);
    expect(carnet.days[0]!.items).toHaveLength(2);
    expect(carnet.days[2]!.items[0]!.id).toBe(1);
  });
});
