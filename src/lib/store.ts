/**
 * Client-side store: single source of truth for both the React view and the
 * WebMCP tools (spec section 4). Tools never touch the DOM; the view never
 * reaches into tool internals. Both consume this.
 *
 * Registration-before-data contract (spec 7.4): the Store constructor kicks
 * off loading and exposes `ready`; tool registration must NOT await it.
 */

import { aliasIds } from './vocab';
import { toPublicShape } from './public-shape';
import {
  buildIndexes,
  clusterScope,
  runFilter,
  runFindNear,
  type ClusterScope,
  type Indexes,
  type NearResult,
} from './engine';
import {
  CLUSTERS,
  type Catalog,
  type ClusterKey,
  type FilterInput,
  type Place,
  type PublicPlace,
  type Vocab,
  CANONICAL_HOST,
} from './types';

export interface ViewState {
  readonly center: { lat: number; lng: number };
  readonly zoom: number;
  /** Record indices currently highlighted on map + list. */
  readonly highlighted: readonly number[];
  /** Who last drove the view; the UI badges agent-driven changes. */
  readonly lastActor: 'human' | 'agent' | null;
  /** Total for the active result set (may exceed highlighted.length). */
  readonly total: number;
  readonly loadState: 'loading' | 'ready' | 'error';
  readonly loadError: string | null;
}

const INITIAL_VIEW: ViewState = {
  center: { lat: 43.45, lng: 5.35 }, // Bouches-du-Rhône
  zoom: 9,
  highlighted: [],
  lastActor: null,
  total: 0,
  loadState: 'loading',
  loadError: null,
};

const DATA_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DATA_URL) || '/data';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export class Store {
  readonly ready: Promise<void>;

  #catalog: Catalog = { version: 1, places: [] };
  #vocab: Vocab = { version: 1, tags: {}, towns: [] };
  #indexes: Indexes | null = null;

  #view: ViewState = INITIAL_VIEW;
  #listeners = new Set<() => void>();
  /** Memoized per-cluster facet scopes (catalogue is immutable after load). */
  #scopes = new Map<number, ClusterScope>();

  constructor() {
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    try {
      const manifest = await fetchJson<{
        files: { catalog: string; vocab: string; events?: string };
      }>(`${DATA_BASE}/manifest.json`);
      const [catalog, vocab, events] = await Promise.all([
        fetchJson<Catalog>(`${DATA_BASE}/${manifest.files.catalog}`),
        fetchJson<Vocab>(`${DATA_BASE}/${manifest.files.vocab}`),
        manifest.files.events
          ? fetchJson<Catalog>(`${DATA_BASE}/${manifest.files.events}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      // Events merge behind the guides records so guide indices stay stable
      // whether or not the events artefact exists (it is optional and its
      // failure must never cost the main catalogue).
      const merged: Catalog =
        events && events.places.length > 0
          ? { version: 1, places: [...catalog.places, ...events.places] }
          : catalog;
      this.#catalog = merged;
      this.#vocab = vocab;
      this.#indexes = buildIndexes(merged, vocab);
      this.#patch({ loadState: 'ready', total: merged.places.length });
    } catch (err) {
      // The page must stay usable (S6): surface the failure, keep tools
      // answering with a typed "catalogue unavailable" error.
      this.#patch({
        loadState: 'error',
        loadError: err instanceof Error ? err.message : 'load failed',
      });
    }
  }

  // ---- snapshot / subscribe (useSyncExternalStore contract) ----------------

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getView = (): ViewState => this.#view;

  #patch(partial: Partial<ViewState>): void {
    this.#view = { ...this.#view, ...partial };
    for (const fn of this.#listeners) fn();
  }

  // ---- data access ---------------------------------------------------------

  get catalog(): Catalog {
    return this.#catalog;
  }

  get vocab(): Vocab {
    return this.#vocab;
  }

  get isReady(): boolean {
    return this.#indexes !== null;
  }

  #requireIndexes(): Indexes {
    if (!this.#indexes) throw new Error('catalogue not loaded');
    return this.#indexes;
  }

  // ---- queries (used by both UI and tools) ---------------------------------

  filter(input: FilterInput, actor: 'human' | 'agent'): {
    total: number;
    places: Place[];
    indices: number[];
  } {
    const idx = this.#requireIndexes();
    const { total, indices } = runFilter(this.#catalog, idx, input);
    const places = indices.map((i) => this.#catalog.places[i]!);
    this.#patch({ highlighted: indices, lastActor: actor, total });
    return { total, places, indices: [...indices] };
  }

  findNear(
    center: { lat: number; lng: number },
    radiusKm: number,
    cluster: ClusterKey | undefined,
    limit: number,
    actor: 'human' | 'agent',
  ): NearResult {
    const idx = this.#requireIndexes();
    const clusterIdx =
      cluster === undefined ? -1 : CLUSTERS.findIndex((c) => c.key === cluster);
    const result = runFindNear(this.#catalog, idx, center, radiusKm, clusterIdx, limit);
    this.#patch({
      highlighted: result.items.map((h) => h.index),
      lastActor: actor,
      total: result.total,
      center,
    });
    return result;
  }

  getByIdOrUrl(ref: { id?: number; url?: string }): Place | null {
    if (ref.id !== undefined) {
      return this.#catalog.places.find((p) => p.id === ref.id) ?? null;
    }
    if (ref.url !== undefined) {
      let path: string;
      try {
        const u = new URL(ref.url, `https://${CANONICAL_HOST}`);
        // The bare apex redirects to www in practice; accept both.
        if (u.hostname !== CANONICAL_HOST && u.hostname !== 'myprovence.fr') return null;
        path = decodeURIComponent(u.pathname);
      } catch {
        return null;
      }
      // Normalise the trailing slash agents habitually append.
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      return this.#catalog.places.find((p) => p.u === path) ?? null;
    }
    return null;
  }

  setView(center: { lat: number; lng: number }, zoom: number, actor: 'human' | 'agent'): void {
    this.#patch({ center, zoom, lastActor: actor });
  }

  setHighlightedIds(ids: readonly number[], actor: 'human' | 'agent'): number {
    const wanted = new Set(ids);
    const indices: number[] = [];
    this.#catalog.places.forEach((p, i) => {
      if (wanted.has(p.id)) indices.push(i);
    });
    this.#patch({ highlighted: indices, lastActor: actor });
    return indices.length;
  }

  stats(): {
    total: number;
    perCluster: Record<ClusterKey, number>;
    topTags: Array<{ slug: string; label: string; count: number }>;
    towns: number;
    withGeo: number;
    withTags: number;
  } {
    const perCluster = Object.fromEntries(
      CLUSTERS.map((c) => [c.key, 0]),
    ) as Record<ClusterKey, number>;
    let withGeo = 0;
    let withTags = 0;
    for (const p of this.#catalog.places) {
      const key = CLUSTERS[p.c]?.key;
      if (key) perCluster[key] += 1;
      if (p.lat !== null) withGeo += 1;
      if (p.tags.length > 0) withTags += 1;
    }
    const hidden = aliasIds(this.#vocab);
    const topTags = Object.entries(this.#vocab.tags)
      .filter(([id, t]) => t.n > 0 && !hidden.has(Number(id)))
      .map(([, t]) => t)
      .sort((a, b) => b.n - a.n)
      .slice(0, 25)
      .map((t) => ({ slug: t.slug, label: t.label, count: t.n }));
    return {
      total: this.#catalog.places.length,
      perCluster,
      topTags,
      towns: this.#vocab.towns.length,
      withGeo,
      withTags,
    };
  }

  /** Facet populations for the active cluster tab (null = whole catalogue):
   *  the same per-hub numbers myprovence.fr shows, memoized per cluster. */
  scopeFor(cluster: ClusterKey | null): ClusterScope {
    const idx = this.#requireIndexes();
    const clusterIdx =
      cluster === null ? -1 : CLUSTERS.findIndex((c) => c.key === cluster);
    let scope = this.#scopes.get(clusterIdx);
    if (!scope) {
      scope = clusterScope(this.#catalog, idx, clusterIdx);
      this.#scopes.set(clusterIdx, scope);
    }
    return scope;
  }

  /** Delegates to the shared mapper (src/lib/public-shape.ts) so all four
   *  agent surfaces (WebMCP, GET APIs, /agenda, remote MCP) emit
   *  byte-identical shapes. */
  toPublicShape(p: Place): PublicPlace {
    return toPublicShape(
      p,
      this.#vocab,
      this.#indexes?.aliasToCanonical ?? new Map<number, number>(),
    );
  }
}

let singleton: Store | null = null;

/** Lazily create the client-side singleton. Never constructed on the server. */
export function getStore(): Store {
  if (typeof window === 'undefined') {
    throw new Error('Store is client-only');
  }
  if (!singleton) singleton = new Store();
  return singleton;
}
