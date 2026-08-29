/**
 * The wish box parser (29 Aug hardening): any typed desire must yield 2-4
 * runnable scout briefs from the catalogue's own vocabulary — the page
 * dispatches scouts deterministically, whatever the driving agent does.
 */

import { parseWish, type WishVocab } from '@/lib/wish';
import type { Vocab } from '@/lib/types';

const vocab: Vocab = {
  version: 1,
  tags: {
    '469': { label: 'Parking', n: 10, slug: 'parking', source: 'facet' },
    '463': { label: 'Animaux acceptés', n: 5, slug: 'animaux-acceptes', source: 'facet' },
    '465': { label: 'Piscine', n: 7, slug: 'piscine', source: 'facet' },
  },
  towns: ['Cassis', 'Marseille', 'Aix-en-Provence', 'Arles'],
};
const store: WishVocab = { vocab };

describe('parseWish regions (field bug 29 Aug)', () => {
  it('the Alpilles/Camargue comparison yields one scout per region, 2+ total', () => {
    const { briefs } = parseWish(
      store,
      "J'hésite entre les Alpilles et la Camargue pour un week-end nature. Explore les deux et propose-moi des options.",
    );
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    expect(briefs.some((b) => b.query === 'alpilles')).toBe(true);
    expect(briefs.some((b) => b.query === 'camargue')).toBe(true);
    // 'nature' narrows the region scouts to the official routes cluster.
    expect(briefs.filter((b) => b.cluster === 'itineraires').length).toBeGreaterThanOrEqual(2);
  });

  it('never yields fewer than two briefs, whatever the input', () => {
    for (const text of ['Cassis !', 'nature', 'aaaaa bbbbb', 'un truc sympa ce soir']) {
      expect(parseWish(store, text).briefs.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('parseWish', () => {
  it('maps the canonical wish to town + lodging + events briefs', () => {
    const { briefs, towns } = parseWish(
      store,
      "Je cherche un séjour à Cassis : un hôtel avec parking, et un marché ou un événement sympa pendant qu'on y est.",
    );
    expect(towns).toEqual(['Cassis']);
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    expect(briefs.length).toBeLessThanOrEqual(4);
    expect(briefs.some((b) => b.cluster === 'hotels' && b.town === 'Cassis' && b.tags?.includes('parking'))).toBe(true);
    expect(briefs.some((b) => b.cluster === 'agenda' && b.town === 'Cassis')).toBe(true);
  });

  it('handles English wording through the same vocabulary', () => {
    const { briefs } = parseWish(store, 'A hotel in Marseille with piscine and a festival nearby');
    expect(briefs.some((b) => b.cluster === 'hotels' && b.town === 'Marseille')).toBe(true);
    expect(briefs.some((b) => b.cluster === 'agenda')).toBe(true);
  });

  it('never returns zero briefs, even for word salad', () => {
    const { briefs } = parseWish(store, 'quelque chose de sympa vraiment');
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    for (const b of briefs) {
      expect(
        b.query !== undefined || b.tags !== undefined || b.town !== undefined || b.cluster !== undefined || b.month !== undefined,
      ).toBe(true);
    }
  });

  it('accent-insensitive town match, two towns max', () => {
    const { towns } = parseWish(store, 'entre marseille, cassis et arles pour un weekend');
    expect(towns).toHaveLength(2);
  });
});
