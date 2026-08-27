'use client';

/**
 * Client root. Importing this module on the client registers the nine WebMCP
 * tools as a module-evaluation side effect — deliberately BEFORE the
 * catalogue fetch resolves (spec 7.4): an agent that lands and calls
 * getTools() immediately must see the complete list.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { registerAll } from '@/webmcp/tools';
import { getStore, type ViewState } from '@/lib/store';
import { CLUSTERS, type ClusterKey } from '@/lib/types';
import { FacetPanel, type UiFilter } from './FacetPanel';
import { PlaceList } from './PlaceList';
import { MapView } from './MapView';
import { DemandMirror } from './DemandMirror';

if (typeof document !== 'undefined') {
  registerAll();
}

const EMPTY_FILTER: UiFilter = { tags: [], town: null, cluster: null };

export function App() {
  const t = useTranslations('app');
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <Header locale={locale} title={t('title')} subtitle={t('subtitle')} />
        <p className="mt-8 text-sm text-stone-500">{t('loading')}</p>
      </main>
    );
  }
  return <Loaded locale={locale} />;
}

function Header({
  locale,
  title,
  subtitle,
  webmcp,
}: {
  locale: string;
  title: string;
  subtitle: string;
  webmcp?: boolean;
}) {
  const t = useTranslations('app');
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {webmcp !== undefined && (
          <span
            data-testid="webmcp-status"
            className={
              'rounded-full px-3 py-1 text-xs ' +
              (webmcp ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600')
            }
          >
            {webmcp ? t('webmcpActive') : t('webmcpInactive')}
          </span>
        )}
        <nav aria-label="Language" className="flex gap-2">
          {['fr', 'en'].map((l) => (
            <a
              key={l}
              href={`/${l}`}
              className={
                'rounded px-2 py-1 uppercase ' +
                (l === locale ? 'bg-stone-900 text-white' : 'text-stone-500 hover:text-stone-900')
              }
            >
              {l}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Loaded({ locale }: { locale: string }) {
  const t = useTranslations('app');
  const tc = useTranslations('clusters');
  const tf = useTranslations('footer');
  const store = getStore();
  const view: ViewState = useSyncExternalStore(store.subscribe, store.getView, store.getView);
  const [filter, setFilter] = useState<UiFilter>(EMPTY_FILTER);
  const [webmcp] = useState(
    () => typeof document !== 'undefined' && !!document.modelContext,
  );

  // Human-driven filtering goes through the exact same store call the agent
  // uses; the map and list cannot diverge between the two actors.
  useEffect(() => {
    if (view.loadState !== 'ready') return;
    try {
      store.filter(
        {
          cluster: filter.cluster ?? undefined,
          tags: filter.tags.length > 0 ? filter.tags : undefined,
          town: filter.town ?? undefined,
          limit: 40,
          offset: 0,
        },
        'human',
      );
    } catch {
      // UI slugs come from the vocabulary itself; a miss here means the
      // catalogue changed under us. Show nothing rather than crash.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, view.loadState]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <Header locale={locale} title={t('title')} subtitle={t('subtitle')} webmcp={webmcp} />

      {view.loadState === 'error' && (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t('loadError')}
        </p>
      )}

      <nav aria-label="Clusters" className="mt-6 flex flex-wrap gap-2">
        <ClusterTab
          label={tc('all')}
          active={filter.cluster === null}
          onClick={() => setFilter((f) => ({ ...f, cluster: null }))}
        />
        {CLUSTERS.map((c) => (
          <ClusterTab
            key={c.key}
            label={tc(c.key)}
            active={filter.cluster === c.key}
            onClick={() => setFilter((f) => ({ ...f, cluster: c.key as ClusterKey }))}
          />
        ))}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr_360px]">
        <FacetPanel store={store} filter={filter} onChange={setFilter} total={view.total} />
        <div className="min-w-0 space-y-6">
          <MapView store={store} view={view} />
          <PlaceList store={store} view={view} />
        </div>
        <DemandMirror />
      </div>

      <footer className="mt-12 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>{tf('credit')}</p>
        <p className="mt-1">
          {t('sourceNote', { date: '2026-08-27' })} · {tf('notIndex')}
        </p>
      </footer>
    </main>
  );
}

function ClusterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full px-4 py-1.5 text-sm transition ' +
        (active
          ? 'bg-stone-900 text-white'
          : 'bg-white text-stone-700 shadow-sm ring-1 ring-stone-200 hover:ring-stone-400')
      }
    >
      {label}
    </button>
  );
}
