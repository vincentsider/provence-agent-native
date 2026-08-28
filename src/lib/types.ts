/**
 * Shared canonical types for the catalogue artefacts and the runtime engine.
 *
 * The wire format is deliberately terse (single-letter keys) because the
 * catalogue ships to every visitor: 2 798 records x field names is real bytes.
 * See Docs/V1.5/webmcp/IMPLEMENTATION_PLAN.md (geotravel repo) section 5.1.
 */

/**
 * The six catalogue segments. `hubPath` is the listing page under
 * /les-guides (null = no hub stage: agenda is enumerated from the sitemap
 * only). `sitemapPrefix` is explicit because two call sites once hardcoded
 * "/les-guides/" and would have silently skipped the agenda.
 */
export const CLUSTERS = [
  { key: 'hotels', hubPath: 'hebergements/hotels', sitemapPrefix: '/les-guides/hebergements/hotels/' },
  { key: 'campings', hubPath: 'hebergements/campings', sitemapPrefix: '/les-guides/hebergements/campings/' },
  { key: 'chambres-d-hotes', hubPath: 'hebergements/chambres-d-hotes', sitemapPrefix: '/les-guides/hebergements/chambres-d-hotes/' },
  { key: 'loisirs', hubPath: 'loisirs', sitemapPrefix: '/les-guides/loisirs/' },
  { key: 'itineraires', hubPath: 'itineraires', sitemapPrefix: '/les-guides/itineraires/' },
  { key: 'agenda', hubPath: null, sitemapPrefix: '/agenda/' },
] as const;

export type ClusterKey = (typeof CLUSTERS)[number]['key'];

export const CLUSTER_KEYS = CLUSTERS.map((c) => c.key) as [
  ClusterKey,
  ...ClusterKey[],
];

export const CANONICAL_HOST = 'www.myprovence.fr';

/** One place, as stored in catalog.<hash>.json. */
export interface Place {
  /** Drupal node id (data-history-node-id). Stable primary key. */
  readonly id: number;
  /** Cluster index into CLUSTERS. */
  readonly c: number;
  /** Display name, sanitised, <= 120 chars. */
  readonly n: string;
  /** Town index into Vocab.towns. -1 when unknown. */
  readonly t: number;
  /** WGS84, 5 decimal places (~1.1 m). null when the source has none. */
  readonly lat: number | null;
  readonly lng: number | null;
  /** Star rating 1..5, or null. */
  readonly g: number | null;
  /** Sorted ascending taxonomy term ids. Sorted so intersection is a merge. */
  readonly tags: readonly number[];
  /** Canonical myprovence.fr path (leading slash). Always present. */
  readonly u: string;
  /** Sanitised plain-text summary, <= 280 chars. Empty until enriched. */
  readonly s: string;
  /** First photo: site-relative path incl. style variant + itok. null if none. */
  readonly img: string | null;
  /** Event start date (YYYY-MM-DD). Present only on agenda records; an
   *  undated event (permanent exposition) carries null and never matches a
   *  dated query. Absent entirely on guides records: zero wire bytes. */
  readonly d1?: string | null;
  /** Event end date, when the source states one. */
  readonly d2?: string | null;
}

export interface VocabTag {
  readonly label: string;
  /** Which Drupal vocabulary it came from, when known. */
  readonly vocab?: string;
  /** Population on the source facet, when the facet reported one. */
  readonly n: number;
  /** Deterministic ASCII slug. Unique across the vocabulary. */
  readonly slug: string;
  /** Term ids that are near-synonyms of this tag (same population, overlapping label). */
  readonly aliases?: readonly number[];
  /** 'facet' = seen on a hub facet; 'detail' = only seen on detail pages. */
  readonly source: 'facet' | 'detail';
}

export interface Vocab {
  readonly version: 1;
  /** Term id (as string key, JSON) -> tag. */
  readonly tags: Readonly<Record<string, VocabTag>>;
  /** Town display names; Place.t indexes into this. */
  readonly towns: readonly string[];
}

export interface Catalog {
  readonly version: 1;
  readonly places: readonly Place[];
}

export interface Manifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly source: 'public' | 'relay';
  readonly counts: {
    readonly places: number;
    /** Agenda records, shipped in the separate events artefact. */
    readonly events?: number;
    readonly tags: number;
    readonly towns: number;
    readonly perCluster: Readonly<Record<ClusterKey, number>>;
  };
  readonly files: {
    readonly catalog: string;
    readonly vocab: string;
    readonly events?: string;
  };
  readonly sha256: {
    readonly catalog: string;
    readonly vocab: string;
    readonly events?: string;
  };
}

/** The compact shape every tool result exposes. Explicit allowlist: a field
 *  added to Place does not reach an agent until someone adds it here. */
export interface PublicPlace {
  readonly id: number;
  readonly name: string;
  readonly cluster: ClusterKey;
  readonly town: string | null;
  readonly url: string;
  readonly grade: number | null;
  readonly tags: readonly string[];
  readonly lat: number | null;
  readonly lng: number | null;
  readonly summary: string;
  /** Absolute photo URL on myprovence.fr, or null. */
  readonly image: string | null;
  /** Agenda records only: ISO start/end dates and the URL-derived category. */
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly category?: string;
}

export interface FilterInput {
  readonly cluster?: ClusterKey;
  readonly tags?: readonly string[];
  readonly anyTags?: readonly string[];
  readonly town?: string;
  readonly minGrade?: number;
  /** Date-overlap window (YYYY-MM-DD, inclusive): a record matches when
   *  [d1, d2 ?? d1] intersects [from, to]. Records without d1 never match a
   *  dated query. Setting either also sorts results chronologically. */
  readonly from?: string;
  readonly to?: string;
  /** /agenda/<category>/... URL segment; validated by the caller. */
  readonly category?: string;
  /** Free-text search over name + summary + town, accent- and case-folded;
   *  every whitespace-separated term must match. */
  readonly query?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface FilterResult {
  readonly total: number;
  readonly indices: readonly number[];
}

/** URL-derived event category: /agenda/<cat>/... -> "<cat>", else null. */
export function categoryOf(path: string): string | null {
  const m = /^\/agenda\/([a-z0-9-]+)\//.exec(path);
  return m ? m[1]! : null;
}

/** Fold accents/case for matching: "Aix-en-Provence" -> "aix-en-provence". */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Deterministic ASCII slug: fold, non-alnum -> '-', collapse, trim. */
export function slugify(input: string): string {
  return fold(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
