'use client';

/**
 * The Demand Mirror as a designed editorial feature, not a debug panel:
 * a petrol block in the site's dark-section language, yellow display
 * heading, slab text, yellow zero-result callout. Session-scoped.
 */

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getDemandLog, type DemandEntry } from '@/lib/demand';

const SHOW_LAST = 30;

export function DemandMirror() {
  const t = useTranslations('mirror');
  const log = getDemandLog();
  const entries = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
  const zero = entries.filter((e) => e.total === 0);

  return (
    <aside
      aria-label={t('title')}
      data-testid="demand-mirror"
      className="bg-brand-petrol p-5 text-white"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="display-caps text-[15px] leading-tight text-brand-yellow">
          {t('title')}
        </h2>
        <span className="font-slab text-[12px] text-white/50">
          {t('calls', { count: entries.length })}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 font-slab text-[14px] leading-relaxed text-white/70">
          {t('empty')}
        </p>
      ) : (
        <ol
          className="mt-3 max-h-[300px] space-y-1.5 overflow-y-auto text-[12px]"
          data-testid="mirror-entries"
        >
          {entries.slice(-SHOW_LAST).map((e, idx) => (
            <li key={`${e.at}-${idx}`} className="bg-white/5 p-2 font-mono">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-white">{e.tool}</span>
                <span className={e.total === 0 ? 'text-brand-yellow' : 'text-white/50'}>
                  {e.total !== null ? t('results', { count: e.total }) : '—'}
                </span>
              </div>
              <div className="mt-0.5 break-all text-white/50">{formatArgs(e)}</div>
            </li>
          ))}
        </ol>
      )}

      {zero.length > 0 && (
        <div data-testid="zero-results" className="mt-4 bg-brand-yellow p-3 text-brand-ink">
          <h3 className="display-caps text-[12px]">{t('zeroTitle')}</h3>
          <p className="mt-1 font-slab text-[14px] font-semibold">
            {t('zeroLine', { count: zero.length })}
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[12px]">
            {zero.slice(-5).map((e, idx) => (
              <li key={idx}>{formatArgs(e)}</li>
            ))}
          </ul>
          <p className="mt-2 font-slab text-[13px]">{t('zeroExplain')}</p>
        </div>
      )}
    </aside>
  );
}

function formatArgs(e: DemandEntry): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e.args)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) parts.push(`${k}: ${v.slice(0, 6).join(', ')}`);
    } else if (typeof v !== 'object') {
      parts.push(`${k}: ${String(v)}`);
    }
  }
  return parts.join(' · ') || '∅';
}
