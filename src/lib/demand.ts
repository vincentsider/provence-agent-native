/**
 * Demand Mirror telemetry (spec section 9, issue #603).
 *
 * In-memory ring buffer, capped at 200 entries, session-scoped: closing the
 * tab discards it. The optional sync path sends COUNTERS ONLY to /api/demand
 * (tool name, tag slugs, cluster, result bucket) via sendBeacon; no IP is
 * stored server-side, no session id exists, and no free text ever leaves the
 * page. The panel works fully with the endpoint disabled.
 *
 * Memory-leak posture: fixed-size ring buffer, bounded pending queue (drops
 * oldest), a single interval + listeners removed by destroy(). The singleton
 * lives for the page lifetime, but destroy() keeps tests and HMR clean.
 */

export interface DemandEntry {
  /** ms since page load (performance.now-based; no wall-clock identity). */
  readonly at: number;
  readonly tool: string;
  /** Public, already-validated argument summary. Never raw input. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Result count, or null for tools where "total" is meaningless. */
  readonly total: number | null;
  readonly durationMs: number;
}

interface PendingAggregate {
  readonly tool: string;
  readonly tags?: readonly string[];
  readonly cluster?: string;
  readonly minGrade?: number;
  /** find_events aggregates: category slug and queried month (YYYY-MM). */
  readonly category?: string;
  readonly month?: string;
  readonly resultTotal: number;
  readonly zeroResult: boolean;
}

const RING_CAP = 200;
const PENDING_CAP = 50;
const FLUSH_INTERVAL_MS = 30_000;

export class DemandLog {
  #ring: DemandEntry[] = [];
  #pending: PendingAggregate[] = [];
  #listeners = new Set<() => void>();
  #snapshot: readonly DemandEntry[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #onPageHide: (() => void) | null = null;
  #enabled: boolean;

  constructor(enabled = true) {
    this.#enabled = enabled;
    if (enabled && typeof window !== 'undefined') {
      this.#timer = setInterval(() => this.#flush(), FLUSH_INTERVAL_MS);
      this.#onPageHide = () => this.#flush();
      window.addEventListener('pagehide', this.#onPageHide);
    }
  }

  destroy(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#onPageHide && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.#onPageHide);
    }
    this.#onPageHide = null;
    this.#listeners.clear();
  }

  record(
    tool: string,
    args: Readonly<Record<string, unknown>>,
    total: number | null,
    durationMs: number,
  ): void {
    const entry: DemandEntry = {
      at: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0,
      tool,
      args,
      total,
      durationMs: Math.round(durationMs * 10) / 10,
    };
    this.#ring.push(entry);
    if (this.#ring.length > RING_CAP) this.#ring.shift();
    this.#snapshot = [...this.#ring];
    for (const fn of this.#listeners) fn();

    if (this.#enabled && total !== null) {
      // DELIBERATE: free-text `query` is NEVER aggregated to the server.
      // It is the one argument a visitor's own words flow into, i.e. a
      // potential PII channel; it lives in the on-page mirror only.
      const agg: PendingAggregate = {
        tool,
        tags: Array.isArray(args.tags) ? (args.tags as string[]).slice(0, 12) : undefined,
        cluster: typeof args.cluster === 'string' ? args.cluster : undefined,
        minGrade: typeof args.minGrade === 'number' ? args.minGrade : undefined,
        category: typeof args.category === 'string' ? args.category.slice(0, 64) : undefined,
        month:
          typeof args.month === 'string'
            ? args.month.slice(0, 7)
            : typeof args.from === 'string'
              ? args.from.slice(0, 7)
              : undefined,
        resultTotal: total,
        zeroResult: total === 0,
      };
      this.#pending.push(agg);
      if (this.#pending.length > PENDING_CAP) this.#pending.shift();
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): readonly DemandEntry[] => this.#snapshot;

  /** Zero-result calls: the measured gaps in the offer. */
  zeroResults(): readonly DemandEntry[] {
    return this.#snapshot.filter((e) => e.total === 0);
  }

  #flush(): void {
    if (this.#pending.length === 0) return;
    const events = this.#pending.splice(0, PENDING_CAP);
    try {
      const body = JSON.stringify({ events });
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon('/api/demand', new Blob([body], { type: 'application/json' }));
      }
    } catch {
      // Telemetry must never break the page. Drop and move on.
    }
  }
}

let singleton: DemandLog | null = null;

export function getDemandLog(): DemandLog {
  if (typeof window === 'undefined') throw new Error('DemandLog is client-only');
  if (!singleton) singleton = new DemandLog();
  return singleton;
}
