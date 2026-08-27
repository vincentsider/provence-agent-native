/**
 * POST /api/demand — aggregate Demand Mirror counters (spec 9.2, issue #603).
 *
 * Receives COUNTERS ONLY and writes them to Supabase webmcp_demand_events
 * (deny-all RLS; only this route's service role can touch it — table created
 * 27 Aug 2026, columns verified via MCP before this code was written).
 *
 * Privacy: the client IP is used for the in-memory rate limiter and is never
 * stored or logged. Timestamps are truncated to the hour server-side. There
 * is no field in the payload capable of carrying a personal identifier.
 *
 * The Demand Mirror panel works fully when this endpoint is unconfigured:
 * missing env vars mean 204 no-op, never an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CLUSTER_KEYS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eventSchema = z
  .object({
    tool: z.string().min(1).max(64),
    tags: z.array(z.string().min(1).max(64)).max(12).optional(),
    cluster: z.enum(CLUSTER_KEYS).optional(),
    minGrade: z.number().int().min(1).max(5).optional(),
    resultTotal: z.number().int().min(0).max(100000),
    zeroResult: z.boolean(),
  })
  .strict();

const bodySchema = z
  .object({ events: z.array(eventSchema).min(1).max(50) })
  .strict();

// Best-effort token bucket per IP. Serverless instances each get their own
// bucket; that is acceptable for an abuse brake on an aggregate endpoint.
const BUCKET_CAP = 30;
const REFILL_PER_MS = BUCKET_CAP / 60_000; // 30 per minute
const buckets = new Map<string, { tokens: number; at: number }>();
const BUCKETS_CAP = 10_000;

function allow(ip: string): boolean {
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

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.WEBMCP_WORKSPACE_ID;
  if (!url || !key || !workspaceId) {
    return new NextResponse(null, { status: 204 });
  }

  if (!allow(clientIp(request))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  let parsed: z.output<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const occurredHour = new Date();
  occurredHour.setMinutes(0, 0, 0);

  const rows = parsed.events.map((e) => ({
    workspace_id: workspaceId,
    surface: 'provence-agent-native',
    tool_name: e.tool,
    args_summary: {
      ...(e.tags && e.tags.length > 0 ? { tags: e.tags } : {}),
      ...(e.cluster ? { cluster: e.cluster } : {}),
      ...(e.minGrade !== undefined ? { minGrade: e.minGrade } : {}),
    },
    result_total: e.resultTotal,
    zero_result: e.zeroResult,
    occurred_hour: occurredHour.toISOString(),
  }));

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from('webmcp_demand_events').insert(rows);
  if (error) {
    // Telemetry failure is not the caller's problem; log without payload.
    console.error('webmcp_demand_events insert failed:', error.code);
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse(null, { status: 204 });
}
