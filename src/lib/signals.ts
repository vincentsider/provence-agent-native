/**
 * Visitor signals (issue #608): the human side of the dialogue, readable by
 * the agent through get_visitor_signals. Pings dropped on the map, locks
 * placed on results, card answers, yields. Session-scoped, bounded, zero
 * PII — the payload can carry a coordinate and a place id, never an
 * identity. Same leak posture as the other stores.
 */

export type PingKind = 'plus-comme-ca' | 'eviter' | 'question';

export interface Ping {
  readonly kind: PingKind;
  readonly lat: number;
  readonly lng: number;
  readonly at: number;
}

export type VisitorSignal =
  | { kind: 'ping'; ping: Ping }
  | { kind: 'lock'; placeId: number; locked: boolean; at: number }
  | { kind: 'answer'; question: string; choice: string; at: number }
  | { kind: 'yield'; at: number };

const RING_CAP = 100;
const MAX_PINGS = 20;

export class SignalsLog {
  #ring: VisitorSignal[] = [];
  #pings: Ping[] = [];
  #locks = new Set<number>();
  #listeners = new Set<() => void>();
  #snapshot: readonly VisitorSignal[] = [];
  /** get_visitor_signals drains from here: events since the last agent read. */
  #cursor = 0;
  #dropped = 0;

  #push(signal: VisitorSignal): void {
    this.#ring.push(signal);
    if (this.#ring.length > RING_CAP) {
      this.#ring.shift();
      this.#dropped += 1;
    }
    this.#snapshot = [...this.#ring];
    for (const fn of this.#listeners) fn();
  }

  addPing(kind: PingKind, lat: number, lng: number): Ping {
    const ping: Ping = {
      kind,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      at: Date.now(),
    };
    this.#pings.push(ping);
    if (this.#pings.length > MAX_PINGS) this.#pings.shift();
    this.#push({ kind: 'ping', ping });
    return ping;
  }

  toggleLock(placeId: number): boolean {
    const locked = !this.#locks.has(placeId);
    if (locked) this.#locks.add(placeId);
    else this.#locks.delete(placeId);
    this.#push({ kind: 'lock', placeId, locked, at: Date.now() });
    return locked;
  }

  addAnswer(question: string, choice: string): void {
    this.#push({ kind: 'answer', question: question.slice(0, 160), choice: choice.slice(0, 80), at: Date.now() });
  }

  addYield(): void {
    this.#push({ kind: 'yield', at: Date.now() });
  }

  isLocked(placeId: number): boolean {
    return this.#locks.has(placeId);
  }

  lockedIds(): readonly number[] {
    return [...this.#locks];
  }

  pings(): readonly Ping[] {
    return [...this.#pings];
  }

  /** Agent read: events since its previous read + current durable state. */
  drainForAgent(): {
    newSignals: readonly VisitorSignal[];
    locks: readonly number[];
    pings: readonly Ping[];
  } {
    // The cursor indexes the logical stream (ring drops shift it forward).
    const logicalStart = this.#dropped;
    const offset = Math.max(0, this.#cursor - logicalStart);
    const newSignals = this.#ring.slice(offset);
    this.#cursor = logicalStart + this.#ring.length;
    return { newSignals, locks: this.lockedIds(), pings: this.pings() };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): readonly VisitorSignal[] => this.#snapshot;

  destroy(): void {
    this.#ring = [];
    this.#pings = [];
    this.#locks.clear();
    this.#listeners.clear();
    this.#snapshot = [];
    this.#cursor = 0;
    this.#dropped = 0;
  }
}

let singleton: SignalsLog | null = null;

export function getSignalsLog(): SignalsLog {
  if (typeof window === 'undefined') throw new Error('SignalsLog is client-only');
  if (!singleton) singleton = new SignalsLog();
  return singleton;
}
