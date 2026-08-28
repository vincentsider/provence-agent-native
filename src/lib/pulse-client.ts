/**
 * Client-side pulse state (issue #609): the get_demand_pulse tool fills it,
 * the map layer renders it. Same bounded observable pattern as the other
 * stores.
 */

import type { PulseData } from './demand-pulse';

export class PulseStore {
  #data: PulseData | null = null;
  #listeners = new Set<() => void>();

  set(data: PulseData): void {
    this.#data = data;
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): PulseData | null => this.#data;

  destroy(): void {
    this.#listeners.clear();
    this.#data = null;
  }
}

let singleton: PulseStore | null = null;

export function getPulseStore(): PulseStore {
  if (typeof window === 'undefined') throw new Error('PulseStore is client-only');
  if (!singleton) singleton = new PulseStore();
  return singleton;
}
