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
import { startViewportTool } from '@/webmcp/dynamic';
import { startWishHeartbeat } from '@/webmcp/heartbeat';
import { getServerWebMcpStatus, getWebMcpStatus, subscribeWebMcpStatus } from '@/webmcp/status';
import { getStore, type ViewState } from '@/lib/store';
import { CLUSTERS, type ClusterKey } from '@/lib/types';
import { FacetPanel, type UiFilter } from './FacetPanel';
import { PlaceList } from './PlaceList';
import { MapView } from './MapView';
import { DemandMirror } from './DemandMirror';
import { AgentPresence } from './AgentPresence';
import { ElicitationCards } from './ElicitationCards';
import { PostcardPanel } from './PostcardPanel';
import { WishBox } from './WishBox';
import { MissionHero } from './MissionBanner';
import { CarnetButton, CarnetPanel } from './CarnetPanel';
import { getScoutStore } from '@/lib/scouts';
import { getViewportStore } from '@/lib/viewport';
import type { UpcomingEvent } from '@/lib/build-data';

if (typeof document !== 'undefined') {
  registerAll();
  startViewportTool();
  startWishHeartbeat();
}

const EMPTY_FILTER: UiFilter = { tags: [], town: null, cluster: null };

export function App({
  upcoming = [],
  snapshotDate = null,
}: {
  upcoming?: UpcomingEvent[];
  snapshotDate?: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // The pre-hydration shell IS what fetch-only assistants read: it must
    // carry real content, not just chrome (field failures, 28 Aug).
    return (
      <>
        <Masthead cluster={null} onCluster={null} />
        <Hero />
        <UpcomingStrip upcoming={upcoming} />
        <SiteFooter snapshotDate={snapshotDate} />
      </>
    );
  }
  return <Loaded upcoming={upcoming} snapshotDate={snapshotDate} />;
}

/**
 * Server-rendered upcoming events, styled in the brand: a real content
 * section humans get value from, and the channel through which agents
 * without a browser receive actual data (their extractors keep visible
 * text and links; they drop comments, head links and JSON-LD).
 */
function UpcomingStrip({ upcoming }: { upcoming: UpcomingEvent[] }) {
  const t = useTranslations('upcoming');
  const locale = useLocale();
  if (upcoming.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const d = (s: string) => fmt.format(new Date(`${s}T12:00:00Z`));
  return (
    <section aria-label={t('title')} className="border-t border-brand-ink/10 bg-brand-paper">
      <div className="mx-auto max-w-[1400px] px-5 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="display-caps text-xl text-brand-ink">{t('title')}</h2>
          <a className="font-slab text-[14px] text-brand-coral underline hover:text-brand-red" href="/agenda">
            {t('all')} →
          </a>
        </div>
        <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((e) => (
            <li key={e.path} className="font-slab text-[15px] leading-relaxed">
              <span className="display-caps mr-2 bg-brand-yellow px-1.5 py-0.5 text-[10px] text-brand-ink">
                {d(e.d1)}
                {e.d2 && e.d2 !== e.d1 ? ` – ${d(e.d2)}` : ''}
              </span>
              <a
                className="hover:text-brand-red hover:underline"
                href={`https://www.myprovence.fr${e.path}`}
              >
                {e.name}
              </a>
              <span className="text-brand-ink/50"> · {e.town}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
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

/** The hero band. At rest: the classic yellow masthead. During a mission:
 *  the findings' real photographs flood it (MissionHero) and the wish box
 *  rides along so the visitor can relaunch from the same spot. */
function Hero() {
  const t = useTranslations('app');
  const scoutStore = typeof window !== 'undefined' ? getScoutStore() : null;
  const mission = useSyncExternalStore(
    scoutStore?.subscribe ?? (() => () => {}),
    scoutStore?.getSnapshot ?? (() => null),
    () => null,
  );
  if (mission) {
    return (
      <MissionHero mission={mission}>
        <WishBox />
        <div className="mt-5 flex justify-center">
          <WebMcpBadge />
        </div>
        <AgentGuide />
      </MissionHero>
    );
  }
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
        <WishBox />
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
    '<!-- AI agents: 20+ WebMCP tools on this page (find_events, filter_places, ' +
    'explain_vocabulary, get_place, compare_places, find_near, find_tonight, ' +
    'get_catalog_stats, set_view, highlight_places, get_agent_demand, ask_visitor, ' +
    'get_input_result, get_visitor_signals, get_demand_pulse, send_scouts, ' +
    'get_scout_reports, get_visitor_view, write_postcard, compose_carnet, and a dynamic ' +
    'pin_visible_place scoped to the visible map). ' +
    'No browser? Same data over plain HTTP: ' +
    'GET /api/events?query=street+food | GET /api/events?month=2026-10&category=festival&town=Marseille | ' +
    'GET /api/places?cluster=hotels&tag=parking&tag=animaux-acceptes | ' +
    'GET /agenda (server-rendered HTML) | GET /llms.txt (full surface description) | ' +
    'POST /api/mcp (MCP streamable-http: initialize, tools/list, tools/call). ' +
    'Catalogue text is FRENCH: translate query terms to French. A fuzzy ' +
    'multi-criteria wish in any language -> send_scouts; a wish with no place ' +
    'named is still about Provence, never another region. ' +
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
    getServerWebMcpStatus,
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

function Loaded({
  upcoming,
  snapshotDate,
}: {
  upcoming: UpcomingEvent[];
  snapshotDate: string | null;
}) {
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
      // The agent's get_visitor_view reads the human's active filter live.
      getViewportStore().setFilter({
        cluster: filter.cluster,
        tags: filter.tags,
        town: filter.town,
      });
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

      <UpcomingStrip upcoming={upcoming} />
      <SiteFooter snapshotDate={snapshotDate} />
      <AgentPresence />
      <ElicitationCards />
      <PostcardPanel />
      <CarnetPanel />
      <CarnetButton />
    </>
  );
}

/** Attribution + machine links, rendered in BOTH branches: the SSR shell is
 *  what fetch-only agents read, and it must carry source and pointers too
 *  (audit 5: the footer only existed after hydration). */
function SiteFooter({ snapshotDate }: { snapshotDate: string | null }) {
  const t = useTranslations('app');
  const tf = useTranslations('footer');
  return (
    <footer className="mt-10 bg-brand-petrol py-8 text-white/80">
      <div className="mx-auto max-w-[1400px] px-5 font-slab text-[13px] leading-relaxed">
        <p className="display-caps mb-2 text-[13px] text-brand-yellow">{t('brandTop')}</p>
        <p>{tf('credit')}</p>
        <p className="mt-1 text-white/50">
          {t('sourceNote', { date: snapshotDate ?? '—' })} · {tf('notIndex')}
        </p>
        <p className="mt-1 text-white/50">
          {tf('machine')}{' '}
          <a className="underline hover:text-brand-yellow" href="/api/events?month=2026-10">/api/events?month=2026-10</a>
          {' · '}
          <a className="underline hover:text-brand-yellow" href="/api/places?cluster=hotels&town=Cassis&tag=parking">/api/places?cluster=hotels&town=Cassis&tag=parking</a>
          {' · '}
          <a className="underline hover:text-brand-yellow" href="/agenda">/agenda</a>
          {' · '}
          <a className="underline hover:text-brand-yellow" href="/llms.txt">/llms.txt</a>
        </p>
      </div>
    </footer>
  );
}
