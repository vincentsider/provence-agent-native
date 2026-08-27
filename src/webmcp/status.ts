/**
 * Observable registration status, so the page can tell the truth about the
 * agent surface instead of "the API exists, therefore all is well".
 *
 * This exists because of a real field failure: in ChatGPT's browser the badge
 * showed green (document.modelContext present) while the agent used zero site
 * tools, and nothing on the page could say whether registration had silently
 * failed or the agent had simply not called. The badge now reports how many
 * tools actually registered, and getTools()-verified when the browser allows.
 */

export interface WebMcpStatus {
  /** document.modelContext.registerTool exists. */
  readonly supported: boolean;
  /** registerTool promises resolved. */
  readonly registered: number;
  /** registrations that threw or rejected, with the reason. */
  readonly failed: ReadonlyArray<{ name: string; reason: string }>;
  /** our tools visible via getTools() after registration; null = not checkable. */
  readonly verified: number | null;
}

const INITIAL: WebMcpStatus = {
  supported: false,
  registered: 0,
  failed: [],
  verified: null,
};

let state: WebMcpStatus = INITIAL;
const listeners = new Set<() => void>();

export function getWebMcpStatus(): WebMcpStatus {
  return state;
}

export function subscribeWebMcpStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function patchWebMcpStatus(partial: Partial<WebMcpStatus>): void {
  state = { ...state, ...partial };
  for (const fn of listeners) fn();
}

export function recordRegistration(ok: boolean, name: string, reason?: string): void {
  state = {
    ...state,
    registered: state.registered + (ok ? 1 : 0),
    failed: ok ? state.failed : [...state.failed, { name, reason: reason ?? 'unknown' }],
  };
  for (const fn of listeners) fn();
}
