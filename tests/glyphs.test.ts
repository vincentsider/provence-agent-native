/** Map glyphs: the sign must convey the thing (29 Aug field request). */

import { pickGlyph } from '@/lib/glyphs';
import { CLUSTERS, type Place, type Vocab } from '@/lib/types';

const vocab: Vocab = {
  version: 1,
  tags: { '9': { label: 'Sauna', n: 1, slug: 'sauna', source: 'facet' } },
  towns: ['Cassis'],
};
const AGENDA = CLUSTERS.findIndex((c) => c.key === 'agenda');
const LOISIRS = CLUSTERS.findIndex((c) => c.key === 'loisirs');

function place(over: Partial<Place>): Place {
  return {
    id: 1, c: 0, n: 'X', t: 0, lat: null, lng: null, g: null, tags: [],
    u: '/les-guides/hebergements/hotels/cassis/x', s: '', img: null,
    ...over,
  } as Place;
}

describe('pickGlyph', () => {
  it.each([
    [place({}), '🛏'],
    [place({ c: LOISIRS, n: 'Base de Canoë Kayak' }), '🛶'],
    [place({ c: LOISIRS, n: 'Centre bien-être', tags: [9] }), '♨'],
    [place({ c: LOISIRS, n: 'Domaine viticole, dégustation' }), '🍷'],
    [place({ c: CLUSTERS.findIndex((x) => x.key === 'itineraires'), n: 'Circuit VTT n°5' }), '🚴'],
    [place({ c: AGENDA, u: '/agenda/marche/cassis/marche-nocturne' }), '🧺'],
    [place({ c: AGENDA, u: '/agenda/concert/cassis/jazz' }), '🎵'],
    [place({ c: AGENDA, u: '/agenda/inconnu/cassis/x' }), '📅'],
  ])('%#: %o', (p, glyph) => {
    expect(pickGlyph(p as Place, vocab)).toBe(glyph);
  });
});
