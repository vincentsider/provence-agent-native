/**
 * Demand pulse aggregation (issue #609) vs a naive reference: 7-day window,
 * k>=3 threshold, sort, cap. Mirrors the SQL dry-run validated on the live
 * DB on 28 Aug.
 */

import { aggregatePulse, PULSE_K_THRESHOLD, type PulseRow } from '@/lib/demand-pulse';

const NOW = new Date('2026-08-28T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function row(town: string | null, zero: boolean, daysAgo: number): PulseRow {
  return {
    args_summary: town ? { town } : {},
    zero_result: zero,
    occurred_hour: iso(daysAgo),
  };
}

describe('aggregatePulse', () => {
  it('applies the k-threshold: a town below 3 requests never appears', () => {
    const rows = [
      row('Cassis', false, 1),
      row('Cassis', true, 2),
      row('Arles', false, 1),
      row('Arles', false, 2),
      row('Arles', true, 3),
    ];
    const out = aggregatePulse(rows, NOW);
    expect(out.towns.map((t) => t.town)).toEqual(['Arles']);
    expect(out.towns[0]).toMatchObject({ count: 3, zeroCount: 1 });
    expect(PULSE_K_THRESHOLD).toBe(3);
  });

  it('excludes rows outside the 7-day window but counts them nowhere', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row('Sault', true, i + 1)),
      row('Sault', true, 9),
      row('Sault', true, 10),
    ];
    const out = aggregatePulse(rows, NOW);
    expect(out.towns[0]).toMatchObject({ town: 'Sault', count: 4, zeroCount: 4 });
    expect(out.totalRequests).toBe(4);
  });

  it('sorts by count desc then name, and matches a naive reference', () => {
    const rows: PulseRow[] = [];
    const spec: Array<[string, number]> = [['Marseille', 8], ['Aix', 5], ['Arles', 5], ['Nice', 2]];
    for (const [town, n] of spec) for (let i = 0; i < n; i++) rows.push(row(town, i === 0, 1));
    rows.push(row(null, false, 1)); // townless request counts toward the total only
    const out = aggregatePulse(rows, NOW);
    expect(out.towns.map((t) => t.town)).toEqual(['Marseille', 'Aix', 'Arles']);
    expect(out.totalRequests).toBe(21);
  });

  it('caps at 30 towns', () => {
    const rows: PulseRow[] = [];
    for (let t = 0; t < 40; t++)
      for (let i = 0; i < 3 + t; i++) rows.push(row(`Ville${String(t).padStart(2, '0')}`, false, 1));
    expect(aggregatePulse(rows, NOW).towns).toHaveLength(30);
  });
});

describe('aggregatePulse timestamp formats', () => {
  it('accepts PostgREST "+00:00" offsets and toISOString "Z" equally', () => {
    const rows: PulseRow[] = [
      { args_summary: { town: 'Aix' }, zero_result: false, occurred_hour: '2026-08-28T20:00:00+00:00' },
      { args_summary: { town: 'Aix' }, zero_result: false, occurred_hour: '2026-08-28 20:00:00+00' },
      { args_summary: { town: 'Aix' }, zero_result: false, occurred_hour: '2026-08-28T20:00:00.000Z' },
    ];
    const out = aggregatePulse(rows, new Date('2026-08-29T00:00:00Z'));
    expect(out.towns[0]).toMatchObject({ town: 'Aix', count: 3 });
  });

  it('drops unparseable timestamps instead of counting them', () => {
    const rows: PulseRow[] = [
      { args_summary: { town: 'Aix' }, zero_result: false, occurred_hour: 'not-a-date' },
    ];
    expect(aggregatePulse(rows, new Date('2026-08-29T00:00:00Z')).totalRequests).toBe(0);
  });
});
