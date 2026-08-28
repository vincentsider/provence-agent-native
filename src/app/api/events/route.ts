/**
 * GET /api/events — the fetch-only agent surface for the agenda.
 *
 * Exists because most assistants (claude.ai, chatgpt.com without the desktop
 * browser) fetch HTML server-side and never execute WebMCP (field failure,
 * 28 Aug). Same engine, same validated inputs, same output shape as the
 * find_events site tool, over a plain GET any client can call.
 *
 *   /api/events?month=2026-10
 *   /api/events?query=street+food
 *   /api/events?from=2026-09-10&to=2026-09-12&category=festival&town=Marseille
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseEventsParams } from '@/lib/api-params';
import { toPublicShape } from '@/lib/public-shape';
import { runFilter } from '@/lib/engine';
import { getServerCatalog } from '@/lib/server-catalog';
import { allowRequest, clientIpOf } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!allowRequest(clientIpOf(request.headers))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const parsed = parseEventsParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, issues: parsed.issues },
      { status: 400 },
    );
  }
  const input = parsed.value;

  let sc;
  try {
    sc = await getServerCatalog(request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: 'catalogue unavailable' }, { status: 503 });
  }

  let from = input.from;
  let to = input.to;
  if (input.month) [from, to] = monthRange(input.month);

  const { total, indices } = runFilter(sc.catalog, sc.indexes, {
    cluster: 'agenda',
    category: input.category,
    town: input.town,
    tags: input.tags,
    query: input.query,
    ...(from !== undefined || to !== undefined ? { from, to } : {}),
    limit: input.limit,
    offset: input.offset,
  });

  return NextResponse.json(
    {
      source: 'myprovence.fr (official Provence Tourisme catalogue)',
      generatedAt: sc.generatedAt,
      window: { from: from ?? null, to: to ?? null },
      total,
      returned: indices.length,
      truncated: total > input.offset + indices.length,
      results: indices.map((i) =>
        toPublicShape(sc.catalog.places[i]!, sc.vocab, sc.indexes.aliasToCanonical),
      ),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
