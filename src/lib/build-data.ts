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
import type { Catalog, Manifest, Vocab } from './types';
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

export function readUpcomingEvents(limit: number): UpcomingEvent[] {
  try {
    const dir = path.join(process.cwd(), 'public', 'data');
    const manifest = JSON.parse(
      readFileSync(path.join(dir, 'manifest.json'), 'utf-8'),
    ) as Manifest;
    if (!manifest.files.events) return [];
    const events = (
      JSON.parse(readFileSync(path.join(dir, manifest.files.events), 'utf-8')) as Catalog
    ).places;
    const vocab = JSON.parse(
      readFileSync(path.join(dir, manifest.files.vocab), 'utf-8'),
    ) as Vocab;

    const agendaIdx = CLUSTERS.findIndex((c) => c.key === 'agenda');
    const today = new Date().toISOString().slice(0, 10);
    return events
      .filter((p) => p.c === agendaIdx && (p.d1 ?? '') >= today)
      .sort((a, b) => ((a.d1 ?? '') < (b.d1 ?? '') ? -1 : 1))
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
  } catch {
    return [];
  }
}
