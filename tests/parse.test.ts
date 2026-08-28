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
  <img loading="lazy" src="/sites/default/files/styles/main/public/poi/5217912/386.jpg?itok=Z3eFl20j" width="1600" height="1199" alt="" />
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
      img: '/sites/default/files/styles/main/public/poi/5217912/386.jpg?itok=Z3eFl20j',
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
<link rel="canonical" href="https://www.myprovence.fr/les-guides/hebergements/hotels/aix-en-provence/domaine-gao" />
<article data-history-node-id="777" role="article" about="/autre/page" class="node--type--edito">
  <img src="/sites/default/files/styles/main/public/related/WRONG.jpg?itok=x" />
</article>
<article data-history-node-id="34657" role="article" about="/les-guides/hebergements/hotels/aix-en-provence/domaine-gao" class="node--type--poi node--view-mode--full">
  <img src="/sites/default/files/styles/main/public/poi/5217619/RIGHT.jpg?itok=y" />
</article>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Hotel","name":"Domaine Gao","description":"Bastide du XVIIIe si\\u00e8cle.","latitude":43.495324,"longitude":5.395952,"identifier":"5217619","address":{"@type":"PostalAddress","addressLocality":"Aix-en-Provence"}}</script>
<div about="/taxonomy/term/469"> <h2><a href="/taxonomy/term/469"> <div>Parking</div> </a></h2></div>
<div about="/taxonomy/term/463"> <h2><a href="/taxonomy/term/463"> <div>Animaux acceptés</div> </a></h2></div>
<div about="/taxonomy/term/900"> <h2><a href="/taxonomy/term/900"> <div>4 étoiles</div> </a></h2></div>
`;

describe('parseDetailPage', () => {
  const d = parseDetailPage(
    DETAIL_SAMPLE,
    '/les-guides/hebergements/hotels/aix-en-provence/domaine-gao',
  );

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

  it('takes the image from the page own article, never a related strip', () => {
    expect(d.img).toBe('/sites/default/files/styles/main/public/poi/5217619/RIGHT.jpg?itok=y');
    expect(d.isListPage).toBe(false);
  });

  it('flags stale entries whose page redirects to a hub', () => {
    const html = '<link rel="canonical" href="https://www.myprovence.fr/les-guides/loisirs/loisirs-natures" />' +
      '<article about="/les-guides/loisirs/loisirs-natures" class="node--type--poi-hub-map"></article>';
    const r = parseDetailPage(html, '/les-guides/loisirs/loisirs-natures/fontvieille/centre-equestre');
    expect(r.redirected).toBe(true);
  });

  it('keeps a page whose canonical is itself', () => {
    expect(d.redirected).toBe(false);
  });

  it('flags agenda hub listings (city/theme aggregates) as list pages', () => {
    const html =
      '<link rel="canonical" href="https://www.myprovence.fr/agenda/exposition/arles" />' +
      '<article data-history-node-id="2184" about="/agenda/exposition/arles" class="node--type--hub-agenda node--view-mode--full"></article>';
    const r = parseDetailPage(html, '/agenda/exposition/arles');
    expect(r.isListPage).toBe(true);
  });

  it('flags hub/listing pages misfiled as places', () => {
    const listHtml = '<article data-history-node-id="413" about="/les-guides/loisirs/tout-le-guide/arles" class="node--type--poi-hub-map node--view-mode--full"></article>';
    const r = parseDetailPage(listHtml, '/les-guides/loisirs/tout-le-guide/arles');
    expect(r.isListPage).toBe(true);
  });

  it('anchors the node id on the page own path', () => {
    expect(
      parseDetailNodeId(DETAIL_SAMPLE, '/les-guides/hebergements/hotels/aix-en-provence/domaine-gao'),
    ).toBe(34657);
    expect(parseDetailNodeId(DETAIL_SAMPLE, '/nope')).toBeNull();
  });
});

const EVENT_SAMPLE = `
<link rel="canonical" href="https://www.myprovence.fr/agenda/theatre/pertuis/le-schpountz" />
<article data-history-node-id="900" role="article" about="/agenda/theatre/pertuis/le-schpountz" class="node--type--poi node--view-mode--full">
  <img src="/sites/default/files/styles/main/public/poi/1/aff.jpg?itok=z" />
</article>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TheaterEvent","name":"Le Schpountz","startDate":"2026-10-08T00:00:00+02:00","endDate":"2026-10-10T00:00:00+02:00","location":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Pertuis"}}}</script>
`;

describe('parseDetailPage on events', () => {
  it('reads Event JSON-LD dates as ISO days and the town from location', () => {
    const d = parseDetailPage(EVENT_SAMPLE, '/agenda/theatre/pertuis/le-schpountz');
    expect(d.d1).toBe('2026-10-08');
    expect(d.d2).toBe('2026-10-10');
    expect(d.town).toBe('Pertuis');
    expect(d.name).toBe('Le Schpountz');
    expect(d.redirected).toBe(false);
  });

  it('falls back to the visible time range when no Event JSON-LD exists', () => {
    const html =
      '<link rel="canonical" href="https://www.myprovence.fr/agenda/marche/aix/marche-x" />' +
      '<article about="/agenda/marche/aix/marche-x" class="node--type--poi">' +
      '<time datetime="2026-09-01T12:00:00Z">1 sept</time> au <time datetime="2026-12-20T12:00:00Z">20 dec</time>' +
      '</article>';
    const d = parseDetailPage(html, '/agenda/marche/aix/marche-x');
    expect(d.d1).toBe('2026-09-01');
    expect(d.d2).toBe('2026-12-20');
  });

  it('leaves undated events null', () => {
    const html =
      '<link rel="canonical" href="https://www.myprovence.fr/agenda/exposition/marseille/expo-x" />' +
      '<article about="/agenda/exposition/marseille/expo-x" class="node--type--poi"></article>';
    const d = parseDetailPage(html, '/agenda/exposition/marseille/expo-x');
    expect(d.d1).toBeNull();
    expect(d.d2).toBeNull();
  });
});

describe('pathToTown', () => {
  it('extracts the town segment', () => {
    expect(
      pathToTown('/les-guides/hebergements/hotels/aix-en-provence/domaine-gao', '/les-guides/hebergements/hotels/'),
    ).toBe('Aix En Provence');
    // loisirs paths insert a subcategory: town is second-to-last, not first
    expect(
      pathToTown('/les-guides/loisirs/artisans-et-producteurs/eyragues/les-arts-au-soleil', '/les-guides/loisirs/'),
    ).toBe('Eyragues');
    expect(pathToTown('/les-guides/loisirs/only-slug', '/les-guides/loisirs/')).toBeNull();
  });
});
