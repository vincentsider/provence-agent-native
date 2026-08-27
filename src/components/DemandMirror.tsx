'use client';

/**
 * The Demand Mirror (issue #603): every tool call this session's agent made,
 * with its arguments and result count, and the zero-result roll-up phrased as
 * an offer gap. Session-scoped; empties when the tab closes.
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
      className="h-fit space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          {t('title')}
        </h2>
        <span className="text-xs text-stone-400">{t('calls', { count: entries.length })}</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-stone-500">{t('empty')}</p>
      ) : (
        <ol className="max-h-[340px] space-y-2 overflow-y-auto text-xs" data-testid="mirror-entries">
          {entries.slice(-SHOW_LAST).map((e, idx) => (
            <li key={`${e.at}-${idx}`} className="rounded bg-stone-50 p-2 font-mono">
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-stone-800">{e.tool}</span>
                <span className={e.total === 0 ? 'text-rose-600' : 'text-stone-500'}>
                  {e.total !== null ? t('results', { count: e.total }) : '—'}
                </span>
              </div>
              <div className="mt-1 break-all text-stone-500">{formatArgs(e)}</div>
            </li>
          ))}
        </ol>
      )}

      {zero.length > 0 && (
        <div
          data-testid="zero-results"
          className="rounded border border-rose-200 bg-rose-50 p-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-800">
            {t('zeroTitle')}
          </h3>
          <p className="mt-1 text-sm text-rose-900">{t('zeroLine', { count: zero.length })}</p>
          <ul className="mt-2 space-y-1 text-xs text-rose-800">
            {zero.slice(-5).map((e, idx) => (
              <li key={idx} className="font-mono">
                {formatArgs(e)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-rose-700">{t('zeroExplain')}</p>
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
