/**
 * The demand pulse (issue #609): live agent demand aggregated by town, the
 * data nobody else in the ~400-demo corpus has. Pure aggregator (tested
 * against the SQL dry-run validated on the live DB, 28 Aug) + thin fetch.
 *
 * Privacy: counters only, k>=3 threshold so no town appears until three
 * distinct requests named it (anti-singling-out), 7-day rolling window.
 */

export interface PulseRow {
  readonly args_summary: Record<string, unknown> | null;
  readonly zero_result: boolean;
  readonly occurred_hour: string;
}

export interface TownPulse {
  readonly town: string;
  readonly count: number;
  readonly zeroCount: number;
}

export interface PulseData {
  readonly windowDays: number;
  readonly totalRequests: number;
  readonly towns: readonly TownPulse[];
}

export const PULSE_WINDOW_DAYS = 7;
export const PULSE_K_THRESHOLD = 3;
const MAX_TOWNS = 30;

/** Pure and reference-tested: mirrors the validated SQL exactly. */
export function aggregatePulse(rows: readonly PulseRow[], now: Date): PulseData {
  const cutoff = new Date(now.getTime() - PULSE_WINDOW_DAYS * 86_400_000).toISOString();
  const byTown = new Map<string, { count: number; zeroCount: number }>();
  let totalRequests = 0;

  for (const row of rows) {
    if (row.occurred_hour < cutoff) continue;
    totalRequests += 1;
    const town = row.args_summary?.town;
    if (typeof town !== 'string' || town.length === 0) continue;
    const entry = byTown.get(town) ?? { count: 0, zeroCount: 0 };
    entry.count += 1;
    if (row.zero_result) entry.zeroCount += 1;
    byTown.set(town, entry);
  }

  const towns = [...byTown.entries()]
    .filter(([, v]) => v.count >= PULSE_K_THRESHOLD)
    .map(([town, v]) => ({ town, count: v.count, zeroCount: v.zeroCount }))
    .sort((a, b) => b.count - a.count || a.town.localeCompare(b.town, 'fr'))
    .slice(0, MAX_TOWNS);

  return { windowDays: PULSE_WINDOW_DAYS, totalRequests, towns };
}
