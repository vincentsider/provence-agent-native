'use client';

import { useTranslations } from 'next-intl';
import type { Store, ViewState } from '@/lib/store';
import { CANONICAL_HOST, CLUSTERS } from '@/lib/types';

const LIST_CAP = 60;

export function PlaceList({ store, view }: { store: Store; view: ViewState }) {
  const t = useTranslations('list');
  const tc = useTranslations('clusters');
  const tf = useTranslations('filters');
  const places = store.catalog.places;
  const shown = view.highlighted.slice(0, LIST_CAP);

  return (
    <section aria-label="Résultats">
      <div className="mb-2 flex items-baseline justify-between text-xs text-stone-500">
        <span data-testid="highlighted-count">{view.highlighted.length}</span>
        <span>{tf('shown', { shown: shown.length, total: view.total })}</span>
        {view.lastActor === 'agent' && (
          <span className="rounded bg-violet-100 px-2 py-0.5 text-violet-800">
            {t('agentDrove')}
          </span>
        )}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((i) => {
          const p = places[i];
          if (!p) return null;
          const clusterKey = CLUSTERS[p.c]?.key;
          return (
            <li
              key={p.id}
              className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate font-medium">{p.n}</h3>
                {p.g !== null && (
                  <span className="shrink-0 text-xs text-amber-600">
                    {t('stars', { count: p.g })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-stone-500">
                {clusterKey ? tc(clusterKey) : ''}
                {p.t >= 0 && store.vocab.towns[p.t] ? ` · ${store.vocab.towns[p.t]}` : ''}
              </p>
              {p.s && <p className="mt-2 line-clamp-3 text-sm text-stone-600">{p.s}</p>}
              <a
                href={`https://${CANONICAL_HOST}${p.u}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-teal-700 underline hover:text-teal-900"
              >
                {t('viewOnSite')}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
