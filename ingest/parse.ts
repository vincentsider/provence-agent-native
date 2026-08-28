/**
 * HTML parsers for the myprovence.fr hub and detail pages.
 *
 * Written against the live markup, probed 26-27 Aug 2026 (see the geotravel
 * repo, Docs/V1.5/webmcp/IMPLEMENTATION_PLAN.md appendix A):
 *  - hub teaser: <article data-history-node-id="29990" about="/les-guides/..."
 *      class="node--type--poi node--view-mode--hub-teaser"> with
 *      <div class="title">..</div>, <div class="teaser-city">..</div> and a
 *      hidden <div class="... poi-hub-map-coordinates" lat=".." lon="..">.
 *  - facets: <a ... data-drupal-facet-item-value="469"
 *      data-drupal-facet-item-count="419"><span class="facet-item__value">Parking</span>
 *  - detail: JSON-LD block with name/description/latitude/longitude/identifier,
 *      and every tag as <div about="/taxonomy/term/ID"><h2><a ...><div>LABEL</div>.
 */

import { sanitizeText } from './sanitize';

export interface HubCard {
  readonly nodeId: number;
  readonly path: string;
  readonly name: string;
  readonly town: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** Site-relative styled-image path (keeps the itok token Drupal requires). */
  readonly img: string | null;
}

export interface FacetEntry {
  readonly termId: number;
  readonly label: string;
  readonly count: number;
}

export interface HubPage {
  readonly cards: HubCard[];
  readonly facets: FacetEntry[];
  readonly vocabularies: string[];
  readonly totalResults: number | null;
  readonly totalPages: number | null;
}

const CARD_RE =
  /<article\s+data-history-node-id="(\d+)"[^>]*about="([^"]+)"[^>]*class="[^"]*node--type--poi[\s"]/g;

export function parseHubPage(html: string): HubPage {
  const cards: HubCard[] = [];
  const matches = [...html.matchAll(CARD_RE)];
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? html.length) : html.length;
    const block = html.slice(start, Math.min(end, start + 20_000));

    const title = /<div class="title">([^<]+)<\/div>/.exec(block);
    const city = /<div class="teaser-city">([^<]+)<\/div>/.exec(block);
    const coords = /poi-hub-map-coordinates"\s+lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"/.exec(block);
    const img = /<img[^>]+src="(\/sites\/default\/files\/styles\/[^"]+)"/.exec(block);

    const path = m[2]!;
    if (!path.startsWith('/les-guides/')) return;
    cards.push({
      nodeId: Number(m[1]),
      path,
      name: sanitizeText(title?.[1] ?? pathToName(path), 120),
      town: city ? sanitizeText(city[1]!, 80) : null,
      lat: coords ? round5(Number(coords[1])) : null,
      lng: coords ? round5(Number(coords[2])) : null,
      img: img ? decodeAmp(img[1]!) : null,
    });
  });

  const facets: FacetEntry[] = [];
  const facetRe =
    /data-drupal-facet-item-value="(\d+)"[^>]*data-drupal-facet-item-count="(\d+)"[^>]*>\s*<span class="facet-item__value">([^<]+)<\/span>/g;
  for (const m of html.matchAll(facetRe)) {
    facets.push({
      termId: Number(m[1]),
      label: sanitizeText(m[3]!, 80),
      count: Number(m[2]),
    });
  }

  const vocabBlock = /<div class="included-vocabularies">((?:\s*<div>[a-z0-9_]+<\/div>)+)/.exec(
    html,
  );
  const vocabularies = vocabBlock
    ? [...vocabBlock[1]!.matchAll(/<div>([a-z0-9_]+)<\/div>/g)].map((m) => m[1]!)
    : [];

  const total = /([\d][\d\s ]{0,8})\s*r[ée]sultats/.exec(html);
  const pages = /1\s+SUR\s+(\d+)/.exec(html);

  return {
    cards,
    facets,
    vocabularies,
    totalResults: total ? Number(total[1]!.replace(/\D/g, '')) : null,
    totalPages: pages ? Number(pages[1]) : null,
  };
}

export interface DetailPage {
  /** Event start/end (YYYY-MM-DD): Event JSON-LD when present, else the
   *  first <time datetime> pair in the anchored region. null = undated. */
  readonly d1: string | null;
  readonly d2: string | null;
  /** True when the anchored article is a hub/listing page, not a place. */
  readonly isListPage: boolean;
  /** True when rel=canonical points elsewhere: a stale sitemap entry whose
   *  page now redirects (12 such found 27 Aug; they polluted the catalogue
   *  with the whole sub-hub facet list as their tags). */
  readonly redirected: boolean;
  readonly img: string | null;
  readonly name: string | null;
  readonly summary: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly town: string | null;
  readonly apidaeId: string | null;
  readonly tags: ReadonlyArray<{ termId: number; label: string }>;
  readonly grade: number | null;
}

export function parseDetailPage(html: string, pagePath?: string): DetailPage {
  let name: string | null = null;
  let summary = '';
  let lat: number | null = null;
  let lng: number | null = null;
  let town: string | null = null;
  let apidaeId: string | null = null;

  let d1: string | null = null;
  let d2: string | null = null;

  const ldRe = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(ldRe)) {
    try {
      const doc = JSON.parse(m[1]!) as Record<string, unknown>;
      // Any Event subtype (TheaterEvent, MusicEvent, ...) carries the dates.
      if (typeof doc['@type'] === 'string' && doc['@type'].includes('Event')) {
        if (typeof doc.startDate === 'string') d1 = isoDay(doc.startDate);
        if (typeof doc.endDate === 'string') d2 = isoDay(doc.endDate);
        const loc = doc.location as Record<string, unknown> | undefined;
        const geo = loc?.geo as Record<string, unknown> | undefined;
        if (geo && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
          lat = round5(geo.latitude);
          lng = round5(geo.longitude);
        }
        const addr = loc?.address as Record<string, unknown> | undefined;
        if (addr && typeof addr.addressLocality === 'string') {
          town = sanitizeText(addr.addressLocality, 80);
        }
      }
      if (typeof doc.name === 'string') name = sanitizeText(doc.name, 120);
      if (typeof doc.description === 'string') summary = sanitizeText(doc.description, 280);
      if (typeof doc.latitude === 'number') lat = round5(doc.latitude);
      if (typeof doc.longitude === 'number') lng = round5(doc.longitude);
      if (typeof doc.identifier === 'string') apidaeId = doc.identifier;
      const address = doc.address as Record<string, unknown> | undefined;
      if (address && typeof address.addressLocality === 'string') {
        town = sanitizeText(address.addressLocality, 80);
      }
    } catch {
      // A malformed JSON-LD block is their bug, not ours; skip it.
    }
  }

  // Every taxonomy tag renders as about="/taxonomy/term/ID" + <h2><a><div>LABEL.
  const tagMap = new Map<number, string>();
  const tagRe =
    /about="\/taxonomy\/term\/(\d+)">\s*<h2><a href="\/taxonomy\/term\/\d+">\s*<div>([^<]+)<\/div>/g;
  for (const m of html.matchAll(tagRe)) {
    const id = Number(m[1]);
    if (!tagMap.has(id)) tagMap.set(id, sanitizeText(m[2]!, 80));
  }
  const tags = [...tagMap.entries()].map(([termId, label]) => ({ termId, label }));

  // Grade from a tag labelled "N étoile(s)".
  let grade: number | null = null;
  for (const { label } of tags) {
    const g = /^([1-5])\s*étoiles?$/i.exec(label);
    if (g) grade = Number(g[1]);
  }

  // Anchor on the page's OWN article (about= its path): the first styled
  // image of the whole document is frequently a related-content strip, which
  // is how four different stables once shared one pedal-kart photo. Only the
  // region from the anchored article onward is searched; without an anchor,
  // no image is better than someone else's image.
  let isListPage = false;
  let redirected = false;
  let img: string | null = null;
  if (pagePath) {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
    if (canonical) {
      try {
        const canonicalPath = new URL(canonical[1]!, 'https://www.myprovence.fr').pathname;
        redirected = canonicalPath.replace(/\/$/, '') !== pagePath.replace(/\/$/, '');
      } catch {
        // Unparseable canonical: treat as its own page.
      }
    }
    const escaped = pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anchor = new RegExp(
      `<article[^>]+about="${escaped}"[^>]*class="([^"]*)"`,
    ).exec(html);
    if (anchor) {
      // Two hub families exist: guide hubs (node--type--poi-hub-map) and
      // agenda hubs (node--type--hub-agenda, e.g. /agenda/exposition/arles or
      // the region-theme pages). Both are listings, never places or events.
      isListPage = /poi-hub-map|hub-agenda/.test(anchor[1]!);
      const region = html.slice(anchor.index, anchor.index + 60_000);
      const imgM = /<img[^>]+src="(\/sites\/default\/files\/styles\/[^"]+)"/.exec(region);
      if (imgM) img = decodeAmp(imgM[1]!);
      // Date fallback for events without an Event JSON-LD block (recurring
      // markets, permanent expositions render a visible date range).
      if (d1 === null) {
        const times = [...region.matchAll(/<time datetime="([^"]+)"/g)].map((t) => isoDay(t[1]!));
        if (times[0]) d1 = times[0];
        if (times[1] && times[1] !== times[0]) d2 = times[1];
      }
    }
  }

  return { d1, d2, isListPage, redirected, img, name, summary, lat, lng, town, apidaeId, tags, grade };
}

/** "2026-10-18T00:00:00+02:00" -> "2026-10-18"; garbage -> null. */
function isoDay(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
}

/** src attributes HTML-escape the itok query separator. */
function decodeAmp(s: string): string {
  return s.replace(/&amp;/g, '&');
}

/**
 * The page's own node id: the article whose about= equals the page path.
 * Detail pages carry several data-history-node-id values (related-content
 * blocks); anchoring on about= picks the right one.
 */
export function parseDetailNodeId(html: string, pagePath: string): number | null {
  const escaped = pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(
    `data-history-node-id="(\\d+)"[^>]*about="${escaped}"`,
  ).exec(html);
  return m ? Number(m[1]) : null;
}

export function pathToName(path: string): string {
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  return slug
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Town from the URL when the card lacks one. Hotel paths are
 *  .../<cluster>/<town>/<slug>; loisirs paths insert a subcategory first
 *  (.../loisirs/<subcat>/<town>/<slug>), so the town is always the
 *  second-to-last segment, never the first. */
export function pathToTown(path: string, sitemapPrefix: string): string | null {
  const rest = path.startsWith(sitemapPrefix) ? path.slice(sitemapPrefix.length) : path;
  const segments = rest.split('/').filter(Boolean);
  return segments.length >= 2 ? pathToName(`/${segments[segments.length - 2]!}`) : null;
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
