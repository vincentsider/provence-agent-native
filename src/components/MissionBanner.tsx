'use client';

/**
 * The mission takeover (29 Aug, "the conversation must change the WEBSITE"):
 * when scouts are dispatched — by the agent's send_scouts or the page's own
 * wish box — the site grows a full-width mission band: the wish written in
 * brand ink, one chip per scout with its tint, findings count and live kept
 * ticks. It appears mid-session and retires with the next page load; the
 * grid below simultaneously becomes the findings (setHighlightedIds).
 */

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getScoutStore } from '@/lib/scouts';

const TINTS = ['#002731', '#EE6E62', '#E63521', '#7A6A00'] as const;

export function MissionBanner() {
  const t = useTranslations('mission');
  const scoutStore = getScoutStore();
  const mission = useSyncExternalStore(scoutStore.subscribe, scoutStore.getSnapshot, () => null);

  if (!mission) return null;

  return (
    <section
      data-testid="mission-banner"
      aria-label={t('aria')}
      className="border-y-2 border-brand-yellow bg-brand-petrol"
    >
      <div className="mx-auto max-w-[1400px] px-5 py-4">
        <p className="display-caps text-[11px] text-brand-yellow/80">{t('kicker')}</p>
        <p
          className="mission-wish mt-1 font-slab text-[19px] leading-snug text-white"
          style={{ ['--chars' as string]: Math.min(mission.mission.length, 80) }}
        >
          {mission.mission}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {mission.reports.map((r, i) => {
            const kept = Object.values(r.verdicts).filter((v) => v === 'kept').length;
            return (
              <span
                key={r.scoutId}
                className="mission-chip flex items-center gap-2 border border-white/25 bg-white/10 px-3 py-1.5 font-slab text-[13px] text-white"
                style={{ animationDelay: `${i * 180}ms` }}
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5"
                  style={{ background: TINTS[i % TINTS.length], outline: '1px solid #FFE500' }}
                />
                {r.label}
                <span className="text-white/60">· {t('findings', { count: r.findings.length })}</span>
                {kept > 0 && <span className="text-brand-yellow">✓ {kept}</span>}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
