/**
 * Pure vocabulary listing shared by explain_vocabulary and the stats tool.
 *
 * Alias term ids are hidden from listings: their slugs still resolve (the
 * engine redirects them to the canonical id), but showing "piscine" AND its
 * surface twin "piscine-21060" side by side reads as two different criteria
 * and invites double-counting.
 */

import { fold, type Vocab } from './types';

export interface VocabListing {
  readonly id: number;
  readonly slug: string;
  readonly label: string;
  readonly vocabulary: string | null;
  readonly places: number;
}

export function aliasIds(vocab: Vocab): ReadonlySet<number> {
  const out = new Set<number>();
  for (const tag of Object.values(vocab.tags)) {
    for (const id of tag.aliases ?? []) out.add(id);
  }
  return out;
}

export function listVocabulary(
  vocab: Vocab,
  query: string | undefined,
  limit: number,
): { total: number; items: VocabListing[] } {
  const hidden = aliasIds(vocab);
  const needle = query ? fold(query) : null;
  const all = Object.entries(vocab.tags)
    .filter(([id]) => !hidden.has(Number(id)))
    .map(([id, t]) => ({
      id: Number(id),
      slug: t.slug,
      label: t.label,
      vocabulary: t.vocab ?? null,
      places: t.n,
    }))
    .filter(
      (t) =>
        needle === null || fold(t.label).includes(needle) || t.slug.includes(needle),
    )
    .sort((a, b) => b.places - a.places || a.slug.localeCompare(b.slug));
  return { total: all.length, items: all.slice(0, limit) };
}
