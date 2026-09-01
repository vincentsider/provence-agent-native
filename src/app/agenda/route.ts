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
    // The FULL window, not a slice: results come back sorted by start date
    // ascending, so any limit here would keep only the OLDEST starters and
    // cut off the truly upcoming events before the partition below runs
    // (the exact bug this comment replaces).
    limit: 5000,
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
<p>Accès machine — exemples RÉELLEMENT paramétrés (un agent qui suit des liens
doit pouvoir cliquer, pas recomposer l'URL ; adaptez les valeurs) :</p>
<ul>
<li><a href="/api/events?month=${esc(today.slice(0, 7))}">/api/events?month=${esc(today.slice(0, 7))}</a> — l'agenda d'un mois</li>
<li><a href="/api/events?query=marche&amp;town=Cassis">/api/events?query=marche&amp;town=Cassis</a> — recherche libre + ville</li>
<li><a href="/api/events?category=festival&amp;town=Marseille&amp;month=${esc(today.slice(0, 7))}">/api/events?category=festival&amp;town=Marseille&amp;month=${esc(today.slice(0, 7))}</a> — catégorie + ville + mois</li>
<li><a href="/api/places?cluster=hotels&amp;town=Cassis&amp;tag=parking">/api/places?cluster=hotels&amp;town=Cassis&amp;tag=parking</a> — hôtels d'une ville, critère parking</li>
<li><a href="/api/places?cluster=campings&amp;tag=animaux-acceptes">/api/places?cluster=campings&amp;tag=animaux-acceptes</a> — campings acceptant les animaux</li>
<li><a href="/api/places?query=piscine+chauffee&amp;minGrade=4">/api/places?query=piscine+chauffee&amp;minGrade=4</a> — texte libre + étoiles minimum</li>
<li><a href="/api/places?cluster=loisirs&amp;town=Marseille">/api/places?cluster=loisirs&amp;town=Marseille</a> — loisirs et activités d'une ville</li>
<li><a href="/api/places?cluster=loisirs&amp;town=Marseille&amp;tag=familles">/api/places?cluster=loisirs&amp;town=Marseille&amp;tag=familles</a> — sorties en famille (tags : familles, parcs-et-loisirs-en-famille)</li>
<li><a href="/api/places?cluster=itineraires&amp;town=Cassis">/api/places?cluster=itineraires&amp;town=Cassis</a> — randonnées et circuits officiels d'une ville</li>
<li><a href="/api/events?month=${esc(today.slice(0, 7))}&amp;limit=100&amp;offset=100">/api/events?month=${esc(today.slice(0, 7))}&amp;limit=100&amp;offset=100</a> — pagination (limit max 100, offset libre)</li>
<li><a href="/llms.txt">/llms.txt</a> — description complète de la surface (paramètres, vocabulaire)</li>
</ul>
<p>Clients MCP (claude.ai connectors, IDE) : POST /api/mcp — endpoint MCP streamable-HTTP
(initialize, tools/list, tools/call) exposant filter_places, find_events, find_near,
find_tonight, explain_vocabulary sur ce même catalogue.</p>
<p>Dans un navigateur compatible WebMCP, la page <a href="/fr">/fr</a> expose en plus 20 outils de site (send_scouts, find_events, filter_places, find_tonight…).</p>
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
