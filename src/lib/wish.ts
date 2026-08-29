/**
 * The wish box parser (v3 hardening, 29 Aug): the visitor types a fuzzy
 * desire INTO THE PAGE and the page dispatches the scouts itself —
 * deterministic, agent-optional. The wish also lands in the signals log so
 * a cooperating agent picks it up through get_visitor_signals.
 *
 * Pure keyword mapping over the catalogue's own vocabulary (towns, tag
 * labels, cluster words). No network, no LLM, bounded output (<=4 briefs).
 */

import type { Store } from './store';
import type { ScoutBrief } from './scouts';
import { fold, type ClusterKey } from './types';

/** Only the vocabulary is needed; narrow so tests need no window/fetch. */
export type WishVocab = Pick<Store, 'vocab'>;

const CLUSTER_WORDS: ReadonlyArray<{ cluster: ClusterKey; words: readonly string[] }> = [
  { cluster: 'hotels', words: ['hotel', 'hotels', 'hôtel', 'chambre d hotel'] },
  { cluster: 'campings', words: ['camping', 'campings', 'tente', 'mobil'] },
  { cluster: 'chambres-d-hotes', words: ['chambre', 'chambres', 'hote', 'hotes', 'b&b', 'maison d hote'] },
  { cluster: 'loisirs', words: ['loisir', 'activite', 'kayak', 'velo', 'rando', 'randonnee', 'balade', 'visite', 'musee', 'plage', 'calanque', 'nature', 'hike', 'hiking', 'outdoor', 'swim'] },
  { cluster: 'agenda', words: ['marche', 'marches', 'festival', 'concert', 'evenement', 'evenements', 'fete', 'spectacle', 'expo', 'exposition', 'soir', 'soiree', 'market', 'event'] },
];

/** Named areas of the Bouches-du-Rhône that are NOT towns: matched as
 *  free-text query scouts ('J'hésite entre les Alpilles et la Camargue'
 *  failed silently before this existed — field bug, 29 Aug). */
const REGIONS: readonly string[] = [
  'alpilles', 'camargue', 'calanques', 'cote bleue', 'sainte victoire',
  'sainte baume', 'pays d aix', 'pays d arles', 'etang de berre', 'luberon',
];

/** Words that never help a catalogue query (folded). */
const STOP = new Set(
  'je tu il nous vous ils un une des de du la le les et ou a au aux en dans pour avec sans sur mon ma mes qui que quoi pas plus tres bien bon bonne petit petite grand grande cherche voudrais veux aimerais souhaite propose options option pendant qu on y est weekend week end sejour jour jours nuit nuits deux trois the a an and or for with i we want would like stay nice good'.split(
    /\s+/,
  ),
);

export interface ParsedWish {
  readonly briefs: readonly ScoutBrief[];
  readonly towns: readonly string[];
}

export function parseWish(store: WishVocab, raw: string): ParsedWish {
  const text = fold(raw).slice(0, 300);
  const words = text.split(/[^a-z0-9&]+/).filter((w) => w.length > 1);

  // Towns: match the catalogue's own town list (longest names first so
  // "aix en provence" wins over "provence"-less partials).
  const towns: string[] = [];
  const sortedTowns = [...store.vocab.towns].sort((a, b) => b.length - a.length);
  for (const town of sortedTowns) {
    if (towns.length >= 2) break;
    const f = fold(town);
    if (f.length > 3 && text.includes(f) && !towns.includes(town)) towns.push(town);
  }

  // Tags: match tag labels present in the vocabulary.
  const tags: string[] = [];
  for (const t of Object.values(store.vocab.tags)) {
    if (tags.length >= 3) break;
    const f = fold(t.label);
    if (f.length > 4 && text.includes(f) && !tags.includes(t.slug)) tags.push(t.slug);
  }

  // Clusters implied by wording.
  const clusters: ClusterKey[] = [];
  for (const { cluster, words: ws } of CLUSTER_WORDS) {
    if (ws.some((w) => text.includes(w)) && !clusters.includes(cluster)) clusters.push(cluster);
  }

  // Regions: one query scout each (region names live in the catalogue's
  // names and summaries, so free-text search finds their places).
  const regions = REGIONS.filter((r) => text.includes(r)).slice(0, 2);

  // Salient free-text terms for a query scout.
  const salient = words.filter((w) => !STOP.has(w)).slice(0, 3);
  const query = salient.join(' ');

  const briefs: ScoutBrief[] = [];
  const label = (base: string, town?: string) => (town ? `${base} · ${town}` : base).slice(0, 40);
  const lodging = clusters.filter((c) => c !== 'agenda' && c !== 'loisirs');
  const primaryTowns: Array<string | undefined> = towns.length > 0 ? towns : [undefined];

  const thisMonth = new Date().toISOString().slice(0, 7);

  // One scout per named region: the comparison the visitor asked for.
  for (const region of regions) {
    const wantsLoisirs = clusters.includes('loisirs');
    briefs.push({ label: label(region), query: region, cluster: wantsLoisirs ? 'loisirs' : undefined });
  }

  for (const town of primaryTowns) {
    for (const cluster of lodging.slice(0, 2)) {
      const name = cluster === 'chambres-d-hotes' ? "chambres d'hotes" : cluster;
      briefs.push({ label: label(name, town), cluster, town, tags: tags.length ? tags : undefined });
    }
    if (clusters.includes('loisirs') && regions.length === 0) {
      briefs.push({ label: label('loisirs', town), cluster: 'loisirs', town, query: query || undefined });
    }
    if (clusters.includes('agenda')) {
      // Anchored to the current month: an undated agenda brief surfaces
      // arbitrary permanent events, which reads as noise.
      briefs.push({ label: label('agenda', town), cluster: 'agenda', town, month: thisMonth });
    }
  }
  // ALWAYS at least two scouts: a lone scout is not a show, and zero is a
  // silent failure (field bug, 29 Aug).
  if (briefs.length === 0 && query) {
    briefs.push({ label: label('recherche libre'), query });
  }
  if (briefs.length < 2) {
    briefs.push({ label: label('agenda'), cluster: 'agenda', town: towns[0], month: thisMonth });
  }
  if (briefs.length < 2) {
    briefs.push({ label: label('loisirs'), cluster: 'loisirs' });
  }

  return { briefs: briefs.slice(0, 4), towns };
}
