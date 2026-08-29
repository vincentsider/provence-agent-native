/**
 * Map glyphs (29 Aug, "display signs that convey what we are looking at"):
 * one pictogram per record, derived from its cluster, agenda category and
 * wording. Pure and reference-tested; the map wraps the glyph in a brand
 * chip whose border still says WHO put it there (agent / human / approx).
 */

import { CLUSTERS, categoryOf, fold, type Place, type Vocab } from './types';

interface Rule {
  readonly glyph: string;
  readonly words: readonly string[];
}

/** Activity subtypes, first match wins (most specific wording first). */
const ACTIVITY_RULES: readonly Rule[] = [
  { glyph: '🛶', words: ['kayak', 'canoe', 'paddle', 'aviron', 'rame'] },
  { glyph: '🤿', words: ['plongee', 'snorkel', 'apnee'] },
  { glyph: '⛵', words: ['voile', 'voilier', 'catamaran', 'croisiere', 'bateau', 'nautique'] },
  { glyph: '🏊', words: ['piscine', 'baignade', 'natation'] },
  { glyph: '🏖', words: ['plage', 'calanque'] },
  { glyph: '♨', words: ['spa', 'sauna', 'hammam', 'bien etre', 'thalasso', 'massage'] },
  { glyph: '🧗', words: ['escalade', 'via ferrata', 'grimpe'] },
  { glyph: '🐎', words: ['cheval', 'equestre', 'poney', 'cavalier'] },
  { glyph: '🚴', words: ['velo', 'vtt', 'cyclo', 'bike'] },
  { glyph: '🥾', words: ['rando', 'randonnee', 'marche a pied', 'sentier', 'boucle', 'circuit', 'trail'] },
  { glyph: '⛳', words: ['golf'] },
  { glyph: '🍷', words: ['vin', 'vignoble', 'domaine', 'cave', 'degustation', 'oeno'] },
  { glyph: '🖼', words: ['musee', 'galerie', 'exposition', 'atelier d artiste'] },
  { glyph: '🌳', words: ['parc', 'jardin', 'botanique'] },
  { glyph: '🎣', words: ['peche'] },
  { glyph: '🛍', words: ['boutique', 'artisan', 'marche aux'] },
];

/** Agenda categories (categoryOf on the canonical /agenda/<cat>/ path). */
const EVENT_RULES: ReadonlyArray<{ glyph: string; cats: readonly string[] }> = [
  { glyph: '🧺', cats: ['marche', 'marches'] },
  { glyph: '🎪', cats: ['festival', 'feria'] },
  { glyph: '🎵', cats: ['concert', 'musique'] },
  { glyph: '🎭', cats: ['spectacle', 'theatre', 'danse'] },
  { glyph: '🖼', cats: ['exposition', 'expo'] },
  { glyph: '🚶', cats: ['visite', 'visites', 'visite-guidee'] },
  { glyph: '🏅', cats: ['sport', 'sportif'] },
  { glyph: '🎉', cats: ['fete', 'fetes', 'traditions'] },
];

const CLUSTER_GLYPHS: Readonly<Record<string, string>> = {
  hotels: '🛏',
  campings: '⛺',
  'chambres-d-hotes': '🏡',
  itineraires: '🥾',
  loisirs: '🧭',
  agenda: '📅',
};

function activityGlyph(blob: string): string | null {
  for (const rule of ACTIVITY_RULES) {
    if (rule.words.some((w) => blob.includes(w))) return rule.glyph;
  }
  return null;
}

/** One pictogram per record. Wording wins over the generic cluster glyph. */
export function pickGlyph(p: Place, vocab: Vocab): string {
  const cluster = CLUSTERS[p.c]?.key ?? 'loisirs';
  const tagLabels = p.tags.map((id) => vocab.tags[String(id)]?.label ?? '').join(' ');
  const blob = fold(`${p.n} ${p.s} ${tagLabels}`);

  if (cluster === 'agenda') {
    const cat = categoryOf(p.u);
    if (cat) {
      for (const rule of EVENT_RULES) {
        if (rule.cats.includes(cat)) return rule.glyph;
      }
    }
    return activityGlyph(blob) ?? CLUSTER_GLYPHS.agenda!;
  }
  if (cluster === 'loisirs' || cluster === 'itineraires') {
    return activityGlyph(blob) ?? CLUSTER_GLYPHS[cluster]!;
  }
  return CLUSTER_GLYPHS[cluster] ?? '🧭';
}
