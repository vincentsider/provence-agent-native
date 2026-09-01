/**
 * Le carnet de voyage (29 Aug): once the visitor has KEPT their flags, the
 * plan becomes a print-ready briefing pack — cover with the trip's real
 * photographs, one section per day, factual cards (photo, pictogram, town,
 * date, canonical link). Two composers, one renderer:
 *  - the agent, through the compose_carnet tool (its day layout and notes);
 *  - the page itself, through buildDefaultCarnet (dated items grouped by
 *    day, places under "anytime") — the guaranteed lane.
 * "Download PDF" is the browser's print-to-PDF over a real A4 print layout.
 */

import type { ShortlistItem } from './shortlist';

export interface CarnetDay {
  readonly label: string;
  readonly note: string | null;
  readonly items: readonly ShortlistItem[];
}

export interface Carnet {
  readonly title: string;
  readonly days: readonly CarnetDay[];
  readonly signoff: string | null;
}

export interface CarnetDayInput {
  readonly label: string;
  readonly itemIds: readonly number[];
  readonly note?: string;
}

/** Agent path: every referenced id must be a KEPT item (grounding rule). */
export function composeCarnet(
  kept: readonly ShortlistItem[],
  title: string,
  days: readonly CarnetDayInput[],
  signoff?: string,
): { carnet: Carnet } | { error: 'unknown_items'; unknownIds: number[]; validIds: number[] } {
  const byId = new Map(kept.map((i) => [i.id, i]));
  const unknownIds = [...new Set(days.flatMap((d) => d.itemIds.filter((id) => !byId.has(id))))];
  if (unknownIds.length > 0) {
    return { error: 'unknown_items', unknownIds, validIds: kept.map((i) => i.id) };
  }
  return {
    carnet: {
      title,
      days: days.map((d) => ({
        label: d.label,
        note: d.note ?? null,
        items: d.itemIds.map((id) => byId.get(id)!),
      })),
      signoff: signoff ?? null,
    },
  };
}

/** Page path: dated items grouped chronologically by start day, undated
 *  places under one "anytime" section. Locale-agnostic labels are supplied
 *  by the caller (i18n lives in the component). */
export function buildDefaultCarnet(
  kept: readonly ShortlistItem[],
  title: string,
  anytimeLabel: string,
  formatDay: (iso: string) => string,
): Carnet {
  // Keeps carry the request they answered (1 Sep): the carnet clusters one
  // section per request, in the order the visitor explored — "Week-end
  // romantique" keeps never mix with "ce soir à Marseille" keeps. Items
  // without a request fall into the anytime section. When NO item carries a
  // request (old sessions, direct locks), the day-grouped layout below
  // still applies.
  if (kept.some((i) => i.request)) {
    const byRequest = new Map<string, ShortlistItem[]>();
    for (const item of kept) {
      const key = item.request ?? anytimeLabel;
      const list = byRequest.get(key) ?? [];
      list.push(item);
      byRequest.set(key, list);
    }
    const days: CarnetDay[] = [...byRequest.entries()].map(([label, items]) => ({
      label,
      note: null,
      items,
    }));
    return { title, days, signoff: null };
  }
  // A record open for weeks is an "anytime" activity, not a day-1 event: a
  // year-long wine tour under "Thursday 1 January" reads wrong (field
  // screenshot, 29 Aug).
  const DAY_MS = 86_400_000;
  const isLongRunning = (i: ShortlistItem): boolean => {
    if (i.d1 === null) return true;
    if (!i.d2 || i.d2 === i.d1) return false;
    const span = (Date.parse(`${i.d2}T00:00:00Z`) - Date.parse(`${i.d1}T00:00:00Z`)) / DAY_MS;
    return span > 21;
  };
  const dated = kept.filter((i) => !isLongRunning(i)).sort((a, b) => (a.d1! < b.d1! ? -1 : 1));
  const anytime = kept.filter(isLongRunning);
  const byDay = new Map<string, ShortlistItem[]>();
  for (const item of dated) {
    const list = byDay.get(item.d1!) ?? [];
    list.push(item);
    byDay.set(item.d1!, list);
  }
  const days: CarnetDay[] = [...byDay.entries()].map(([iso, items]) => ({
    label: formatDay(iso),
    note: null,
    items,
  }));
  if (anytime.length > 0) days.push({ label: anytimeLabel, note: null, items: anytime });
  return { title, days, signoff: null };
}

export class CarnetStore {
  #carnet: Carnet | null = null;
  #listeners = new Set<() => void>();

  set(carnet: Carnet): void {
    this.#carnet = carnet;
    for (const fn of this.#listeners) fn();
  }

  clear(): void {
    if (!this.#carnet) return;
    this.#carnet = null;
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): Carnet | null => this.#carnet;

  destroy(): void {
    this.#listeners.clear();
    this.#carnet = null;
  }
}

let singleton: CarnetStore | null = null;

export function getCarnetStore(): CarnetStore {
  if (typeof window === 'undefined') throw new Error('CarnetStore is client-only');
  if (!singleton) singleton = new CarnetStore();
  return singleton;
}
