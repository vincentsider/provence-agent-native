/**
 * GET /api/places — the fetch-only agent surface for the five guides.
 * Same engine, validated inputs and output shape as the filter_places site
 * tool, over a plain GET.
 *
 *   /api/places?cluster=hotels&tag=parking&tag=animaux-acceptes
 *   /api/places?query=piscine+chauffée&cluster=hotels
 */

import { NextRequest, NextResponse } from 'next/server';
import { parsePlacesParams } from '@/lib/api-params';
import { toPublicShape } from '@/lib/public-shape';
import { UnknownSlugError, UnknownTownError, runFilter } from '@/lib/engine';
import { getServerCatalog } from '@/lib/server-catalog';
import { allowRequest, clientIpOf } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!allowRequest(clientIpOf(request.headers))) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }
  const parsed = parsePlacesParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, issues: parsed.issues },
      { status: 400 },
    );
  }

  let sc;
  try {
    sc = await getServerCatalog(request.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: 'catalogue unavailable' }, { status: 503 });
  }

  try {
    const { total, indices } = runFilter(sc.catalog, sc.indexes, parsed.value);
    return NextResponse.json(
      {
        source: 'myprovence.fr (official Provence Tourisme catalogue)',
        generatedAt: sc.generatedAt,
        total,
        returned: indices.length,
        truncated: total > parsed.value.offset + indices.length,
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
  } catch (err) {
    // Closed-vocabulary misses stay self-correcting over HTTP too.
    if (err instanceof UnknownSlugError) {
      return NextResponse.json(
        { error: `unknown tag: ${err.slug}`, suggestions: err.suggestions },
        { status: 400 },
      );
    }
    if (err instanceof UnknownTownError) {
      return NextResponse.json(
        { error: `unknown town: ${err.town}`, suggestions: err.suggestions },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
