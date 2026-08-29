'use client';

/**
 * The wish box (v3 hardening, 29 Aug): "everything must work". The visitor
 * types a fuzzy desire into the PAGE and the page dispatches the scouts
 * itself — deterministic keyword parsing over the catalogue's own
 * vocabulary, zero dependence on whether the driving agent picks our tools.
 * The wish also lands in the signals log, so a cooperating agent reads it
 * through get_visitor_signals and continues from what the page already did.
 * The free text never leaves the page (same policy as tool queries).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getStore } from '@/lib/store';
import { getScoutStore, runMission } from '@/lib/scouts';
import { getSignalsLog } from '@/lib/signals';
import { getPresenceBus } from '@/lib/presence';
import { parseWish } from '@/lib/wish';

export function WishBox() {
  const t = useTranslations('wish');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const dispatch = () => {
    const text = value.trim();
    if (text.length < 5 || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const store = getStore();
        await store.ready;
        if (!store.isReady) return;
        const { briefs } = parseWish(store, text);
        const today = new Date();
        const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const mission = runMission(store, text, briefs, day);
        getScoutStore().start(mission);
        const ids = mission.reports.flatMap((r) => r.findings.map((f) => f.id));
        if (ids.length > 0) store.setHighlightedIds(ids, 'agent');
        try {
          getSignalsLog().addWish(text);
          getPresenceBus().emit({
            phase: 'announce',
            tool: 'send_scouts',
            intent: t('intent', { count: mission.reports.length }),
          });
          getPresenceBus().emit({ phase: 'focus', target: 'map' });
        } catch {
          /* theatre only */
        }
        setValue('');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <form
      data-testid="wish-box"
      className="mx-auto mt-6 flex max-w-[640px] items-stretch gap-0"
      onSubmit={(e) => {
        e.preventDefault();
        dispatch();
      }}
    >
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
        disabled={busy || value.trim().length < 5}
        className="display-caps shrink-0 border-2 border-l-0 border-brand-ink bg-brand-petrol px-5 py-3 text-[13px] text-brand-yellow transition-colors hover:bg-brand-ink disabled:opacity-60"
      >
        {t('cta')}
      </button>
    </form>
  );
}
