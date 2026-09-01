/**
 * Les éclaireurs (v3, issue #612): the agent turns one fuzzy desire into 2-4
 * scout briefs; each brief is a REAL engine search (Store.peekFilter — never
 * the shared-view path, so scouts do not stomp what the human is looking at)
 * whose journey the ScoutTheatre renders on the map. The human's keep/dismiss
 * verdicts live here and are read back by get_scout_reports.
 *
 * Bounds: one active mission, one archived, <=4 scouts, <=3 findings each.
 * The store is pure data + listeners; every timer lives in the component.
 */

import type { Store } from './store';
import { pickGlyph } from './glyphs';
import { fold } from './types';
import type { ClusterKey, FilterInput } from './types';

/** The two Store capabilities a mission needs; narrow so tests can stub it. */
export type ScoutEngine = Pick<Store, 'peekFilter' | 'toPublicShape' | 'vocab'>;

export interface ScoutBrief {
  /** Short French label the theatre shows, e.g. "villages du Luberon". */
  readonly label: string;
  readonly query?: string;
  readonly tags?: readonly string[];
  readonly town?: string;
  readonly cluster?: ClusterKey;
  /** YYYY-MM: constrains to events overlapping that month. */
  readonly month?: string;
}

export interface ScoutFinding {
  readonly id: number;
  readonly name: string;
  readonly town: string | null;
  readonly url: string;
  /** Catalogue photo (myprovence.fr), fuels the mission hero collage. */
  readonly img: string | null;
  /** Pictogram for the flag (see lib/glyphs). */
  readonly glyph: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly summary: string;
  /** ISO dates when the finding itself is an event. */
  readonly d1: string | null;
  readonly d2: string | null;
  /** The next dated event in the same town, when the finding is a place. */
  readonly upcoming: { name: string; date: string; url: string } | null;
}

export type Verdict = 'pending' | 'kept' | 'dismissed';

export interface ScoutReport {
  readonly scoutId: string;
  readonly label: string;
  readonly total: number;
  readonly findings: readonly ScoutFinding[];
  readonly verdicts: Readonly<Record<number, Verdict>>;
}

export interface Mission {
  readonly missionId: string;
  readonly mission: string;
  readonly reports: readonly ScoutReport[];
  /** Folded town names the briefs targeted: a NEW search naming a town
   *  outside this list is a context switch and retires immediately. */
  readonly towns?: readonly string[];
}

export const MAX_SCOUTS = 4;
export const MAX_FINDINGS = 3;

/** "2026-10" -> ["2026-10-01", "2026-10-31"] (month lengths matter). */
function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

function briefToFilter(brief: ScoutBrief): FilterInput {
  const [from, to] = brief.month ? monthRange(brief.month) : [undefined, undefined];
  return {
    query: brief.query,
    tags: brief.tags && brief.tags.length > 0 ? brief.tags : undefined,
    town: brief.town,
    cluster: brief.cluster,
    from,
    to,
    limit: MAX_FINDINGS,
    offset: 0,
  };
}

/** Pure: run every brief against the engine, enrich places with the next
 *  dated event of their town. Throws UnknownSlugError/UnknownTownError from
 *  the engine untouched — makeExecute already translates those. */
export function runMission(
  store: ScoutEngine,
  mission: string,
  briefs: readonly ScoutBrief[],
  today: string,
): Mission {
  // Scouts explore DIFFERENT angles: a place already claimed by an earlier
  // scout is skipped, so two scouts never plant duplicate flags on one roof
  // (audit pass 7). The engine is asked for extra rows to compensate.
  const claimed = new Set<number>();
  const reports: ScoutReport[] = briefs.slice(0, MAX_SCOUTS).map((brief, i) => {
    const filter = briefToFilter(brief);
    const { total, places } = store.peekFilter({ ...filter, limit: MAX_FINDINGS * 3 });
    const fresh = places.filter((p) => !claimed.has(p.id)).slice(0, MAX_FINDINGS);
    for (const p of fresh) claimed.add(p.id);
    const findings: ScoutFinding[] = fresh.map((p) => {
      const pub = store.toPublicShape(p);
      const isEvent = p.d1 !== undefined;
      let upcoming: ScoutFinding['upcoming'] = null;
      if (!isEvent && pub.town) {
        try {
          const events = store.peekFilter({
            town: pub.town,
            from: today,
            to: '9999-12-31',
            limit: 5,
            offset: 0,
          }).places;
          // Prefer an event that STARTS soon over a permanent one that has
          // been running since January (both overlap the window, but "next
          // event" reads wrong on a card dated 1 Jan).
          const ev = events.find((e) => (e.d1 ?? '') >= today) ?? events[0];
          if (ev && ev.d1) {
            const evPub = store.toPublicShape(ev);
            upcoming = { name: evPub.name, date: ev.d1, url: evPub.url };
          }
        } catch {
          upcoming = null; // enrichment must never cost a scout
        }
      }
      return {
        id: pub.id,
        name: pub.name,
        town: pub.town,
        url: pub.url,
        img: pub.image,
        glyph: pickGlyph(p, store.vocab),
        lat: pub.lat,
        lng: pub.lng,
        summary: pub.summary,
        d1: isEvent ? (p.d1 ?? null) : null,
        d2: isEvent ? (p.d2 ?? null) : null,
        upcoming,
      };
    });
    return {
      scoutId: `s${i + 1}`,
      label: brief.label,
      total,
      findings,
      verdicts: Object.fromEntries(findings.map((f) => [f.id, 'pending' as Verdict])),
    };
  });
  const towns = [...new Set(briefs.map((b) => b.town).filter((t): t is string => !!t).map(fold))];
  return { missionId: `m-${Date.now().toString(36)}`, mission, reports, towns };
}

const MAX_HISTORY = 8;

/** A new agent search only retires a mission that has sat IDLE this long.
 *  Shorter, and the agent's own refinement searches (send_scouts then
 *  filter_places for a restaurant, same request — field screenshot 1 Sep)
 *  would kill the banner seconds after it appeared; longer, and a genuinely
 *  new question inherits a stale banner. Verdict taps reset the clock. */
export const MISSION_IDLE_MS = 120_000;

export class ScoutMissionStore {
  #active: Mission | null = null;
  #history: Mission[] = [];
  #historySnapshot: readonly Mission[] = [];
  #listeners = new Set<() => void>();
  #touchedAt = 0;

  start(mission: Mission): void {
    if (this.#active && this.#active.missionId !== mission.missionId) {
      this.#history = [
        this.#active,
        ...this.#history.filter((m) => m.missionId !== this.#active!.missionId),
      ].slice(0, MAX_HISTORY);
    }
    this.#history = this.#history.filter((m) => m.missionId !== mission.missionId);
    this.#historySnapshot = [...this.#history];
    this.#active = mission;
    this.#touchedAt = Date.now();
    for (const fn of this.#listeners) fn();
  }

  /** The stage empties: the visitor (or the agent) moved on to a different
   *  request, so the mission banner and flags retire to history instead of
   *  lying about the current context (field bug 1 Sep: "ce soir à
   *  Marseille" under a romantic-weekend banner). Verdicts stay intact and
   *  the mission remains restorable. */
  retire(): void {
    if (!this.#active) return;
    this.#touchedAt = 0;
    this.#history = [
      this.#active,
      ...this.#history.filter((m) => m.missionId !== this.#active!.missionId),
    ].slice(0, MAX_HISTORY);
    this.#historySnapshot = [...this.#history];
    this.#active = null;
    for (const fn of this.#listeners) fn();
  }

  /** Retire only a mission the visitor has stopped touching: the agent's
   *  own refinement searches arrive within seconds of the mission (or of a
   *  verdict tap) and must not empty the stage mid-interaction. */
  retireIfIdle(graceMs: number = MISSION_IDLE_MS, now: number = Date.now()): boolean {
    if (!this.#active) return false;
    if (now - this.#touchedAt < graceMs) return false;
    this.retire();
    return true;
  }

  /** A search naming a town OUTSIDE the mission's own towns is a context
   *  switch ("ce soir à Marseille" under a Tarascon banner — field bug
   *  1 Sep): retire immediately. Same-town or town-less searches are
   *  refinements and only retire after the idle grace. */
  retireForNewContext(town: string | undefined, now: number = Date.now()): boolean {
    if (!this.#active) return false;
    const missionTowns = this.#active.towns ?? [];
    if (town && missionTowns.length > 0 && !missionTowns.includes(fold(town))) {
      this.retire();
      return true;
    }
    return this.retireIfIdle(MISSION_IDLE_MS, now);
  }

  /** Bring an archived mission back on stage (verdicts intact). */
  restore(missionId: string): Mission | null {
    const mission = this.#history.find((m) => m.missionId === missionId);
    if (!mission) return null;
    this.start(mission);
    return mission;
  }

  history = (): readonly Mission[] => this.#historySnapshot;

  setVerdict(findingId: number, verdict: Verdict): boolean {
    if (!this.#active) return false;
    let touched = false;
    const reports = this.#active.reports.map((r) => {
      if (!(findingId in r.verdicts)) return r;
      touched = true;
      return { ...r, verdicts: { ...r.verdicts, [findingId]: verdict } };
    });
    if (!touched) return false;
    this.#active = { ...this.#active, reports };
    this.#touchedAt = Date.now();
    for (const fn of this.#listeners) fn();
    return true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): Mission | null => this.#active;

  destroy(): void {
    this.#listeners.clear();
    this.#active = null;
    this.#history = [];
    this.#historySnapshot = [];
  }
}

let singleton: ScoutMissionStore | null = null;

export function getScoutStore(): ScoutMissionStore {
  if (typeof window === 'undefined') throw new Error('ScoutMissionStore is client-only');
  if (!singleton) singleton = new ScoutMissionStore();
  return singleton;
}
