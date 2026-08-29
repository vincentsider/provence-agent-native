/**
 * Town centroids from the catalogue's own coordinates: mean of every record
 * with a GPS point, keyed by folded town name. WeakMap-cached per catalogue
 * (immutable after load). Shared by the map layers, the tonight tool and
 * the view-framing path — one definition of "where a town is".
 */

import { fold, type Catalog, type Vocab } from './types';

export interface Centroid {
  readonly lat: number;
  readonly lng: number;
}

const cache = new WeakMap<Catalog, Map<string, Centroid>>();

export function townCentroids(catalog: Catalog, vocab: Vocab): ReadonlyMap<string, Centroid> {
  const cached = cache.get(catalog);
  if (cached) return cached;
  const sums = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of catalog.places) {
    if (p.lat === null || p.lng === null || p.t < 0) continue;
    const town = fold(vocab.towns[p.t] ?? '');
    if (!town) continue;
    const entry = sums.get(town) ?? { lat: 0, lng: 0, n: 0 };
    entry.lat += p.lat;
    entry.lng += p.lng;
    entry.n += 1;
    sums.set(town, entry);
  }
  const out = new Map<string, Centroid>();
  for (const [town, { lat, lng, n }] of sums) {
    out.set(town, { lat: lat / n, lng: lng / n });
  }
  cache.set(catalog, out);
  return out;
}
