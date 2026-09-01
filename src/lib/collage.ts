/**
 * Mission-hero collage layout (field bug 1 Sep): a thin mission left empty
 * dark cells that read as broken. Photos trim to the largest CLEAN grid;
 * zero photos means the caller renders the brand-pattern fallback instead.
 * Explicit class strings so Tailwind keeps them.
 */

export function collageLayout(count: number): { n: number; cols: string } | null {
  if (count >= 6) return { n: 6, cols: 'grid-cols-2 md:grid-cols-3' };
  if (count >= 4) return { n: 4, cols: 'grid-cols-2' };
  if (count === 3) return { n: 3, cols: 'grid-cols-3' };
  if (count === 2) return { n: 2, cols: 'grid-cols-2' };
  if (count === 1) return { n: 1, cols: 'grid-cols-1' };
  return null;
}
