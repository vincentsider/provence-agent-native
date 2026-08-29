'use client';

/**
 * Le carnet de voyage (29 Aug): the agreed plan as a print-ready editorial
 * pack. Cover = the trip's real photographs under the brand frame; then one
 * section per day with photo cards, pictograms, towns, dates and canonical
 * links. "Download PDF" is print-to-PDF over a real A4 layout (print CSS
 * hides everything else). Text is React-escaped; images come only from the
 * catalogue records the visitor kept.
 *
 * The floating CarnetButton is the guaranteed lane: it builds a default
 * day-grouped carnet from the kept selection, no agent required.
 */

import { useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { buildDefaultCarnet, getCarnetStore } from '@/lib/carnet';
import { getShortlistStore } from '@/lib/shortlist';

export function CarnetButton() {
  const t = useTranslations('carnet');
  const locale = useLocale();
  const shortlist = getShortlistStore();
  const kept = useSyncExternalStore(shortlist.subscribe, shortlist.getSnapshot, () => []);
  if (kept.length === 0) return null;

  const open = () => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
    getCarnetStore().set(
      buildDefaultCarnet(kept, t('defaultTitle'), t('anytime'), (iso) =>
        fmt.format(new Date(`${iso}T12:00:00Z`)),
      ),
    );
  };

  return (
    <button
      type="button"
      data-testid="carnet-button"
      onClick={open}
      className="display-caps fixed bottom-4 left-4 z-[1150] border-2 border-brand-ink bg-brand-yellow px-4 py-2.5 text-[12px] text-brand-ink shadow-[4px_4px_0_#002731] transition-transform hover:-translate-y-0.5 print:hidden"
    >
      {t('open', { count: kept.length })}
    </button>
  );
}

export function CarnetPanel() {
  const t = useTranslations('carnet');
  const store = getCarnetStore();
  const carnet = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  if (!carnet) return null;

  const photos = carnet.days
    .flatMap((d) => d.items)
    .map((i) => i.img)
    .filter((img): img is string => !!img)
    .slice(0, 4);

  return (
    <div
      data-testid="carnet"
      role="dialog"
      aria-label={t('aria')}
      className="carnet-overlay fixed inset-0 z-[1200] overflow-y-auto bg-brand-petrol/70 p-4 print:static print:overflow-visible print:bg-white print:p-0"
    >
      <div className="carnet-sheet mx-auto w-[min(96vw,760px)] border-4 border-brand-petrol bg-[#FFFDF5] shadow-[12px_12px_0_rgba(0,39,49,0.45)] print:w-full print:border-0 print:shadow-none">
        {/* Cover */}
        <div className="relative overflow-hidden border-b-[6px] border-brand-yellow bg-brand-petrol">
          {photos.length > 0 && (
            <div aria-hidden className="absolute inset-0 grid grid-cols-2">
              {photos.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" className="h-full w-full object-cover opacity-60" />
              ))}
            </div>
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(0,39,49,.5), rgba(0,39,49,.85))' }}
          />
          <div className="relative px-8 py-12 text-center">
            <p className="display-caps text-[11px] tracking-widest text-brand-yellow">{t('kicker')}</p>
            <h2 className="display-caps mt-3 text-3xl leading-tight text-white md:text-4xl">
              {carnet.title}
            </h2>
            <p className="mt-3 font-slab text-[13px] text-white/80">{t('credit')}</p>
          </div>
        </div>

        {/* Days */}
        <div className="px-6 py-6 md:px-10">
          {carnet.days.map((day) => (
            <section key={day.label} className="carnet-day mb-8 break-inside-avoid">
              <h3 className="display-caps border-b-2 border-brand-ink pb-1 text-lg text-brand-ink">
                {day.label}
              </h3>
              {day.note && (
                <p className="mt-2 font-slab text-[14px] italic text-brand-ink/80">{day.note}</p>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {day.items.map((item) => (
                  <article key={item.id} className="border border-brand-ink/20 bg-white">
                    {item.img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.img} alt="" className="h-36 w-full object-cover" />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-brand-paper text-4xl">
                        {item.glyph ?? '🧭'}
                      </div>
                    )}
                    <div className="p-3">
                      <p className="display-caps text-[13px] leading-snug text-brand-ink">
                        {item.glyph ? `${item.glyph} ` : ''}
                        {item.name}
                      </p>
                      <p className="mt-1 font-slab text-[12px] text-brand-ink/70">
                        {item.town}
                        {item.d1 ? ` · ${item.d1}${item.d2 && item.d2 !== item.d1 ? ` → ${item.d2}` : ''}` : ''}
                      </p>
                      <a
                        className="mt-1 inline-block font-slab text-[12px] text-brand-coral underline"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        myprovence.fr
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {carnet.signoff && (
            <p className="mb-4 border-l-4 border-brand-yellow pl-3 font-slab text-[14px] italic text-brand-ink">
              {carnet.signoff}
            </p>
          )}
          <p className="font-slab text-[11px] text-brand-ink/50">{t('sources')}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-brand-ink/10 px-6 py-3 print:hidden">
          <button
            type="button"
            data-testid="carnet-pdf"
            className="display-caps border-2 border-brand-ink bg-brand-yellow px-4 py-2 text-[12px] text-brand-ink hover:bg-brand-ink hover:text-brand-yellow"
            onClick={() => window.print()}
          >
            {t('pdf')}
          </button>
          <button
            type="button"
            data-testid="carnet-close"
            className="display-caps border-2 border-brand-ink bg-white px-4 py-2 text-[12px] text-brand-ink hover:bg-brand-ink hover:text-brand-yellow"
            onClick={() => store.clear()}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
