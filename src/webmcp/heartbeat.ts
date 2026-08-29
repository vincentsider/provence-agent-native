/**
 * read_visitor_wish — the page -> agent wire (29 Aug, Vincent: "can you wire
 * the page to chatgpt?").
 *
 * WebMCP has no push channel to the agent (spec gaps #148/#229), but the
 * browser re-reads the TOOL LIST every conversation turn. So this tool only
 * EXISTS once the visitor has typed a wish or given verdicts, and its
 * DESCRIPTION is re-written with the live state each time it changes: at the
 * agent's next turn, the visitor's actions are already in its context,
 * before any call. Description-as-heartbeat + tools-appearing-mid-session,
 * both spec-showcase mechanics, zero non-standard API.
 *
 * Same defensive posture as dynamic.ts: debounced, change-keyed, abort-based
 * re-registration with a no-signal fallback, never at the base tools' cost.
 */

import { getSignalsLog, type VisitorSignal } from '@/lib/signals';
import { getScoutStore, type Mission } from '@/lib/scouts';
import { getShortlistStore, type ShortlistItem } from '@/lib/shortlist';
import { makeExecute } from './tools';
import { z } from 'zod';

const DEBOUNCE_MS = 600;

export interface ContextState {
  readonly wish: string | null;
  readonly mission: Mission | null;
  readonly kept: readonly ShortlistItem[];
}

/** Pure and unit-tested: the live description the agent reads each turn. */
export function describeContext(state: ContextState): string {
  const parts: string[] = ['LIVE PAGE STATE, read before answering anything.'];
  if (state.wish) parts.push(`The visitor TYPED into the page: "${state.wish.slice(0, 90)}".`);
  if (state.mission) {
    const labels = state.mission.reports.map((r) => r.label).join(', ');
    parts.push(`The page already dispatched ${state.mission.reports.length} scouts (${labels}) — do NOT redo these searches.`);
  }
  if (state.kept.length > 0) {
    const names = state.kept.slice(0, 4).map((i) => i.name).join('; ');
    parts.push(`They KEPT ${state.kept.length} flag(s): ${names}. Treat as decisions.`);
  }
  parts.push('Call this tool for the full detail (wish, scout reports, verdicts, selection).');
  return parts.join(' ').slice(0, 950);
}

function currentState(): ContextState {
  const wishes = getSignalsLog()
    .getSnapshot()
    .filter((s): s is Extract<VisitorSignal, { kind: 'wish' }> => s.kind === 'wish');
  return {
    wish: wishes.length > 0 ? wishes[wishes.length - 1]!.text : null,
    mission: getScoutStore().getSnapshot(),
    kept: getShortlistStore().getSnapshot(),
  };
}

let started = false;
let controller: AbortController | null = null;
let lastKey = '';
let signalUnsupported = false;

async function reregister(): Promise<void> {
  if (signalUnsupported && lastKey !== '') return;
  const mc = document.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return;
  const state = currentState();
  // The tool appears only once there is something to read.
  if (!state.wish && !state.mission && state.kept.length === 0) return;
  const description = describeContext(state);
  if (description === lastKey) return;

  const next = signalUnsupported ? null : new AbortController();
  try {
    controller?.abort();
    await mc.registerTool(
      {
        name: 'read_visitor_wish',
        title: 'Ce que le visiteur vient de faire',
        description,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: makeExecute('read_visitor_wish', z.object({}).strict(), () => {
          const s = currentState();
          return {
            total: s.kept.length,
            data: {
              wish: s.wish,
              mission: s.mission,
              keptSelection: s.kept,
              instruction:
                'The page already ran these searches. Continue from the verdicts; never re-search what a scout covered.',
            },
          };
        }),
      },
      next ? { signal: next.signal } : undefined,
    );
    controller = next;
    lastKey = description;
  } catch {
    if (!signalUnsupported) {
      signalUnsupported = true;
      if (controller) lastKey = description;
      return;
    }
    lastKey = description; // stop churning; the first registration stays live
  }
}

/** Idempotent; called from the client root after registerAll(). */
export function startWishHeartbeat(): void {
  if (started || typeof document === 'undefined') return;
  let mc: ModelContext | undefined;
  try {
    mc = document.modelContext;
  } catch {
    return;
  }
  if (!mc || typeof mc.registerTool !== 'function') return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void reregister().catch(() => {
        /* heartbeat must never throw into a subscriber */
      });
    }, DEBOUNCE_MS);
  };
  try {
    getSignalsLog().subscribe(schedule);
    getScoutStore().subscribe(schedule);
    getShortlistStore().subscribe(schedule);
  } catch {
    /* stores are client-only */
  }
}
