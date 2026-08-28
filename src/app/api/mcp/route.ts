/**
 * POST /api/mcp — remote MCP endpoint (streamable-HTTP, stateless JSON
 * responses) so MCP clients that never open a page (claude.ai connectors,
 * IDEs) reach the same read-only tools as WebMCP visitors. The dispatcher
 * itself is pure and unit-tested in src/lib/mcp-server.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleMcpMessage, type McpExtras } from '@/lib/mcp-server';
import { aggregatePulse, PULSE_WINDOW_DAYS, type PulseRow } from '@/lib/demand-pulse';
import { createClient } from '@supabase/supabase-js';
import { getServerCatalog } from '@/lib/server-catalog';
import { allowRequest, clientIpOf } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!allowRequest(clientIpOf(request.headers))) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rate limited' } },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'payload too large' } },
        { status: 413 },
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { status: 400 },
    );
  }

  let sc;
  try {
    sc = await getServerCatalog(request.nextUrl.origin);
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'catalogue unavailable' } },
      { status: 503 },
    );
  }

  const extras = buildExtras();

  // Streamable HTTP allows batches; answer each, drop notification replies.
  if (Array.isArray(body)) {
    const replies = (
      await Promise.all(
        body.map((m) => handleMcpMessage(m as Parameters<typeof handleMcpMessage>[0], sc, extras)),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null);
    return replies.length > 0
      ? NextResponse.json(replies)
      : new NextResponse(null, { status: 202 });
  }

  const reply = await handleMcpMessage(body as Parameters<typeof handleMcpMessage>[0], sc, extras);
  return reply === null
    ? new NextResponse(null, { status: 202 })
    : NextResponse.json(reply);
}

/** get_demand_pulse over MCP when the telemetry env is present. */
function buildExtras(): McpExtras {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.WEBMCP_WORKSPACE_ID;
  if (!url || !key || !workspaceId) return {};
  return {
    demandPulse: async () => {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const cutoff = new Date(Date.now() - PULSE_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('webmcp_demand_events')
        .select('args_summary, zero_result, occurred_hour')
        .eq('workspace_id', workspaceId)
        .gte('occurred_hour', cutoff)
        .limit(5000);
      if (error) throw new Error(error.code);
      return aggregatePulse((data ?? []) as PulseRow[], new Date());
    },
  };
}

export function GET(): NextResponse {
  // No server-initiated stream: stateless JSON responses only.
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'POST JSON-RPC only' } },
    { status: 405 },
  );
}
