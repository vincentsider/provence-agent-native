/**
 * ShortlistStore (v3, issues #612/#616): the findings the visitor KEPT from
 * the scouts (or tapped elsewhere). Feeds write_postcard's factual layer and
 * get_visitor_view. Bounded at 20; keep() on a full list drops the oldest.
 */

export interface ShortlistItem {
  readonly id: number;
  readonly name: string;
  readonly town: string;
  readonly url: string;
  /** ISO dates for event records; null for places. */
  readonly d1: string | null;
  readonly d2: string | null;
}

const MAX_ITEMS = 20;

export class ShortlistStore {
  #items: ShortlistItem[] = [];
  #snapshot: readonly ShortlistItem[] = [];
  #listeners = new Set<() => void>();

  keep(item: ShortlistItem): void {
    if (this.#items.some((i) => i.id === item.id)) return;
    this.#items.push(item);
    if (this.#items.length > MAX_ITEMS) this.#items.shift();
    this.#publish();
  }

  remove(id: number): void {
    const before = this.#items.length;
    this.#items = this.#items.filter((i) => i.id !== id);
    if (this.#items.length !== before) this.#publish();
  }

  #publish(): void {
    this.#snapshot = [...this.#items];
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): readonly ShortlistItem[] => this.#snapshot;

  destroy(): void {
    this.#listeners.clear();
    this.#items = [];
    this.#snapshot = [];
  }
}

let singleton: ShortlistStore | null = null;

export function getShortlistStore(): ShortlistStore {
  if (typeof window === 'undefined') throw new Error('ShortlistStore is client-only');
  if (!singleton) singleton = new ShortlistStore();
  return singleton;
}
