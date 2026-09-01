'use client';

/**
 * The filter rail, in the source site's language: a yellow FILTRES bar with
 * the uppercase display face, then slab-serif controls with square corners.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Store } from '@/lib/store';
import { fold, type ClusterKey } from '@/lib/types';
import { getPresenceBus } from '@/lib/presence';

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
  agentTown = null,
}: {
  store: Store;
  filter: UiFilter;
  onChange: (f: UiFilter) => void;
  total: number;
  /** Town the agent's CURRENT search targets: shown as the dropdown's
   *  selected value when the human has not picked one, so an explicit
   *  "à Marseille" never displays as "Toutes les villes" (field feedback
   *  1 Sep). Display only — the human's own choice always wins. */
  agentTown?: string | null;
}) {
  const t = useTranslations('filters');
  const [query, setQuery] = useState('');
  // The human's explicit "Toutes les villes" must not snap back to the
  // agent's town (audit 15: the display would lie about the real filter).
  // Touched resets when a NEW agent search names a town again.
  const [townTouched, setTownTouched] = useState(false);
  useEffect(() => {
    setTownTouched(false);
  }, [agentTown]);
  // Tool theatre (issue #607): when the agent filters, its tags flash in the
  // rail so the human sees the same control being worked. Timeout cleared on
  // unmount and on every new flash.
  const [flashed, setFlashed] = useState<ReadonlySet<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bus = getPresenceBus();
    const unsubscribe = bus.subscribe(() => {
      const e = bus.last();
      if (e?.phase === 'act' && e.tool === 'filter_places' && e.tags && e.tags.length > 0) {
        setFlashed(new Set(e.tags));
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashed(new Set()), 2000);
      }
    });
    return () => {
      unsubscribe();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

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

  // Fold-match the agent's town against the visible option list so
  // "marseille" still selects "Marseille"; no match, no display.
  const townDisplay = useMemo(() => {
    if (!agentTown || filter.town || townTouched) return null;
    return towns.find((tn) => fold(tn) === fold(agentTown)) ?? null;
  }, [agentTown, filter.town, towns, townTouched]);

  const toggleTag = (slug: string) => {
    const has = filter.tags.includes(slug);
    onChange({
      ...filter,
      tags: has ? filter.tags.filter((s) => s !== slug) : [...filter.tags, slug],
    });
  };

  return (
    <aside aria-label={t('title')} data-presence="filters" className="space-y-4">
      <div className="flex items-center justify-between bg-brand-yellow px-3 py-2.5">
        <h2 className="display-caps text-[14px] leading-none text-brand-ink">{t('title')}</h2>
        <span data-testid="result-count" className="font-slab text-[13px] font-bold text-brand-ink">
          {t('results', { count: total })}
        </span>
      </div>

      <label className="block">
        <span className="sr-only">{t('town')}</span>
        <select
          value={filter.town ?? townDisplay ?? ''}
          onChange={(e) => {
            setTownTouched(true);
            onChange({ ...filter, town: e.target.value || null });
          }}
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
            <label
              className={
                'flex cursor-pointer items-center gap-2 px-1 py-1 hover:bg-brand-paper ' +
                (flashed.has(tag.slug) ? 'agent-flash' : '')
              }
            >
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
