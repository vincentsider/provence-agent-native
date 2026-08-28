/**
 * POST /api/mcp — remote MCP endpoint (streamable-HTTP, stateless JSON
 * responses) so MCP clients that never open a page (claude.ai connectors,
 * IDEs) reach the same read-only tools as WebMCP visitors. The dispatcher
 * itself is pure and unit-tested in src/lib/mcp-server.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleMcpMessage } from '@/lib/mcp-server';
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

  // Streamable HTTP allows batches; answer each, drop notification replies.
  if (Array.isArray(body)) {
    const replies = body
      .map((m) => handleMcpMessage(m as Parameters<typeof handleMcpMessage>[0], sc))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return replies.length > 0
      ? NextResponse.json(replies)
      : new NextResponse(null, { status: 202 });
  }

  const reply = handleMcpMessage(body as Parameters<typeof handleMcpMessage>[0], sc);
  return reply === null
    ? new NextResponse(null, { status: 202 })
    : NextResponse.json(reply);
}

export function GET(): NextResponse {
  // No server-initiated stream: stateless JSON responses only.
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'POST JSON-RPC only' } },
    { status: 405 },
  );
}
