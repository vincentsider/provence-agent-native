/**
 * pin_visible_place (v3, issue #615) — the frontier mechanic: the tool's
 * schema is an ENUM of the place names currently on the visitor's screen,
 * re-registered when the view changes. A place that is not visible is
 * invalid BY THE SCHEMA; the agent literally cannot act outside the shared
 * view. This is spec issue #167's dynamic-tool pattern done in userland via
 * AbortSignal unregistration.
 *
 * Defensive rules (a frontier mechanic must never cost the base tools):
 *  - everything inside try/catch; a failure disables ONLY this module;
 *  - re-registration is debounced (800ms) and skipped when the name set is
 *    unchanged;
 *  - if the browser ignores the AbortSignal (older builds) the duplicate
 *    registration rejects; we detect it once and fall back to the static
 *    tool whose HANDLER validates visibility instead (structured refusal,
 *    spec issue #262 pattern) — same contract, weaker enforcement;
 *  - the status badge counts this tool once, not once per re-registration.
 */

import { getStore } from '@/lib/store';
import { getViewportStore } from '@/lib/viewport';
import { fold } from '@/lib/types';
import { pinVisiblePlaceInput, toJsonSchema } from './schemas';
import { makeExecute } from './tools';
import { recordRegistration } from './status';
import { z } from 'zod';

const DEBOUNCE_MS = 800;
const MAX_NAMES = 60;

const DESCRIPTION =
  'Pin ONE place the visitor can currently SEE on the shared map: highlights it alone ' +
  'and centres the view. The name list in the schema IS what is on their screen right ' +
  'now — if a place is missing, it is not visible; pan with set_view or ask the visitor. ' +
  'Prefer this over get_place when talking about "that one on the map".';

let started = false;
let controller: AbortController | null = null;
let lastKey = '';
let recorded = false;
let signalUnsupported = false;

/** Visible = has coordinates inside the current bounds; highlighted first. */
function visibleNames(): Map<string, number> {
  const store = getStore();
  const vp = getViewportStore().getSnapshot();
  const names = new Map<string, number>();
  if (!vp.bounds || !store.isReady) return names;
  const b = vp.bounds;
  const inBounds = (i: number): boolean => {
    const p = store.catalog.places[i];
    return (
      !!p &&
      p.lat !== null &&
      p.lng !== null &&
      p.lat <= b.north &&
      p.lat >= b.south &&
      p.lng <= b.east &&
      p.lng >= b.west
    );
  };
  const add = (i: number) => {
    const p = store.catalog.places[i]!;
    if (!names.has(p.n)) names.set(p.n, p.id);
  };
  for (const i of store.getView().highlighted) {
    if (names.size >= MAX_NAMES) break;
    if (inBounds(i)) add(i);
  }
  for (let i = 0; i < store.catalog.places.length && names.size < MAX_NAMES; i++) {
    if (inBounds(i)) add(i);
  }
  return names;
}

function buildExecute(schemaNames: ReadonlyMap<string, number>) {
  const schema =
    schemaNames.size > 0
      ? pinVisiblePlaceInput([...schemaNames.keys()])
      : z.object({ name: z.string().min(1).max(120) }).strict();
  return makeExecute(
    'pin_visible_place',
    schema as z.ZodType<{ name: string }>,
    (input: { name: string }, store: import('@/lib/store').Store) => {
      // Visibility is judged at CALL time, never against the map captured at
      // registration: in the no-signal fallback the registered handler lives
      // for the whole session, and even on the enum path the view can move
      // inside the debounce window.
      const names = visibleNames();
      const id =
        names.get(input.name) ??
        [...names.entries()].find(([n]) => fold(n) === fold(input.name))?.[1];
      if (id === undefined) {
        return {
          total: 0,
          data: {
            error: 'not_visible',
            message: "That place is not on the visitor's screen right now.",
            visible: [...names.keys()].slice(0, MAX_NAMES),
          },
        };
      }
      const place = store.getByIdOrUrl({ id });
      if (!place) {
        return { total: 0, data: { error: 'not_visible', message: 'Place left the catalogue.' } };
      }
      store.setHighlightedIds([id], 'agent');
      if (place.lat !== null && place.lng !== null) {
        store.setView({ lat: place.lat, lng: place.lng }, 14, 'agent');
      }
      return { total: 1, data: { pinned: store.toPublicShape(place) } };
    },
  );
}

async function reregister(): Promise<void> {
  // Fallback mode: the first registration stays live (its handler checks
  // visibility itself); churning duplicates would only spam rejections.
  if (signalUnsupported && lastKey !== '') return;
  const mc = document.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return;
  const names = visibleNames();
  if (names.size === 0) return;
  const key = [...names.keys()].join(' ');
  if (key === lastKey) return;

  const next = signalUnsupported ? null : new AbortController();
  const def = {
    name: 'pin_visible_place',
    title: 'Épingler un lieu visible',
    description: DESCRIPTION,
    inputSchema: toJsonSchema(
      signalUnsupported
        ? z.object({ name: z.string().min(1).max(120) }).strict()
        : pinVisiblePlaceInput([...names.keys()]),
    ),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: buildExecute(names),
  };
  try {
    controller?.abort();
    await mc.registerTool(def, next ? { signal: next.signal } : undefined);
    controller = next;
    lastKey = key;
    if (!recorded) {
      recorded = true;
      recordRegistration(true, 'pin_visible_place');
    }
  } catch (err) {
    // A duplicate-name rejection means the abort did not unregister: this
    // browser has no signal support. Keep the first registration (its
    // handler validates visibility itself) and stop churning the schema.
    if (!signalUnsupported) {
      signalUnsupported = true;
      lastKey = key;
      return;
    }
    if (!recorded) {
      recorded = true;
      recordRegistration(false, 'pin_visible_place', String(err).slice(0, 200));
    }
  }
}

/** Idempotent; called from the client root after registerAll(). */
export function startViewportTool(): void {
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
        /* never let the frontier mechanic throw into a subscriber */
      });
    }, DEBOUNCE_MS);
  };
  try {
    getViewportStore().subscribe(schedule);
    getStore().subscribe(schedule);
    schedule();
  } catch {
    /* stores are client-only; any failure just disables this module */
  }
}
