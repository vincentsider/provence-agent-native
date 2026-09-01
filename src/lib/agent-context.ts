/**
 * The agent's CURRENT request, as a short human label (1 Sep, field
 * feedback: the carnet clusters keeps around the request they answered, and
 * the masthead strip shows the visitor what the agent is working on RIGHT
 * NOW instead of a stale banner). Search tools set it; the map's keep
 * buttons stamp it onto shortlist items; the RequestStrip renders it.
 *
 * Same bounded-observable pattern as the other stores, reduced to one
 * string: stable getSnapshot, listener set, SSR-safe (no window access).
 */

let last: string | null = null;
let lastTown: string | null = null;
const listeners = new Set<() => void>();

export function setAgentRequest(label: string | null, town?: string | null): void {
  const trimmed = label?.trim().slice(0, 80) ?? null;
  const next = trimmed && trimmed.length > 0 ? trimmed : null;
  const nextTown = town?.trim().slice(0, 80) || null;
  if (next === last && nextTown === lastTown) return;
  last = next;
  lastTown = nextTown;
  for (const fn of listeners) fn();
}

export function getAgentRequest(): string | null {
  return last;
}

/** The town the agent's current search explicitly targets, when it names
 *  one (field feedback 1 Sep: "explicit on a city means the town filter
 *  must SHOW that city, never 'all towns'"). */
export function getAgentTown(): string | null {
  return lastTown;
}

export function subscribeAgentRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
