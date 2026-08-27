/**
 * Parser tests against captured shapes of the live markup (27 Aug 2026).
 */

import {
  parseDetailNodeId,
  parseDetailPage,
  parseHubPage,
  pathToTown,
} from '../ingest/parse';

const HUB_SAMPLE = `
<div>463 résultats</div>
<span role="presentation"><b>1 SUR 12</b></span>
<a href="/x?f%5B0%5D=maptags%3A469" rel="nofollow" data-drupal-facet-item-id="maptags-469" data-drupal-facet-item-value="469" data-drupal-facet-item-count="419"><span class="facet-item__value">Parking</span></a>
<article data-history-node-id="29990" role="article" about="/les-guides/hebergements/hotels/aix-en-provence/ibis-aix-en-provence" class="node--type--poi node--view-mode--hub-teaser">
  <div class="title">Ibis Aix en Provence</div>
  <div class="teaser-city">Aix-en-Provence</div>
  <div class="hidden poi-hub-map-coordinates" lat="43.511362" lon="5.462800"></div>
</article>
<article data-history-node-id="30001" role="article" about="/les-guides/hebergements/hotels/marseille/hotel-test" class="node--type--poi node--view-mode--hub-teaser">
  <div class="title">H&ocirc;tel Test</div>
</article>
<div class="included-vocabularies"><div>poi_cities</div><div>services_equipement</div></div><div
`;

describe('parseHubPage', () => {
  const page = parseHubPage(HUB_SAMPLE);

  it('reads totals and pagination', () => {
    expect(page.totalResults).toBe(463);
    expect(page.totalPages).toBe(12);
  });

  it('parses cards with coordinates and town', () => {
    expect(page.cards).toHaveLength(2);
    const [ibis, test] = page.cards;
    expect(ibis).toMatchObject({
      nodeId: 29990,
      name: 'Ibis Aix en Provence',
      town: 'Aix-en-Provence',
      lat: 43.51136,
      lng: 5.4628,
    });
    expect(test!.town).toBeNull();
    expect(test!.name).toBe('Hôtel Test');
  });

  it('parses facets with term id, label and count', () => {
    expect(page.facets).toEqual([{ termId: 469, label: 'Parking', count: 419 }]);
  });

  it('reads the included vocabularies', () => {
    expect(page.vocabularies).toEqual(['poi_cities', 'services_equipement']);
  });
});

const DETAIL_SAMPLE = `
<article data-history-node-id="777" role="article" about="/autre/page"></article>
<article data-history-node-id="34657" role="article" about="/les-guides/hebergements/hotels/aix-en-provence/domaine-gao"></article>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Hotel","name":"Domaine Gao","description":"Bastide du XVIIIe si\\u00e8cle.","latitude":43.495324,"longitude":5.395952,"identifier":"5217619","address":{"@type":"PostalAddress","addressLocality":"Aix-en-Provence"}}</script>
<div about="/taxonomy/term/469"> <h2><a href="/taxonomy/term/469"> <div>Parking</div> </a></h2></div>
<div about="/taxonomy/term/463"> <h2><a href="/taxonomy/term/463"> <div>Animaux acceptés</div> </a></h2></div>
<div about="/taxonomy/term/900"> <h2><a href="/taxonomy/term/900"> <div>4 étoiles</div> </a></h2></div>
`;

describe('parseDetailPage', () => {
  const d = parseDetailPage(DETAIL_SAMPLE);

  it('reads the JSON-LD fields', () => {
    expect(d.name).toBe('Domaine Gao');
    expect(d.lat).toBe(43.49532);
    expect(d.lng).toBe(5.39595);
    expect(d.apidaeId).toBe('5217619');
    expect(d.town).toBe('Aix-en-Provence');
  });

  it('reads taxonomy tags and derives the grade', () => {
    expect(d.tags).toEqual(
      expect.arrayContaining([
        { termId: 469, label: 'Parking' },
        { termId: 463, label: 'Animaux acceptés' },
      ]),
    );
    expect(d.grade).toBe(4);
  });

  it('anchors the node id on the page own path', () => {
    expect(
      parseDetailNodeId(DETAIL_SAMPLE, '/les-guides/hebergements/hotels/aix-en-provence/domaine-gao'),
    ).toBe(34657);
    expect(parseDetailNodeId(DETAIL_SAMPLE, '/nope')).toBeNull();
  });
});

describe('pathToTown', () => {
  it('extracts the town segment', () => {
    expect(
      pathToTown('/les-guides/hebergements/hotels/aix-en-provence/domaine-gao', 'hebergements/hotels'),
    ).toBe('Aix En Provence');
    expect(pathToTown('/les-guides/loisirs/only-slug', 'loisirs')).toBeNull();
  });
});
