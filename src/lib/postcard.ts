/**
 * PostcardStore (v3, issue #616): the letter the agent writes from the
 * visitor's future trip. One postcard at a time; the panel renders it, the
 * visitor closes/copies/prints it. Text only — the panel escapes everything.
 */

export interface Postcard {
  readonly title: string;
  readonly body: string;
  readonly day: number;
}

export class PostcardStore {
  #card: Postcard | null = null;
  #listeners = new Set<() => void>();

  set(card: Postcard): void {
    this.#card = card;
    for (const fn of this.#listeners) fn();
  }

  clear(): void {
    if (!this.#card) return;
    this.#card = null;
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): Postcard | null => this.#card;

  destroy(): void {
    this.#listeners.clear();
    this.#card = null;
  }
}

let singleton: PostcardStore | null = null;

export function getPostcardStore(): PostcardStore {
  if (typeof window === 'undefined') throw new Error('PostcardStore is client-only');
  if (!singleton) singleton = new PostcardStore();
  return singleton;
}
