'use client';

/**
 * Result cards in the myprovence.fr card language: photo on top, uppercase
 * display title, town in slab serif, coral category line, flat square
 * corners, no card chrome. Photos are the site's own catalogue images
 * (hotlinked with approval; CSP img-src allows only that host).
 */

import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import type { Store, ViewState } from '@/lib/store';
import { CANONICAL_HOST, CLUSTERS } from '@/lib/types';
import { getSignalsLog } from '@/lib/signals';

const LIST_CAP = 40;

export function PlaceList({ store, view }: { store: Store; view: ViewState }) {
  const t = useTranslations('list');
  // Locks (issue #608): the visitor's firm choices, visible on the card and
  // readable by the agent through get_visitor_signals.
  const signals = getSignalsLog();
  useSyncExternalStore(signals.subscribe, signals.getSnapshot, signals.getSnapshot);
  const tc = useTranslations('clusters');
  const tf = useTranslations('filters');
  const locale = useLocale();
  const places = store.catalog.places;
  const shown = view.highlighted.slice(0, LIST_CAP);

  return (
    <section aria-label="Résultats" className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between font-slab text-[13px] text-brand-ink/60">
        <span>
          <span data-testid="highlighted-count">{view.highlighted.length}</span>
          {' · '}
          {tf('shown', { shown: shown.length, total: view.total })}
        </span>
        {view.lastActor === 'agent' && (
          <span className="bg-brand-petrol px-2 py-0.5 font-semibold text-brand-yellow">
            {t('agentDrove')}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2">
        {shown.map((i) => {
          const p = places[i];
          if (!p) return null;
          const clusterKey = CLUSTERS[p.c]?.key;
          const href = `https://${CANONICAL_HOST}${p.u}`;
          return (
            <li key={p.id}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-brand-paper">
                  <button
                    type="button"
                    aria-label={signals.isLocked(p.id) ? 'Déverrouiller' : 'Verrouiller ce choix'}
                    aria-pressed={signals.isLocked(p.id)}
                    data-testid={`lock-${p.id}`}
                    className={
                      'absolute right-2 top-2 z-[2] flex h-7 w-7 items-center justify-center border-2 text-[13px] transition-colors ' +
                      (signals.isLocked(p.id)
                        ? 'border-brand-ink bg-brand-yellow text-brand-ink'
                        : 'border-white/70 bg-brand-petrol/70 text-white/90 opacity-0 group-hover:opacity-100 focus:opacity-100')
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      signals.toggleLock(p.id);
                    }}
                  >
                    {signals.isLocked(p.id) ? '🔒' : '🔓'}
                  </button>
                  {p.d1 && (
                    <span className="display-caps absolute left-0 top-3 z-[1] bg-brand-yellow px-2.5 py-1 text-[11px] text-brand-ink">
                      {formatRange(p.d1, p.d2 ?? null, locale)}
                    </span>
                  )}
                  {p.img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`https://${CANONICAL_HOST}${p.img}`}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-brand-petrol">
                      <span className="display-caps text-5xl text-brand-yellow/80">
                        {p.n.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                <h3 className="display-caps mt-3 text-[15px] leading-snug text-brand-ink group-hover:text-brand-red">
                  {p.n}
                </h3>
                <p className="mt-1 font-slab text-[14px] text-brand-ink/70">
                  {p.t >= 0 ? store.vocab.towns[p.t] : ''}
                  {p.g !== null && (
                    <span className="text-brand-ink/50"> · {t('stars', { count: p.g })}</span>
                  )}
                </p>
                <p className="font-slab text-[14px] text-brand-coral">
                  {clusterKey ? tc(clusterKey) : ''}
                </p>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "2026-10-18" (+ optional end) in the visitor's locale, e.g. "18 oct. – 2 nov.".
 *  The formatter is memoized per locale: Intl.DateTimeFormat construction is
 *  expensive and this runs for every event card on every render. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatRange(d1: string, d2: string | null, locale: string): string {
  let fmt = formatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    formatters.set(locale, fmt);
  }
  const parse = (s: string) => new Date(`${s}T12:00:00Z`);
  const start = fmt.format(parse(d1));
  if (!d2 || d2 === d1) return start;
  return `${start} – ${fmt.format(parse(d2))}`;
}
