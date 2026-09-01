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
const listeners = new Set<() => void>();

export function setAgentRequest(label: string | null): void {
  const trimmed = label?.trim().slice(0, 80) ?? null;
  const next = trimmed && trimmed.length > 0 ? trimmed : null;
  if (next === last) return;
  last = next;
  for (const fn of listeners) fn();
}

export function getAgentRequest(): string | null {
  return last;
}

export function subscribeAgentRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
