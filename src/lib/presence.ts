/**
 * PresenceBus — the event stream that gives the agent a body (issue #607).
 *
 * Every tool execution emits typed phases; the AgentPresence component and
 * the tool-theatre effects consume them. Design rules from the v2 plan:
 *  - announce BEFORE acting (predictability builds trust — Amershi CHI'19,
 *    Horvitz mixed-initiative);
 *  - zero impact on the measured query path: emission is a synchronous
 *    array push outside runFilter, and rendering is the subscribers'
 *    problem;
 *  - same leak posture as DemandLog: bounded ring, unsubscribe fns,
 *    idempotent destroy(); the singleton lives for the page lifetime but
 *    tests and HMR stay clean.
 */

export type PresenceTarget =
  | 'filters'
  | 'map'
  | 'plan'
  | 'park'
  | { lat: number; lng: number };

export type PresenceEvent =
  | { phase: 'announce'; tool: string; intent: string; at: number }
  | { phase: 'focus'; target: PresenceTarget; at: number }
  | {
      phase: 'act';
      tool: string;
      at: number;
      /** theatre payloads, all optional and presentation-only */
      tags?: readonly string[];
      radiusKm?: number;
      center?: { lat: number; lng: number };
      labelIds?: readonly number[];
    }
  | { phase: 'done'; tool: string; at: number }
  | { phase: 'yield'; at: number };

const RING_CAP = 100;

/** Omit that distributes over a union (plain Omit collapses PresenceEvent
 *  to its common keys, losing every variant's payload). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type PresenceInput = DistributiveOmit<PresenceEvent, 'at'> & { at?: number };

export class PresenceBus {
  #ring: PresenceEvent[] = [];
  #snapshot: readonly PresenceEvent[] = [];
  #listeners = new Set<() => void>();

  emit(event: PresenceInput): void {
    const stamped = {
      ...event,
      at: event.at ?? (typeof performance !== 'undefined' ? Math.round(performance.now()) : 0),
    } as PresenceEvent;
    this.#ring.push(stamped);
    if (this.#ring.length > RING_CAP) this.#ring.shift();
    this.#snapshot = [...this.#ring];
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): readonly PresenceEvent[] => this.#snapshot;

  last(): PresenceEvent | null {
    return this.#snapshot.length > 0 ? this.#snapshot[this.#snapshot.length - 1]! : null;
  }

  destroy(): void {
    this.#listeners.clear();
    this.#ring = [];
    this.#snapshot = [];
  }
}

let singleton: PresenceBus | null = null;

export function getPresenceBus(): PresenceBus {
  if (typeof window === 'undefined') throw new Error('PresenceBus is client-only');
  if (!singleton) singleton = new PresenceBus();
  return singleton;
}

/**
 * Intent lines, one per tool — announced BEFORE the action, factual and
 * short (anti-Clippy rule: one intent, no chatter, silence at rest).
 * Locale-aware since 2 Sep (field bug: French bubbles over the EN site):
 * the client root pins the locale once per page.
 */
let presenceLocale: 'fr' | 'en' = 'fr';

export function setPresenceLocale(locale: string): void {
  presenceLocale = locale === 'en' ? 'en' : 'fr';
}

export function intentFor(tool: string, args: Record<string, unknown>): string {
  return clip(presenceLocale === 'en' ? rawIntentEn(tool, args) : rawIntent(tool, args));
}

function rawIntentEn(tool: string, args: Record<string, unknown>): string {
  const short = (v: unknown, n: number) =>
    typeof v === 'string' ? (v.length <= n ? v : v.slice(0, n - 1) + '…') : '';
  switch (tool) {
    case 'filter_places': {
      const parts: string[] = [];
      if (typeof args.query === 'string') parts.push(`“${short(args.query, 40)}”`);
      if (Array.isArray(args.tags) && args.tags.length > 0)
        parts.push((args.tags as string[]).slice(0, 3).join(', '));
      if (typeof args.town === 'string') parts.push(`in ${args.town}`);
      return parts.length > 0 ? `searching ${parts.join(' · ')}` : 'browsing the catalogue';
    }
    case 'find_events': {
      if (typeof args.month === 'string') return `checking the ${args.month} agenda`;
      if (typeof args.query === 'string') return `searching the agenda for “${short(args.query, 40)}”`;
      return 'checking the agenda';
    }
    case 'find_near':
      return typeof args.town === 'string'
        ? `looking around ${args.town}`
        : 'searching nearby';
    case 'get_place':
      return 'reading a record';
    case 'compare_places':
      return 'comparing your options';
    case 'get_catalog_stats':
      return 'taking the measure of the catalogue';
    case 'explain_vocabulary':
      return 'checking the criteria';
    case 'set_view':
      return 'moving the map';
    case 'highlight_places':
      return 'showing you a selection';
    case 'get_demand_pulse':
      return 'reading traveller demand';
    case 'send_scouts': {
      const n = Array.isArray(args.scouts) ? args.scouts.length : 0;
      return n > 0 ? `sending ${n} scouts across the map` : 'sending my scouts';
    }
    case 'get_scout_reports':
      return 'collecting the scout reports';
    case 'find_tonight':
      return typeof args.town === 'string'
        ? `checking what's on tonight in ${short(args.town, 30)}`
        : "checking what's on tonight";
    case 'get_visitor_view':
      return 'looking at what you are looking at';
    case 'pin_visible_place':
      return typeof args.name === 'string'
        ? `showing you ${short(args.name, 50)}`
        : 'showing you a place';
    case 'write_postcard':
      return 'writing your postcard';
    case 'compose_carnet':
      return 'composing your travel carnet';
    case 'get_visitor_signals':
      return 'reading your gestures';
    case 'ask_visitor':
      return 'a question for you';
    case 'get_input_result':
      return 'collecting your answer';
    default:
      return 'working';
  }
}

/** One short line, whatever the inputs: a 200-char query must not flood the
 *  intent bubble (pinned by tests). */
const INTENT_MAX = 90;
function clip(s: string): string {
  return s.length <= INTENT_MAX ? s : s.slice(0, INTENT_MAX - 1).trimEnd() + '…';
}

function rawIntent(tool: string, args: Record<string, unknown>): string {
  const short = (v: unknown, n: number) =>
    typeof v === 'string' ? (v.length <= n ? v : v.slice(0, n - 1) + '…') : '';
  switch (tool) {
    case 'filter_places': {
      const parts: string[] = [];
      if (typeof args.query === 'string') parts.push(`« ${short(args.query, 40)} »`);
      if (Array.isArray(args.tags) && args.tags.length > 0)
        parts.push((args.tags as string[]).slice(0, 3).join(', '));
      if (typeof args.town === 'string') parts.push(`à ${args.town}`);
      return parts.length > 0 ? `je cherche ${parts.join(' · ')}` : 'je parcours le catalogue';
    }
    case 'find_events': {
      if (typeof args.month === 'string') return `je regarde l'agenda de ${args.month}`;
      if (typeof args.query === 'string') return `je cherche « ${short(args.query, 40)} » à l'agenda`;
      return "je regarde l'agenda";
    }
    case 'find_near':
      return typeof args.town === 'string'
        ? `je regarde autour de ${args.town}`
        : 'je cherche à proximité';
    case 'get_place':
      return 'je lis une fiche';
    case 'compare_places':
      return 'je compare vos options';
    case 'get_catalog_stats':
      return "je prends la mesure du catalogue";
    case 'explain_vocabulary':
      return 'je consulte les critères';
    case 'set_view':
      return 'je déplace la carte';
    case 'highlight_places':
      return 'je vous montre une sélection';
    case 'get_demand_pulse':
      return 'je lis la demande des voyageurs';
    case 'send_scouts': {
      const n = Array.isArray(args.scouts) ? args.scouts.length : 0;
      return n > 0 ? `j'envoie ${n} éclaireurs sur la carte` : "j'envoie mes éclaireurs";
    }
    case 'get_scout_reports':
      return 'je relève les rapports des éclaireurs';
    case 'find_tonight':
      return typeof args.town === 'string'
        ? `je cherche ce qui se passe ce soir à ${short(args.town, 30)}`
        : 'je cherche ce qui se passe ce soir';
    case 'get_visitor_view':
      return 'je regarde ce que vous regardez';
    case 'pin_visible_place':
      return typeof args.name === 'string'
        ? `je vous montre ${short(args.name, 50)}`
        : 'je vous montre un lieu';
    case 'write_postcard':
      return "j'écris votre carte postale";
    case 'compose_carnet':
      return 'je compose votre carnet de voyage';
    case 'get_visitor_signals':
      return 'je lis vos gestes';
    case 'ask_visitor':
      return 'une question pour vous';
    case 'get_input_result':
      return 'je relève votre réponse';
    default:
      return 'je travaille';
  }
}
