/**
 * The single mapper every outgoing record passes through (spec 8.5), now
 * shared by the client Store, the GET APIs and the remote MCP endpoint so
 * all four agent surfaces speak byte-identical shapes. Explicit allowlist:
 * a field added to Place reaches no agent until someone adds it here.
 */

import {
  CANONICAL_HOST,
  CLUSTERS,
  categoryOf,
  type Place,
  type PublicPlace,
  type Vocab,
} from './types';

export function toPublicShape(
  p: Place,
  vocab: Vocab,
  aliasToCanonical: ReadonlyMap<number, number>,
): PublicPlace {
  const slugs = new Set<string>();
  for (const rawId of p.tags) {
    const id = aliasToCanonical.get(rawId) ?? rawId;
    const slug = vocab.tags[String(id)]?.slug;
    if (slug) slugs.add(slug);
  }
  const category = categoryOf(p.u);
  return {
    id: p.id,
    name: p.n,
    cluster: CLUSTERS[p.c]?.key ?? 'loisirs',
    town: p.t >= 0 ? (vocab.towns[p.t] ?? null) : null,
    url: `https://${CANONICAL_HOST}${p.u}`,
    grade: p.g,
    tags: [...slugs],
    lat: p.lat,
    lng: p.lng,
    summary: p.s,
    image: p.img ? `https://${CANONICAL_HOST}${p.img}` : null,
    ...(p.d1 !== undefined ? { startDate: p.d1, endDate: p.d2 ?? null } : {}),
    ...(category ? { category } : {}),
  };
}
