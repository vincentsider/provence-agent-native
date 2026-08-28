/**
 * GET /api/demand-pulse (issue #609): the town-level agent-demand aggregate
 * feeding the map's pulse layer, the page tool and the MCP tool. Service key
 * stays server-side; counters only; CDN-cached 5 minutes; rate-limited.
 * Unconfigured env degrades to an empty pulse, never an error — the page
 * must not depend on telemetry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aggregatePulse, PULSE_WINDOW_DAYS, type PulseRow } from '@/lib/demand-pulse';
import { allowRequest, clientIpOf } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let cachedClient: SupabaseClient | null = null;
let cachedFor = '';
function getSupabase(url: string, key: string): SupabaseClient {
  const id = `${url}:${key.length}`;
  if (!cachedClient || cachedFor !== id) {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cachedFor = id;
  }
  return cachedClient;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!allowRequest(clientIpOf(request.headers))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.WEBMCP_WORKSPACE_ID;
  const empty = { windowDays: PULSE_WINDOW_DAYS, totalRequests: 0, towns: [] };
  if (!url || !key || !workspaceId) {
    return NextResponse.json(empty, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
    });
  }

  const cutoff = new Date(Date.now() - PULSE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await getSupabase(url, key)
    .from('webmcp_demand_events')
    .select('args_summary, zero_result, occurred_hour')
    .eq('workspace_id', workspaceId)
    .gte('occurred_hour', cutoff)
    .order('occurred_hour', { ascending: false })
    .limit(5000);

  if (error) {
    // Telemetry read failure must not surface as a page failure.
    return NextResponse.json(empty, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  }

  return NextResponse.json(aggregatePulse((data ?? []) as PulseRow[], new Date()), {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
