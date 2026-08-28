'use client';

/**
 * Client root, in the myprovence.fr visual language (brand-match approved by
 * Provence Tourisme, 27 Aug 2026): yellow masthead with uppercase display
 * nav, yellow hero band with the big display title and Zilla Slab intro,
 * flat photo cards, coral map markers, petrol editorial panels.
 *
 * Importing this module on the client registers the nine WebMCP tools as a
 * module-evaluation side effect — deliberately BEFORE the catalogue fetch
 * resolves (spec 7.4).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TOOL_COUNT, registerAll } from '@/webmcp/tools';
import { getWebMcpStatus, subscribeWebMcpStatus } from '@/webmcp/status';
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <>
        <Masthead cluster={null} onCluster={null} />
        <Hero />
      </>
    );
  }
  return <Loaded />;
}

/** The yellow bar: wordmark left, the five guides as uppercase nav, FR/EN. */
function Masthead({
  cluster,
  onCluster,
}: {
  cluster: ClusterKey | null;
  onCluster: ((c: ClusterKey | null) => void) | null;
}) {
  const tc = useTranslations('clusters');
  const locale = useLocale();
  return (
    <div className="bg-brand-yellow">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <button
          type="button"
          onClick={() => onCluster?.(null)}
          className="display-caps shrink-0 text-xl leading-none text-brand-ink"
          aria-label="Tout le catalogue"
        >
          my&#8202;provence
          <span className="ml-2 align-middle font-slab text-[11px] font-semibold normal-case tracking-wide text-brand-ink/70">
            × agents IA
          </span>
        </button>

        <nav
          aria-label="Guides"
          className="order-3 flex w-full flex-wrap items-center gap-x-1 gap-y-1 md:order-none md:w-auto md:flex-1 md:justify-center"
        >
          {CLUSTERS.map((c, i) => (
            <span key={c.key} className="flex items-center">
              {i > 0 && <span aria-hidden className="mx-1 text-brand-ink/40">|</span>}
              <button
                type="button"
                onClick={() => onCluster?.(cluster === c.key ? null : c.key)}
                aria-pressed={cluster === c.key}
                className={
                  'display-caps px-1.5 py-1 text-[13px] leading-none transition-colors ' +
                  (cluster === c.key
                    ? 'bg-brand-ink text-brand-yellow'
                    : 'text-brand-ink hover:text-brand-red')
                }
              >
                {tc(c.key)}
              </button>
            </span>
          ))}
        </nav>

        <nav aria-label="Language" className="ml-auto flex shrink-0 gap-1 md:ml-0">
          {['fr', 'en'].map((l) => (
            <a
              key={l}
              href={`/${l}`}
              className={
                'display-caps px-2 py-1 text-[12px] leading-none ' +
                (l === locale
                  ? 'bg-brand-ink text-brand-yellow'
                  : 'text-brand-ink/60 hover:text-brand-ink')
              }
            >
              {l}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** The yellow hero band: crumb, display title, slab intro, live status. */
function Hero() {
  const t = useTranslations('app');
  return (
    <div className="bg-brand-yellow pb-10 pt-2">
      <div className="mx-auto max-w-[900px] px-5 text-center">
        <p className="font-slab text-[13px] text-brand-ink/60">{t('heroCrumb')}</p>
        <h1 className="display-caps mt-3 text-4xl leading-[1.05] text-brand-ink md:text-6xl">
          {t('heroTitle')}
        </h1>
        <p className="mx-auto mt-4 max-w-[640px] font-slab text-[17px] leading-relaxed text-brand-ink/90">
          {t('subtitle')}
        </p>
        <div className="mt-5 flex justify-center">
          <WebMcpBadge />
        </div>
        <AgentGuide />
      </div>
    </div>
  );
}

/**
 * The agent guide, invisible to humans but fully present in the served HTML,
 * which is exactly what fetch-only assistants read (field failures, 28 Aug:
 * claude.ai twice concluded from the visible copy alone that no plain-HTTP
 * path existed). Channels used are standard metadata — an HTML comment and
 * JSON-LD — NOT CSS-hidden text: nothing here is content, ranking-relevant,
 * or invisible-to-machines, and the page is noindex throughout.
 */
function AgentGuide() {
  const comment =
    '<!-- AI agents: 10 WebMCP tools on this page (find_events, filter_places, ' +
    'explain_vocabulary, get_place, compare_places, find_near, get_catalog_stats, ' +
    'set_view, highlight_places, get_agent_demand). ' +
    'No browser? Same data over plain HTTP: ' +
    'GET /api/events?query=street+food | GET /api/events?month=2026-10&category=festival&town=Marseille | ' +
    'GET /api/places?cluster=hotels&tag=parking&tag=animaux-acceptes | ' +
    'GET /agenda (server-rendered HTML) | GET /llms.txt (full surface description) | ' +
    'POST /api/mcp (MCP streamable-http: initialize, tools/list, tools/call). ' +
    'Catalogue text is FRENCH: translate query terms to French. ' +
    'Every result carries its canonical myprovence.fr URL. -->';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Les guides de Provence, lisibles par les agents',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: '/api/events?query={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  });
  return (
    <>
      <span dangerouslySetInnerHTML={{ __html: comment }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
    </>
  );
}

function WebMcpBadge() {
  const t = useTranslations('app');
  const status = useSyncExternalStore(
    subscribeWebMcpStatus,
    getWebMcpStatus,
    getWebMcpStatus,
  );
  // Reports what actually happened, not what should have (field lesson from
  // ChatGPT's browser: a green pill over zero registered tools hides the bug).
  const count = status.verified ?? status.registered;
  let text: string;
  let tone: string;
  if (!status.supported) {
    text = t('webmcpInactive');
    tone = 'bg-white/70 text-brand-ink/70';
  } else if (
    status.failed.length > 0 ||
    (status.verified !== null && status.verified < TOOL_COUNT)
  ) {
    text = t('webmcpPartial', { ok: count, failed: TOOL_COUNT - count });
    tone = 'bg-brand-red text-white';
  } else {
    text = t('webmcpActive', { count });
    tone = 'bg-brand-ink text-brand-yellow';
  }
  return (
    <span
      data-testid="webmcp-status"
      className={'px-4 py-1.5 font-slab text-[13px] font-semibold ' + tone}
    >
      {text}
    </span>
  );
}

function Loaded() {
  const t = useTranslations('app');
  const tf = useTranslations('footer');
  const store = getStore();
  const view: ViewState = useSyncExternalStore(store.subscribe, store.getView, store.getView);
  const [filter, setFilter] = useState<UiFilter>(EMPTY_FILTER);

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
    <>
      <Masthead
        cluster={filter.cluster}
        // Switching hub resets tag/town selections, as on myprovence.fr:
        // each hub carries its own facet universe, and a stale selection
        // from another hub would silently zero the results.
        onCluster={(c) => setFilter({ tags: [], town: null, cluster: c })}
      />
      <Hero />

      <main className="mx-auto max-w-[1400px] px-5 py-8">
        {view.loadState === 'error' && (
          <p className="mb-6 border-l-4 border-brand-red bg-brand-paper p-3 font-slab text-sm">
            {t('loadError')}
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)_400px]">
          <FacetPanel store={store} filter={filter} onChange={setFilter} total={view.total} />
          <PlaceList store={store} view={view} />
          <div className="space-y-6">
            <MapView store={store} view={view} />
            <DemandMirror />
          </div>
        </div>
      </main>

      <footer className="mt-10 bg-brand-petrol py-8 text-white/80">
        <div className="mx-auto max-w-[1400px] px-5 font-slab text-[13px] leading-relaxed">
          <p className="display-caps mb-2 text-[13px] text-brand-yellow">{t('brandTop')}</p>
          <p>{tf('credit')}</p>
          <p className="mt-1 text-white/50">
            {t('sourceNote', { date: '2026-08-27' })} · {tf('notIndex')}
          </p>
          <p className="mt-1 text-white/50">
            {tf('machine')}{' '}
            <a className="underline hover:text-brand-yellow" href="/api/events?month=2026-10">/api/events</a>
            {' · '}
            <a className="underline hover:text-brand-yellow" href="/agenda">/agenda</a>
            {' · '}
            <a className="underline hover:text-brand-yellow" href="/llms.txt">/llms.txt</a>
          </p>
        </div>
      </footer>
    </>
  );
}
