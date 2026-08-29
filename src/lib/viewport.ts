/**
 * ViewportStore (v3, issue #614): what the HUMAN is looking at, published for
 * the agent. MapView pushes bounds/zoom on moveend/zoomend (debounced by the
 * caller); the catalogue section pushes the human's active filter. The
 * get_visitor_view tool and the pin_visible_place dynamic registration
 * consume it.
 *
 * Same bounded-observable pattern as PulseStore: plain values, listener set,
 * idempotent destroy. Nothing here leaves the page.
 */

export interface ViewportBounds {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export interface HumanFilter {
  readonly cluster: string | null;
  readonly tags: readonly string[];
  readonly town: string | null;
}

export interface VisitorViewport {
  readonly bounds: ViewportBounds | null;
  readonly zoom: number | null;
  readonly filter: HumanFilter;
}

const INITIAL: VisitorViewport = {
  bounds: null,
  zoom: null,
  filter: { cluster: null, tags: [], town: null },
};

export class ViewportStore {
  #state: VisitorViewport = INITIAL;
  #listeners = new Set<() => void>();

  setBounds(bounds: ViewportBounds, zoom: number): void {
    this.#state = { ...this.#state, bounds, zoom };
    for (const fn of this.#listeners) fn();
  }

  setFilter(filter: HumanFilter): void {
    // Defensive copy: the caller's array must not mutate under us.
    this.#state = { ...this.#state, filter: { ...filter, tags: [...filter.tags] } };
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): VisitorViewport => this.#state;

  /** True when the point sits inside the current bounds (false without bounds). */
  contains(lat: number, lng: number): boolean {
    const b = this.#state.bounds;
    if (!b) return false;
    return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
  }

  destroy(): void {
    this.#listeners.clear();
    this.#state = INITIAL;
  }
}

let singleton: ViewportStore | null = null;

export function getViewportStore(): ViewportStore {
  if (typeof window === 'undefined') throw new Error('ViewportStore is client-only');
  if (!singleton) singleton = new ViewportStore();
  return singleton;
}
