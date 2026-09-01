/**
 * Viewport semantics (field bug 1 Sep): a zoom on one town with the town
 * filter on "all towns" must still name that town. deriveViewportContext is
 * the pure core get_visitor_view feeds to the agent.
 */

import { deriveViewportContext } from '@/lib/viewport-context';
import { collageLayout } from '@/lib/collage';

type P = { lat: number | null; lng: number | null; t: number };
const place = (lat: number | null, lng: number | null, t: number): P => ({ lat, lng, t });
const vocab = { towns: ['Saintes-Maries-de-la-Mer', 'Arles', 'Cassis'] };
const BOUNDS = { north: 43.5, south: 43.4, east: 4.5, west: 4.3 };

const catalog = (places: P[]) => ({ places }) as never;

describe('deriveViewportContext', () => {
  it('names the dominant town of a tight zoom, filter or no filter', () => {
    const ctx = deriveViewportContext(
      catalog([
        place(43.45, 4.42, 0),
        place(43.46, 4.43, 0),
        place(43.44, 4.41, 0),
        place(43.47, 4.44, 1),
        place(43.2, 5.5, 2), // outside the bounds
      ]),
      vocab,
      BOUNDS,
    );
    expect(ctx.dominantTown).toBe('Saintes-Maries-de-la-Mer');
    expect(ctx.townsInView[0]).toEqual({ town: 'Saintes-Maries-de-la-Mer', visiblePlaces: 3 });
    expect(ctx.townsInView.map((t) => t.town)).not.toContain('Cassis');
  });

  it('declares no dominant town on a wide balanced framing', () => {
    const ctx = deriveViewportContext(
      catalog([
        place(43.45, 4.42, 0),
        place(43.46, 4.43, 0),
        place(43.44, 4.41, 0),
        place(43.45, 4.35, 1),
        place(43.46, 4.36, 1),
        place(43.47, 4.37, 1),
      ]),
      vocab,
      BOUNDS,
    );
    expect(ctx.dominantTown).toBeNull();
    expect(ctx.townsInView).toHaveLength(2);
  });

  it('handles null bounds and coordinate-less places', () => {
    expect(deriveViewportContext(catalog([place(43.45, 4.42, 0)]), vocab, null)).toEqual({
      townsInView: [],
      dominantTown: null,
    });
    const ctx = deriveViewportContext(catalog([place(null, null, 0)]), vocab, BOUNDS);
    expect(ctx.townsInView).toHaveLength(0);
  });
});

describe('collageLayout', () => {
  it('always yields a full grid, or the brand fallback', () => {
    expect(collageLayout(0)).toBeNull();
    expect(collageLayout(1)).toEqual({ n: 1, cols: 'grid-cols-1' });
    expect(collageLayout(2)!.n).toBe(2);
    expect(collageLayout(3)!.n).toBe(3);
    expect(collageLayout(4)!.n).toBe(4);
    expect(collageLayout(5)!.n).toBe(4); // 5 trims to 2x2, never an empty cell
    expect(collageLayout(6)!.n).toBe(6);
    expect(collageLayout(9)!.n).toBe(6);
  });
});
