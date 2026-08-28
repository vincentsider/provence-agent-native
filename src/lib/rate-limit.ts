/**
 * Best-effort in-memory token bucket per IP, shared by the public agent
 * endpoints. Serverless instances each get their own bucket: acceptable as
 * an abuse brake on cheap read-only endpoints. The IP is used as a map key
 * only and never stored or logged (privacy posture, spec 8.7).
 */

const BUCKET_CAP = 60;
const REFILL_PER_MS = BUCKET_CAP / 60_000; // 60 per minute
const BUCKETS_CAP = 10_000;

const buckets = new Map<string, { tokens: number; at: number }>();

export function allowRequest(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    if (buckets.size >= BUCKETS_CAP) buckets.clear(); // bounded memory
    b = { tokens: BUCKET_CAP, at: now };
    buckets.set(ip, b);
  }
  b.tokens = Math.min(BUCKET_CAP, b.tokens + (now - b.at) * REFILL_PER_MS);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function clientIpOf(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() ?? 'unknown';
}
