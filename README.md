# provence-agent-native

An agent-native surface over the five `/les-guides` clusters of
[myprovence.fr](https://www.myprovence.fr): the same catalogue a human
browses, exposed to AI agents as nine [WebMCP](https://webmachinelearning.github.io/webmcp/)
site tools, with a live **Demand Mirror** showing what agents asked for and
what the catalogue could not answer.

## Why

Measured live on 26-27 August 2026, as an agent fetches (one GET, no
JavaScript):

- The five clusters publish **2 798 places**. An agent reaches **200** (7.1%).
- Pagination is a JavaScript `<button>`; there is no `<a rel="next">` anywhere.
  Worse, the pagination windows are **non-deterministic**: twelve `?pg=N`
  requests for 463 hotels return only 311 unique records.
- All **1 925 facet links** carry `rel="nofollow"` — and the facets hold
  exactly what AI-referred visitors ask for (parking: 419 hotels, animaux
  acceptés: 339, climatisation: 405).
- Facet values are opaque ids (`maptags:469` means parking; nothing says so).
- Zero JSON-LD on any cluster page. The detail pages are fine.

The records are readable; the index over them is not. This project is the
index: `filter_places` answers "hôtels avec parking qui acceptent les chiens"
in one call, on the page, while the visitor watches the map move.

## The nine tools

| Tool | readOnly | What it does |
|---|---|---|
| `filter_places` | yes | Any facet combination across the full catalogue |
| `explain_vocabulary` | yes | The tag table: 469 is knowably `parking` |
| `get_place` | yes | One record by id or canonical URL |
| `compare_places` | yes | 2-5 records on a shared attribute matrix |
| `find_near` | yes | Radius search around a town or point |
| `get_catalog_stats` | yes | Coverage: totals, tags, gaps |
| `set_view` | no* | Steers the shared map (this tab only) |
| `highlight_places` | no* | Marks results on the shared map (this tab only) |
| `get_agent_demand` | yes | The Demand Mirror, readable by the agent itself |

\* mutates nothing outside the browser tab.

## Run it

```bash
npm ci --ignore-scripts
npm run ingest            # hub pages + sitemap (~2 min, crawl-delay honoured)
npm run ingest:enrich     # + one fetch per detail page (~50 min, resumable)
npm run build && npm start   # http://localhost:3040/fr
```

To see the tools: Chrome 146+ with `chrome://flags/#enable-webmcp-testing`
enabled (origin trial from Chrome 149), or ChatGPT's desktop browser with
Site tools. The [Model Context Tool Inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)
extension lets you invoke tools by hand.

Without WebMCP the page is a complete, accessible catalogue browser — that is
a hard requirement, not a fallback.

## Design decisions worth knowing

- **One store, two consumers.** The React view and the WebMCP tools consume
  the same state; "the human and the agent see the same thing" is true by
  construction. The E2E suite asserts that a tool call moves the human's map.
- **Tools register before the data loads.** An agent that lands and calls
  `getTools()` immediately sees all nine; each `execute` awaits the catalogue
  internally. Registration never waits on the network.
- **The catalogue is not in this repository.** It is built by `npm run ingest`
  (or CI) and served from `DATA_URL`. The content belongs to Provence
  Tourisme and originates in the Apidae network; every tool result carries the
  canonical `myprovence.fr` URL, and the page links back to the source.
- **Security posture.** Every tool input schema is Zod `.strict()` with the
  JSON Schema derived from it; free text is sanitised at build time (HTML,
  bidi overrides, zero-width characters stripped; instruction-shaped patterns
  fail the build until reviewed), labelled `untrustedContentHint`, and wrapped
  in an envelope naming it untrusted data. No tool accepts a URL, path,
  selector or template. No writes: nothing an agent can do changes any state
  outside the visitor's own tab.
- **Privacy.** No cookies, no localStorage, no analytics. The Demand Mirror
  is session-scoped. The optional `/api/demand` aggregate receives counters
  only; the client IP is used for rate limiting and never stored.

## Repository layout

```
ingest/      catalogue build: fetch (SSRF-guarded, cached), parse, sanitise,
             vocabulary + alias resolution, budgets, manifest
src/lib/     types, pure query engine (inverted index, geo grid), store,
             demand telemetry, result envelope
src/webmcp/  zod input schemas, the nine tool definitions, ambient types
src/components/  the human surface (list, facets, Leaflet map, Demand Mirror)
src/app/     Next.js app router (fr/en), /api/demand
tests/       engine-vs-reference (1000 randomised queries), sanitiser
             injection corpus, schema fuzzing, parsers
e2e/         Playwright: human surface without WebMCP; tool contract with it
```

## Provenance and licence

Code: MIT (see LICENSE). Catalogue content: © Provence Tourisme /
myprovence.fr, via the Apidae network, snapshot date shown in the page
footer; used for demonstration with permission, every record linking back to
its canonical page. This site is `noindex` everywhere: it demonstrates an
agent-native pattern, it does not compete with the source.

Built by [GeoTravel.ai](https://geotravel.ai) (GetInference Ltd).
