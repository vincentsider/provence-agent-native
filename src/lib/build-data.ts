/**
 * Build-time catalogue access for server components: reads public/data via
 * the filesystem AT BUILD, so the landing page can embed real content in its
 * server-rendered HTML. This exists because fetch-only assistants strip
 * comments, head links and JSON-LD during text extraction (field failures,
 * 28 Aug): the only channel that reliably reaches every agent is visible
 * server-rendered text. Missing artefacts degrade to an empty list (CI
 * builds without the catalogue stay green).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Catalog, Manifest, Place, Vocab } from './types';
import { CLUSTERS, categoryOf } from './types';

export interface UpcomingEvent {
  readonly name: string;
  readonly town: string;
  readonly d1: string;
  readonly d2: string | null;
  readonly path: string;
  readonly category: string;
  readonly img: string | null;
}

export interface BuildData {
  readonly upcoming: UpcomingEvent[];
  /** Manifest snapshot date (YYYY-MM-DD): the footer must show THIS, never a
   *  hand-typed date (audit 5 found a hardcoded 2026-08-27 against a 28 Aug
   *  catalogue). */
  readonly snapshotDate: string | null;
}

/** Pure selector, unit-tested: events starting on/after `today`, soonest
 *  first, ties broken by id order (stable across builds). */
export function selectUpcoming(
  events: readonly Place[],
  vocab: Vocab,
  today: string,
  limit: number,
): UpcomingEvent[] {
  const agendaIdx = CLUSTERS.findIndex((c) => c.key === 'agenda');
  return events
    .filter((p) => p.c === agendaIdx && (p.d1 ?? '') >= today)
    .sort((a, b) => {
      const da = a.d1 ?? '';
      const db = b.d1 ?? '';
      return da < db ? -1 : da > db ? 1 : a.id - b.id;
    })
    .slice(0, limit)
    .map((p) => ({
      name: p.n,
      town: p.t >= 0 ? (vocab.towns[p.t] ?? '') : '',
      d1: p.d1!,
      d2: p.d2 ?? null,
      path: p.u,
      category: categoryOf(p.u) ?? 'agenda',
      img: p.img,
    }));
}

/**
 * KNOWN TRADEOFF: `today` freezes at BUILD time because this page is fully
 * static (SSG). A deployment-free fortnight would age the strip's first
 * entries. Deliberate: making the page dynamic would both lose the static
 * fast-path and break in the serverless bundle (public/ is not traced into
 * functions, so runtime fs reads would silently return []). The nightly
 * re-ingest+deploy already parked as follow-up work erases the tradeoff.
 */
export function readBuildData(limit: number): BuildData {
  try {
    const dir = path.join(process.cwd(), 'public', 'data');
    const manifest = JSON.parse(
      readFileSync(path.join(dir, 'manifest.json'), 'utf-8'),
    ) as Manifest;
    const snapshotDate = manifest.generatedAt.slice(0, 10);
    if (!manifest.files.events) return { upcoming: [], snapshotDate };
    const events = (
      JSON.parse(readFileSync(path.join(dir, manifest.files.events), 'utf-8')) as Catalog
    ).places;
    const vocab = JSON.parse(
      readFileSync(path.join(dir, manifest.files.vocab), 'utf-8'),
    ) as Vocab;
    const today = new Date().toISOString().slice(0, 10);
    return { upcoming: selectUpcoming(events, vocab, today, limit), snapshotDate };
  } catch {
    return { upcoming: [], snapshotDate: null };
  }
}
