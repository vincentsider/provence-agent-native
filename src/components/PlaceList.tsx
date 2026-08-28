'use client';

/**
 * Result cards in the myprovence.fr card language: photo on top, uppercase
 * display title, town in slab serif, coral category line, flat square
 * corners, no card chrome. Photos are the site's own catalogue images
 * (hotlinked with approval; CSP img-src allows only that host).
 */

import { useLocale, useTranslations } from 'next-intl';
import type { Store, ViewState } from '@/lib/store';
import { CANONICAL_HOST, CLUSTERS } from '@/lib/types';

const LIST_CAP = 40;

export function PlaceList({ store, view }: { store: Store; view: ViewState }) {
  const t = useTranslations('list');
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
