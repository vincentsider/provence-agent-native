/**
 * Viewport semantics (field bug 1 Sep, customer test): the visitor zoomed
 * on Saintes-Maries-de-la-Mer with the town filter on "all towns", asked
 * "what am I looking at?", and the agent answered "no city selected" — raw
 * lat/lng bounds mean nothing to a language model. The page derives the
 * towns itself: which towns' places sit inside the viewport, ranked, plus a
 * dominant town when one clearly leads.
 *
 * Pure and bounded: one O(n) pass over the catalogue per call (tool-call
 * frequency, never render frequency), no allocation beyond the count map.
 */

import type { Catalog, Vocab } from './types';
import type { ViewportBounds } from './viewport';

export interface TownInView {
  readonly town: string;
  readonly visiblePlaces: number;
}

export interface ViewportContext {
  readonly townsInView: readonly TownInView[];
  /** The single town this viewport is ABOUT, when one holds the majority
   *  of visible places; null for wide or borderline framings. */
  readonly dominantTown: string | null;
}

const MAX_TOWNS = 5;

export function deriveViewportContext(
  catalog: Pick<Catalog, 'places'>,
  vocab: Pick<Vocab, 'towns'>,
  bounds: ViewportBounds | null,
): ViewportContext {
  if (!bounds) return { townsInView: [], dominantTown: null };
  const counts = new Map<number, number>();
  let inView = 0;
  for (const p of catalog.places) {
    if (p.lat === null || p.lng === null || p.t < 0) continue;
    if (p.lat > bounds.north || p.lat < bounds.south) continue;
    if (p.lng > bounds.east || p.lng < bounds.west) continue;
    counts.set(p.t, (counts.get(p.t) ?? 0) + 1);
    inView += 1;
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOWNS)
    .map(([t, n]) => ({ town: vocab.towns[t] ?? `#${t}`, visiblePlaces: n }));
  const top = ranked[0];
  const dominantTown =
    top && top.visiblePlaces >= 3 && top.visiblePlaces * 2 > inView ? top.town : null;
  return { townsInView: ranked, dominantTown };
}
