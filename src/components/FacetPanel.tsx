'use client';

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

  const tags = useMemo(() => {
    const needle = fold(query);
    return Object.values(store.vocab.tags)
      .filter((tag) => tag.n > 0)
      .filter((tag) => needle === '' || fold(tag.label).includes(needle) || tag.slug.includes(needle))
      .sort((a, b) => b.n - a.n)
      .slice(0, VISIBLE_TAGS);
  }, [store, query]);

  const towns = useMemo(
    () => [...store.vocab.towns].sort((a, b) => a.localeCompare(b, 'fr')),
    [store],
  );

  const toggleTag = (slug: string) => {
    const has = filter.tags.includes(slug);
    onChange({
      ...filter,
      tags: has ? filter.tags.filter((s) => s !== slug) : [...filter.tags, slug],
    });
  };

  return (
    <aside aria-label={t('title')} className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('title')}
        </h2>
        <span data-testid="result-count" className="text-sm font-medium">
          {t('results', { count: total })}
        </span>
      </div>

      <label className="block">
        <span className="sr-only">{t('town')}</span>
        <select
          value={filter.town ?? ''}
          onChange={(e) => onChange({ ...filter, town: e.target.value || null })}
          className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
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
        className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
      />

      <ul className="space-y-1 text-sm">
        {tags.map((tag) => (
          <li key={tag.slug}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-100">
              <input
                type="checkbox"
                checked={filter.tags.includes(tag.slug)}
                onChange={() => toggleTag(tag.slug)}
                className="accent-stone-900"
              />
              <span className="min-w-0 flex-1 truncate">{tag.label}</span>
              <span className="text-xs tabular-nums text-stone-400">{tag.n}</span>
            </label>
          </li>
        ))}
      </ul>

      {(filter.tags.length > 0 || filter.town !== null) && (
        <button
          type="button"
          onClick={() => onChange({ ...filter, tags: [], town: null })}
          className="text-xs text-stone-500 underline hover:text-stone-900"
        >
          {t('clear')}
        </button>
      )}
    </aside>
  );
}
