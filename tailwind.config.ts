import type { Config } from 'tailwindcss';

/**
 * Brand tokens read off the live myprovence.fr DOM on 27 Aug 2026
 * (scripts/probe-* runs; values are computed styles, not guesses):
 *  - signature yellow  #FFE500 (masthead, hero band, filter bar; square corners)
 *  - ink               #434343 (display type on yellow, body headings)
 *  - coral             #EE6E62 (category lines, map clusters)
 *  - red               #E63521 (strong accent)
 *  - petrol            #002731 (dark editorial sections)
 *  - body serif: Zilla Slab; display: MostraNuova-Heavy (commercial, NOT
 *    copied) approximated by Archivo Black, both loaded via next/font.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          yellow: '#FFE500',
          yellowSoft: '#FFF9C0',
          ink: '#434343',
          coral: '#EE6E62',
          red: '#E63521',
          petrol: '#002731',
          paper: '#F7F7F4',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Arial Black', 'sans-serif'],
        slab: ['var(--font-slab)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
