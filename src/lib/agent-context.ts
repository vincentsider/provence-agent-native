/**
 * The agent's CURRENT request, as a short human label (1 Sep, field
 * feedback: the carnet must cluster keeps around the request they answered,
 * not pile everything together). Search tools set it; the map's keep
 * buttons stamp it onto shortlist items. Module state only — no listeners,
 * no persistence, SSR-safe.
 */

let last: string | null = null;

export function setAgentRequest(label: string | null): void {
  const trimmed = label?.trim().slice(0, 80) ?? null;
  last = trimmed && trimmed.length > 0 ? trimmed : null;
}

export function getAgentRequest(): string | null {
  return last;
}
