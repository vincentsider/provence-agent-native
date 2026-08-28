/**
 * GET /agenda — server-rendered agenda for agents (and humans) that fetch
 * HTML without executing JavaScript. This is the page Claude GUESSED at
 * (field observation, 28 Aug: it tried /fr/agenda, got a 404, and fell back
 * to Wikipedia). Agents tell us the URLs they expect; this answers them.
 *
 * A route handler rather than a page: every app-router page here lives under
 * [locale] whose layout owns <html>, and this surface must stay dependency-
 * free, tiny and fully server-rendered. Content: the next 90 days of events,
 * semantic HTML, canonical links, pointers to the machine endpoints.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runFilter } from '@/lib/engine';
import { getServerCatalog } from '@/lib/server-catalog';
import { allowRequest, clientIpOf } from '@/lib/rate-limit';
import { CANONICAL_HOST, categoryOf } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!allowRequest(clientIpOf(request.headers))) {
    return new NextResponse('rate limited', { status: 429 });
  }
  let sc;
  try {
    sc = await getServerCatalog(request.nextUrl.origin);
  } catch {
    return new NextResponse('catalogue unavailable', { status: 503 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const { total, indices } = runFilter(sc.catalog, sc.indexes, {
    cluster: 'agenda',
    from: today,
    to: horizon,
    limit: 400,
    offset: 0,
  });

  // "À venir" must READ as upcoming: events STARTING in the window lead,
  // chronologically; long-running always-on events (started 2022...) follow.
  // Without this, 670 overlapping events put multi-year guided tours in all
  // 40 slots and the actual next festival never appears.
  const starting = indices.filter((i) => (sc.catalog.places[i]!.d1 ?? '') >= today);
  const ongoing = indices.filter((i) => (sc.catalog.places[i]!.d1 ?? '') < today);
  const shown = [...starting, ...ongoing].slice(0, 40);

  const items = shown
    .map((i) => {
      const p = sc.catalog.places[i]!;
      const town = p.t >= 0 ? (sc.vocab.towns[p.t] ?? '') : '';
      const cat = categoryOf(p.u) ?? 'agenda';
      const dates = p.d2 && p.d2 !== p.d1 ? `${p.d1} → ${p.d2}` : (p.d1 ?? '');
      return (
        `<li><time datetime="${esc(p.d1 ?? '')}">${esc(dates)}</time> — ` +
        `<a href="https://${CANONICAL_HOST}${esc(p.u)}">${esc(p.n)}</a> ` +
        `(${esc(town)}, ${esc(cat)})</li>`
      );
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Agenda Provence — les 90 prochains jours (catalogue officiel Provence Tourisme)</title>
</head>
<body>
<h1>Agenda Provence — événements des 90 prochains jours</h1>
<p>Source : catalogue officiel Provence Tourisme (myprovence.fr), instantané du ${esc(sc.generatedAt.slice(0, 10))}.
${total} événements sur la période, 40 affichés, ordre chronologique. Chaque lien renvoie vers la fiche canonique myprovence.fr.</p>
<p>Accès machine : <a href="/api/events?month=${esc(today.slice(0, 7))}">/api/events?month=YYYY-MM</a> ·
<a href="/api/events">/api/events?query=…&amp;category=…&amp;town=…</a> ·
<a href="/api/places">/api/places?cluster=hotels&amp;tag=parking</a> ·
<a href="/llms.txt">/llms.txt</a>.
Dans un navigateur compatible WebMCP, la page <a href="/fr">/fr</a> expose en plus 10 outils de site (find_events, filter_places…).</p>
<ol>
${items}
</ol>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
