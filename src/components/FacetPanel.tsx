'use client';

/**
 * The filter rail, in the source site's language: a yellow FILTRES bar with
 * the uppercase display face, then slab-serif controls with square corners.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Store } from '@/lib/store';
import { fold, type ClusterKey } from '@/lib/types';

export interface UiFilter {
  readonly tags: readonly string[];
  readonly town: string | null;
  readonly cluster: ClusterKey | null;
}

const VISIBLE_TAGS = 30;

export function FacetPanel({
  store,
  filter,
  onChange,
  total,
}: {
  store: Store;
  filter: UiFilter;
  onChange: (f: UiFilter) => void;
  total: number;
}) {
  const t = useTranslations('filters');
  const [query, setQuery] = useState('');

  // Facets scoped to the active cluster tab, exactly like each myprovence.fr
  // hub shows its OWN facet list with its own populations, count-descending.
  const scope = useMemo(() => {
    if (!store.isReady) return null;
    return store.scopeFor(filter.cluster);
    // store.vocab is REPLACED when the catalogue loads; depending on the
    // stable store object left this memo permanently empty (first-paint bug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, store.vocab, filter.cluster]);

  const tags = useMemo(() => {
    if (!scope) return [];
    const needle = fold(query);
    return [...scope.tagCounts.entries()]
      .map(([id, n]) => {
        const tag = store.vocab.tags[String(id)];
        return tag ? { slug: tag.slug, label: tag.label, n } : null;
      })
      .filter((tag): tag is { slug: string; label: string; n: number } => tag !== null)
      .filter(
        (tag) =>
          needle === '' || fold(tag.label).includes(needle) || tag.slug.includes(needle),
      )
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'fr'))
      .slice(0, VISIBLE_TAGS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, store.vocab, query]);

  const towns = useMemo(() => {
    if (!scope) return [];
    return [...scope.townIndices]
      .map((i) => store.vocab.towns[i])
      .filter((town): town is string => town !== undefined)
      .sort((a, b) => a.localeCompare(b, 'fr'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, store.vocab]);

  const toggleTag = (slug: string) => {
    const has = filter.tags.includes(slug);
    onChange({
      ...filter,
      tags: has ? filter.tags.filter((s) => s !== slug) : [...filter.tags, slug],
    });
  };

  return (
    <aside aria-label={t('title')} className="space-y-4">
      <div className="flex items-center justify-between bg-brand-yellow px-3 py-2.5">
        <h2 className="display-caps text-[14px] leading-none text-brand-ink">{t('title')}</h2>
        <span data-testid="result-count" className="font-slab text-[13px] font-bold text-brand-ink">
          {t('results', { count: total })}
        </span>
      </div>

      <label className="block">
        <span className="sr-only">{t('town')}</span>
        <select
          value={filter.town ?? ''}
          onChange={(e) => onChange({ ...filter, town: e.target.value || null })}
          className="w-full border border-brand-ink/30 bg-white px-2 py-2 font-slab text-[14px] focus:border-brand-ink focus:outline-none"
        >
          <option value="">{t('allTowns')}</option>
          {towns.map((town) => (
            <option key={town} value={town}>
              {town}
            </option>
          ))}
        </select>
      </label>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchTags')}
        className="w-full border border-brand-ink/30 bg-white px-2 py-2 font-slab text-[14px] placeholder:text-brand-ink/40 focus:border-brand-ink focus:outline-none"
      />

      <ul className="max-h-[300px] space-y-0.5 overflow-y-auto font-slab text-[14px] lg:max-h-none lg:overflow-visible">
        {tags.map((tag) => (
          <li key={tag.slug}>
            <label className="flex cursor-pointer items-center gap-2 px-1 py-1 hover:bg-brand-paper">
              <input
                type="checkbox"
                checked={filter.tags.includes(tag.slug)}
                onChange={() => toggleTag(tag.slug)}
                className="h-4 w-4 rounded-none accent-[#434343]"
              />
              <span className="min-w-0 flex-1 truncate">{tag.label}</span>
              <span className="text-[12px] tabular-nums text-brand-ink/40">{tag.n}</span>
            </label>
          </li>
        ))}
      </ul>

      {(filter.tags.length > 0 || filter.town !== null) && (
        <button
          type="button"
          onClick={() => onChange({ ...filter, tags: [], town: null })}
          className="display-caps bg-brand-ink px-3 py-2 text-[11px] text-brand-yellow hover:bg-brand-petrol"
        >
          {t('clear')}
        </button>
      )}
    </aside>
  );
}
