/**
 * Sitemap enumeration: the ONLY reliable way to enumerate the catalogue.
 *
 * Measured 27 Aug 2026: the hub pagination is non-deterministic — each
 * ?pg=N request serves 40 cards but the windows overlap between requests
 * (12 hotel pages yielded 311 of 463 uniques). The sitemap, by contrast,
 * lists every detail page: 2 846 across the five clusters at time of
 * writing. robots.txt explicitly allows /sitemap.xml.
 */

import { fetchCached } from './fetch';
import { CLUSTERS, CANONICAL_HOST } from '../src/lib/types';

export interface SitemapEntry {
  readonly path: string;
  readonly clusterIdx: number;
}

const SITEMAP_PAGES = ['https://www.myprovence.fr/sitemap.xml?page=1', 'https://www.myprovence.fr/sitemap.xml?page=2'];

export async function enumerateDetailPages(): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const url of SITEMAP_PAGES) {
    const xml = await fetchCached(url);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      let path: string;
      try {
        const u = new URL(m[1]!);
        if (u.hostname !== CANONICAL_HOST && u.hostname !== 'myprovence.fr') continue;
        path = u.pathname;
      } catch {
        continue;
      }
      if (seen.has(path)) continue;
      for (const [clusterIdx, cluster] of CLUSTERS.entries()) {
        const prefix = cluster.sitemapPrefix;
        if (path.startsWith(prefix) && path.slice(prefix.length).split('/').filter(Boolean).length >= 2) {
          seen.add(path);
          out.push({ path, clusterIdx });
          break;
        }
      }
    }
  }
  return out;
}
