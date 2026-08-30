'use client';

/**
 * The wish box (v4, 30 Aug): a mailbox, not a search engine. The page's own
 * keyword dispatch is gone — it sent scouts to Saint-Rémy for "un hôtel près
 * de la mer" (field bug, 30 Aug) because deterministic word-matching cannot
 * read intent. Now the wish only lands in the signals log, where the
 * read_visitor_wish heartbeat rewrites its tool description so a cooperating
 * agent finds the wish in context at its next turn and sends the scouts
 * itself. No agent attached: the visitor gets an honest note instead of
 * wrong hotels. The free text never leaves the page (same policy as before).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getSignalsLog } from '@/lib/signals';

export function WishBox() {
  const t = useTranslations('wish');
  const [value, setValue] = useState('');
  const [noted, setNoted] = useState(false);

  const dispatch = () => {
    const text = value.trim();
    if (text.length < 5) return;
    try {
      getSignalsLog().addWish(text);
    } catch {
      return; // client-only store; nothing sensible to show if it is absent
    }
    setNoted(true);
    setValue('');
  };

  return (
    <form
      data-testid="wish-box"
      className="mx-auto mt-6 max-w-[640px]"
      onSubmit={(e) => {
        e.preventDefault();
        dispatch();
      }}
    >
      <div className="flex items-stretch gap-0">
        <label className="sr-only" htmlFor="wish-input">
          {t('label')}
        </label>
        <input
          id="wish-input"
          type="text"
          value={value}
          maxLength={160}
          placeholder={t('placeholder')}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 border-2 border-brand-ink bg-white px-4 py-3 font-slab text-[15px] text-brand-ink placeholder:text-brand-ink/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={value.trim().length < 5}
          className="display-caps shrink-0 border-2 border-l-0 border-brand-ink bg-brand-petrol px-5 py-3 text-[13px] text-brand-yellow transition-colors hover:bg-brand-ink disabled:opacity-60"
        >
          {t('cta')}
        </button>
      </div>
      {noted && (
        <p
          data-testid="wish-ack"
          className="mt-2 border-2 border-brand-ink bg-brand-yellow/20 px-4 py-2 font-slab text-[13px] text-brand-ink"
        >
          {t('ack')}
        </p>
      )}
    </form>
  );
}
