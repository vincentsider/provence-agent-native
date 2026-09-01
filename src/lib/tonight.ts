/**
 * find_tonight ranking (v3, issue #613), pure and shared by the page tool
 * and the remote MCP endpoint so both surfaces answer identically.
 *
 * Two ranking regimes:
 *  - with a center: nearest first (coordinate-less events last);
 *  - without: SHORTEST events first — a one-night concert is what "tonight"
 *    means, while a permanent exposition running since January technically
 *    overlaps every day and would otherwise drown the list (its d1 of
 *    1 January also chronologically sorts it to the top).
 */

import { haversineKm } from './engine';
import type { Place } from './types';

export interface TonightPick {
  readonly place: Place;
  readonly distanceKm: number | null;
}

const DAY_MS = 86_400_000;

function spanDays(p: Place): number {
  const d1 = p.d1;
  if (d1 === undefined || d1 === null) return Number.MAX_SAFE_INTEGER;
  const end = p.d2 ?? d1;
  const from = Date.parse(`${d1}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((to - from) / DAY_MS)) + 1;
}

export function selectTonight(
  places: readonly Place[],
  center: { lat: number; lng: number } | null,
  radiusKm: number,
  limit: number,
  /** Fallback position for coordinate-less events (their town centroid).
   *  Without it, a GPS-less expo 70 km away passed the radius filter and
   *  "tonight near Marseille" answered with Graveson and Maillane (field
   *  bug, 1 Sep). With a center, an event with NO resolvable position is
   *  dropped: an honest radius beats a padded list. */
  fallbackCoords?: (p: Place) => { lat: number; lng: number } | null,
): TonightPick[] {
  const positionOf = (place: Place): { lat: number; lng: number } | null => {
    if (place.lat !== null && place.lng !== null) return { lat: place.lat, lng: place.lng };
    return fallbackCoords?.(place) ?? null;
  };
  let picks: TonightPick[] = places.map((place) => {
    const at = center ? positionOf(place) : null;
    return {
      place,
      distanceKm:
        center && at
          ? Math.round(haversineKm(center.lat, center.lng, at.lat, at.lng) * 10) / 10
          : null,
    };
  });
  if (center) {
    picks = picks
      .filter((p) => p.distanceKm !== null && p.distanceKm <= radiusKm)
      .sort((a, b) => {
        const da = a.distanceKm ?? Number.MAX_SAFE_INTEGER;
        const db = b.distanceKm ?? Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return spanDays(a.place) - spanDays(b.place);
      });
  } else {
    picks = [...picks].sort((a, b) => {
      const sa = spanDays(a.place);
      const sb = spanDays(b.place);
      if (sa !== sb) return sa - sb;
      return (a.place.d1 ?? '') < (b.place.d1 ?? '') ? -1 : 1;
    });
  }
  return picks.slice(0, limit);
}
