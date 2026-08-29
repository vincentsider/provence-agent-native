'use client';

/**
 * The mission hero (29 Aug, "be as creative as possible"): while a mission
 * runs, the yellow hero band becomes a full-bleed collage of the findings'
 * REAL catalogue photographs under a petrol wash — the destination itself
 * floods the masthead. The wish is written over it in display caps; one
 * tinted chip per scout ticks its finds and keeps live. No mission, no
 * takeover: the classic yellow hero renders instead (decided in Hero).
 *
 * Craft rules: photos arrive staggered with a slow Ken Burns drift
 * (reduced-motion: static), text stays AAA-readable via a gradient scrim,
 * and the brand survives through the yellow frame and display type.
 */

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getScoutStore, type Mission } from '@/lib/scouts';

const TINTS = ['#FFE500', '#EE6E62', '#E63521', '#7A6A00'] as const;
const MAX_PHOTOS = 6;

export function missionPhotos(mission: Mission): string[] {
  const seen = new Set<string>();
  const photos: string[] = [];
  // Interleave scouts so the collage shows every angle, not just scout #1.
  for (let j = 0; j < 3 && photos.length < MAX_PHOTOS; j++) {
    for (const r of mission.reports) {
      const img = r.findings[j]?.img;
      if (img && !seen.has(img) && photos.length < MAX_PHOTOS) {
        seen.add(img);
        photos.push(img);
      }
    }
  }
  return photos;
}

export function MissionHero({ mission, children }: { mission: Mission; children?: React.ReactNode }) {
  const t = useTranslations('mission');
  const photos = missionPhotos(mission);

  return (
    <div
      data-testid="mission-banner"
      aria-label={t('aria')}
      className="relative overflow-hidden border-y-[6px] border-brand-yellow bg-brand-petrol"
    >
      {/* The destination floods the masthead: real catalogue photographs. */}
      {photos.length > 0 && (
        <div aria-hidden className="absolute inset-0 grid grid-cols-2 md:grid-cols-3">
          {photos.map((src, i) => (
            <div key={src} className="mission-photo relative overflow-hidden" style={{ animationDelay: `${i * 260}ms` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading={i < 3 ? 'eager' : 'lazy'}
                className="mission-photo-img h-full w-full object-cover"
                style={{ animationDelay: `${i * 900}ms` }}
              />
            </div>
          ))}
        </div>
      )}
      {/* Scrim: the type must win over any photograph. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,39,49,.88) 0%, rgba(0,39,49,.45) 45%, rgba(0,39,49,.88) 100%)',
        }}
      />
      <div className="relative mx-auto max-w-[900px] px-5 py-10 text-center text-white">
        <p className="display-caps text-[12px] tracking-widest text-brand-yellow/90">{t('kicker')}</p>
        <h2 className="display-caps mx-auto mt-3 max-w-[820px] text-2xl leading-[1.15] text-white md:text-4xl">
          {mission.mission}
        </h2>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {mission.reports.map((r, i) => {
            const kept = Object.values(r.verdicts).filter((v) => v === 'kept').length;
            return (
              <span
                key={r.scoutId}
                className="mission-chip flex items-center gap-2 border border-white/30 bg-brand-petrol/60 px-3 py-1.5 font-slab text-[13px] text-white backdrop-blur-sm"
                style={{ animationDelay: `${i * 180}ms` }}
              >
                <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: TINTS[i % TINTS.length] }} />
                {r.label}
                <span className="text-white/70">· {t('findings', { count: r.findings.length })}</span>
                {kept > 0 && <span className="text-brand-yellow">✓ {kept}</span>}
              </span>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
