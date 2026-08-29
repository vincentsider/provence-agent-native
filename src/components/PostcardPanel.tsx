'use client';

/**
 * La carte postale du futur (v3, issue #616). The agent writes the prose;
 * the factual footer is printed from the visitor's kept selection, so the
 * verifiable layer cannot be hallucinated. Text-only rendering: React
 * escapes everything; there is no HTML path from the agent to this DOM.
 */

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getPostcardStore } from '@/lib/postcard';
import { getShortlistStore } from '@/lib/shortlist';

export function PostcardPanel() {
  const t = useTranslations('postcard');
  const postcardStore = getPostcardStore();
  const shortlist = getShortlistStore();
  const card = useSyncExternalStore(postcardStore.subscribe, postcardStore.getSnapshot, () => null);
  const kept = useSyncExternalStore(shortlist.subscribe, shortlist.getSnapshot, () => []);

  if (!card) return null;

  const copyText = () => {
    const facts = kept
      .map((i) => `- ${i.name} (${i.town})${i.d1 ? ` — ${i.d1}` : ''} ${i.url}`)
      .join('\n');
    void navigator.clipboard?.writeText(`${card.title}\n\n${card.body}\n\n${facts}`).catch(() => {
      /* clipboard denial is not an error worth surfacing */
    });
  };

  return (
    <div
      data-testid="postcard"
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-brand-petrol/60 p-4 print:static print:bg-white print:p-0"
      role="dialog"
      aria-label={t('aria')}
    >
      <div className="max-h-[90vh] w-[min(94vw,560px)] overflow-y-auto border-4 border-brand-petrol bg-[#FFFDF5] shadow-[10px_10px_0_rgba(0,39,49,0.4)] print:max-h-none print:border-2 print:shadow-none">
        <div className="border-b-2 border-dashed border-brand-ink/30 px-6 pb-4 pt-5">
          <p className="display-caps text-[11px] text-brand-coral">{t('from', { day: card.day })}</p>
          <h2 className="display-caps mt-1 text-2xl text-brand-ink">{card.title}</h2>
        </div>
        <p className="whitespace-pre-wrap px-6 py-5 font-slab text-[15px] leading-relaxed text-brand-ink">
          {card.body}
        </p>
        {kept.length > 0 && (
          <div className="border-t-2 border-dashed border-brand-ink/30 px-6 py-4">
            <p className="display-caps text-[10px] text-brand-ink/60">{t('facts')}</p>
            <ul className="mt-2 space-y-1">
              {kept.map((i) => (
                <li key={i.id} className="font-slab text-[13px] text-brand-ink">
                  <a className="underline hover:text-brand-coral" href={i.url} target="_blank" rel="noreferrer">
                    {i.name}
                  </a>{' '}
                  <span className="text-brand-ink/60">
                    {i.town}
                    {i.d1 ? ` · ${i.d1}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-brand-ink/10 px-6 py-3 print:hidden">
          <button
            type="button"
            className="display-caps border-2 border-brand-ink bg-white px-3 py-1.5 text-[11px] text-brand-ink hover:bg-brand-ink hover:text-brand-yellow"
            onClick={copyText}
          >
            {t('copy')}
          </button>
          <button
            type="button"
            className="display-caps border-2 border-brand-ink bg-white px-3 py-1.5 text-[11px] text-brand-ink hover:bg-brand-ink hover:text-brand-yellow"
            onClick={() => window.print()}
          >
            {t('print')}
          </button>
          <button
            type="button"
            data-testid="postcard-close"
            className="display-caps border-2 border-brand-ink bg-brand-yellow px-3 py-1.5 text-[11px] text-brand-ink hover:bg-brand-ink hover:text-brand-yellow"
            onClick={() => postcardStore.clear()}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
