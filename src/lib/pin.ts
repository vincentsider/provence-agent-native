/**
 * The agent's pin (field bug 1 Sep, customer test): pin_visible_place used
 * to express itself only through the shared highlight set — one 26px chip
 * among 29 identical ones, wiped by the next search. "J'ai épinglé le Mas
 * de la Fouque" while the visitor saw nothing change. The pin now lives in
 * its own store: MapView renders it as an unmissable marker in a dedicated
 * layer that survives later searches, until a new pin replaces it or the
 * visitor dismisses it.
 *
 * Same bounded-observable pattern as PulseStore: one value, listener set,
 * idempotent destroy, client-only singleton.
 */

export interface PinnedPlace {
  readonly id: number;
  readonly name: string;
  readonly town: string | null;
  readonly url: string;
  readonly lat: number;
  readonly lng: number;
  readonly d1: string | null;
  readonly d2: string | null;
  readonly img: string | null;
  readonly glyph: string;
}

export class PinStore {
  #pinned: PinnedPlace | null = null;
  #listeners = new Set<() => void>();

  set(place: PinnedPlace): void {
    this.#pinned = place;
    for (const fn of this.#listeners) fn();
  }

  clear(): void {
    if (!this.#pinned) return;
    this.#pinned = null;
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): PinnedPlace | null => this.#pinned;

  destroy(): void {
    this.#listeners.clear();
    this.#pinned = null;
  }
}

let singleton: PinStore | null = null;

export function getPinStore(): PinStore {
  if (typeof window === 'undefined') throw new Error('PinStore is client-only');
  if (!singleton) singleton = new PinStore();
  return singleton;
}
