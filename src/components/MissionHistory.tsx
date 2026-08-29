'use client';

/**
 * Mission history (29 Aug): every search is a scene the visitor can bring
 * back. Chips under the wish box; a tap restores the mission — flags,
 * verdicts, grid and camera — through the exact same stores the live
 * mission uses.
 */

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getScoutStore } from '@/lib/scouts';
import { getStore } from '@/lib/store';

export function MissionHistory() {
  const t = useTranslations('history');
  // Rendered inside the SSR shell too: the store only exists client-side.
  const scoutStore = typeof window !== 'undefined' ? getScoutStore() : null;
  useSyncExternalStore(
    scoutStore?.subscribe ?? (() => () => {}),
    scoutStore?.getSnapshot ?? (() => null),
    () => null,
  );
  const history = scoutStore?.history() ?? [];
  if (!scoutStore || history.length === 0) return null;

  const restore = (missionId: string) => {
    const mission = scoutStore.restore(missionId);
    if (!mission) return;
    const ids = mission.reports.flatMap((r) => r.findings.map((f) => f.id));
    if (ids.length > 0) {
      try {
        const store = getStore();
        store.setHighlightedIds(ids, 'agent');
        store.frameHighlighted();
      } catch {
        /* catalogue not ready: the theatre alone still replays */
      }
    }
  };

  return (
    <div data-testid="mission-history" className="mx-auto mt-4 max-w-[640px]">
      <p className="display-caps text-[10px] tracking-widest text-current opacity-70">{t('title')}</p>
      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
        {history.map((m) => (
          <button
            key={m.missionId}
            type="button"
            onClick={() => restore(m.missionId)}
            className="max-w-[300px] truncate border border-current/40 bg-white/80 px-2.5 py-1 font-slab text-[12px] text-brand-ink hover:bg-brand-yellow"
            title={m.mission}
          >
            {m.mission}
          </button>
        ))}
      </div>
    </div>
  );
}
