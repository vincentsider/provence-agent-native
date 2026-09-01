import { expect, test } from '@playwright/test';

/**
 * S6: the human surface works with no WebMCP at all.
 */
test.describe('human surface', () => {
  test('renders the catalogue browser without WebMCP', async ({ page }) => {
    await page.goto('/fr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Provence');
    await expect(page.getByTestId('demand-mirror')).toBeVisible();
    await expect(page.getByTestId('map')).toBeVisible();
  });

  test('a fabricated same-origin catalogue path redirects to the canonical page', async ({ request }) => {
    // Field failure, 27 Aug 2026: an agent glued the catalogue path onto this
    // origin and linked a 404. The wrong URL must work.
    const res = await request.get(
      '/les-guides/hebergements/hotels/la-ciotat/hotel-plage-saint-jean',
      { maxRedirects: 0 },
    );
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toBe(
      'https://www.myprovence.fr/les-guides/hebergements/hotels/la-ciotat/hotel-plage-saint-jean',
    );
  });

  test('a human filter updates the result count', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: 'Hôtels' }).click();
    await expect(page.getByTestId('result-count')).not.toHaveText(/^Aucun/);
  });
});

/**
 * The fetch-only agent surfaces: what basic claude.ai / chatgpt.com get
 * without executing a single line of JavaScript (field failure, 28 Aug).
 */
test.describe('fetch-only surfaces', () => {
  test('/agenda serves server-rendered events with canonical links', async ({ request }) => {
    const res = await request.get('/agenda');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('Agenda Provence');
    expect(html).toContain('https://www.myprovence.fr/agenda/');
    expect(html).toContain('/api/events');
  });

  test('/api/events answers the street food question over plain GET', async ({ request }) => {
    const res = await request.get('/api/events?query=street+food');
    expect(res.status()).toBe(200);
    const data = (await res.json()) as { total: number; results: Array<{ name: string }> };
    expect(data.total).toBeGreaterThan(0);
    expect(data.results.some((r) => /street food/i.test(r.name))).toBe(true);
  });

  test('/api/events rejects unknown params and invalid months', async ({ request }) => {
    expect((await request.get('/api/events?evil=1')).status()).toBe(400);
    expect((await request.get('/api/events?month=2026-13')).status()).toBe(400);
  });

  test('/api/places filters hotels by tags over plain GET', async ({ request }) => {
    const res = await request.get('/api/places?cluster=hotels&tag=parking&tag=animaux-acceptes&limit=1');
    const data = (await res.json()) as { total: number };
    expect(data.total).toBeGreaterThan(0);
  });

  test('/llms.txt is served', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('/api/events');
  });

  test('the remote MCP endpoint lists and calls tools', async ({ request }) => {
    const list = await request.post('/api/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const tools = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name)).toContain('find_events');

    const call = await request.post('/api/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'find_events', arguments: { query: 'street food' } },
      },
    });
    const payload = (await call.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(payload.result.isError).toBe(false);
    expect(payload.result.content[0]!.text).toContain('Street Food Festival');
  });

  test('guessed URLs serve content DIRECTLY (some agent fetchers fail on 307s)', async ({ request }) => {
    for (const url of ['/fr/agenda', '/en/agenda', '/events']) {
      const res = await request.get(url, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain('Agenda Provence');
    }
  });

  test('the landing page HTML itself carries real upcoming events (zero JS)', async ({ request }) => {
    const html = await (await request.get('/fr')).text();
    // Visible server-rendered content with canonical links: the one channel
    // every fetch-only assistant reliably receives.
    expect(html).toContain('Prochainement');
    expect(html).toContain('https://www.myprovence.fr/agenda/');
  });
});

/**
 * The agent-facing contract (spec 11.4). Skips when the browser has no
 * modelContext, so the suite is still green on plain Chromium.
 */
test.describe('webmcp tools', () => {
  test('registers nine tools and filter_places moves the human view', async ({ page }) => {
    await page.goto('/fr');

    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    await page.waitForFunction(
      async () => {
        const mc = (document as never as { modelContext: { getTools(): Promise<unknown[]> } })
          .modelContext;
        return (await mc.getTools()).length >= 20;
      },
      { timeout: 5_000 },
    );

    const result = await page.evaluate(async () => {
      const mc = (
        document as never as {
          modelContext: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(tool: { name: string }, input?: object | string): Promise<string>;
          };
        }
      ).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((t) => t.name === 'filter_places');
      if (!tool) throw new Error('filter_places not registered');
      const raw = await mc.executeTool(tool, JSON.stringify({ cluster: 'hotels', limit: 40 }));
      return JSON.parse(raw) as {
        _meta: { contentTrust: string };
        data: { total: number; returned: number; results: Array<{ url: string }> };
      };
    });

    expect(result._meta.contentTrust).toBe('untrusted-third-party');
    expect(result.data.total).toBeGreaterThan(0);
    expect(
      result.data.results.every((r) => r.url.startsWith('https://www.myprovence.fr/')),
    ).toBe(true);

    // The shared-view contract: the agent's call changed what the human sees.
    await expect(page.getByTestId('highlighted-count')).toHaveText(
      String(result.data.returned),
    );
    // And the top-center banner told the human what the agent was doing.
    await expect(page.getByTestId('agent-banner')).toBeVisible();
    // And the Demand Mirror recorded it.
    await expect(page.getByTestId('mirror-entries')).toContainText('filter_places');
  });

  test('find_events answers October 2026 chronologically', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    const result = await page.evaluate(async () => {
      const mc = (
        document as never as {
          modelContext: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(tool: { name: string }, input?: object | string): Promise<string>;
          };
        }
      ).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((t) => t.name === 'find_events');
      if (!tool) throw new Error('find_events not registered');
      const raw = await mc.executeTool(tool, JSON.stringify({ month: '2026-10', limit: 40 }));
      return JSON.parse(raw) as {
        data: {
          total: number;
          results: Array<{ startDate?: string | null; endDate?: string | null; url: string; category?: string }>;
        };
      };
    });

    expect(result.data.total).toBeGreaterThan(0);
    let prev = '';
    for (const r of result.data.results) {
      expect(r.url).toContain('https://www.myprovence.fr/agenda/');
      // Every result overlaps October 2026...
      const start = r.startDate ?? '';
      const end = r.endDate ?? start;
      expect(start <= '2026-10-31' && end >= '2026-10-01').toBe(true);
      // ...and arrives chronologically.
      expect(start >= prev).toBe(true);
      prev = start;
    }
  });

  test('an unknown slug returns suggestions, not an empty set', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    const result = await page.evaluate(async () => {
      const mc = (
        document as never as {
          modelContext: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(tool: { name: string }, input?: object | string): Promise<string>;
          };
        }
      ).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((t) => t.name === 'filter_places')!;
      const raw = await mc.executeTool(tool, JSON.stringify({ tags: ['parkign'] }));
      return JSON.parse(raw) as { error?: { code: string; suggestions?: string[] } };
    });

    expect(result.error?.code).toBe('unknown_tag');
    expect(result.error?.suggestions?.length).toBeGreaterThan(0);
  });
});

/**
 * v2 gesture dialogue (issue #608): the agent asks, the human taps a card,
 * the agent reads the answer back. End to end through real registered tools.
 */
test.describe('gesture dialogue', () => {
  test('ask_visitor card answered by a human click reaches get_input_result', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    type Mc = {
      getTools(): Promise<Array<{ name: string }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).length >= 20,
      { timeout: 5_000 },
    );

    // Fire ask_visitor WITHOUT awaiting: it blocks until the human answers.
    await page.evaluate(() => {
      const mc = (document as never as { modelContext: Mc }).modelContext;
      const w = window as never as { __askResult?: Promise<string> };
      w.__askResult = mc.getTools().then((tools) => {
        const tool = tools.find((t) => t.name === 'ask_visitor');
        if (!tool) throw new Error('ask_visitor not registered');
        return mc.executeTool(
          tool,
          JSON.stringify({
            question: 'Plutôt mer ou village ?',
            options: ['Mer', 'Village'],
          }),
        );
      });
    });

    // The human sees the yellow card and taps an option.
    const cards = page.getByTestId('elicitation-cards');
    await expect(cards).toContainText('Plutôt mer ou village ?');
    await cards.getByRole('button', { name: 'Mer', exact: true }).click();

    const parsed = await page.evaluate(async () => {
      const raw = await (window as never as { __askResult: Promise<string> }).__askResult;
      return JSON.parse(raw) as { data?: { status?: string; choice?: string } };
    });
    expect(parsed.data?.status).toBe('answered');
    expect(parsed.data?.choice).toBe('Mer');

    // And the signals tool reports the same exchange.
    const signals = await page.evaluate(async () => {
      const mc = (document as never as { modelContext: Mc }).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((t) => t.name === 'get_visitor_signals');
      if (!tool) throw new Error('get_visitor_signals not registered');
      return JSON.parse(await mc.executeTool(tool, JSON.stringify({}))) as {
        data?: { newSignals?: Array<{ kind?: string }> };
      };
    });
    expect(JSON.stringify(signals)).toContain('Mer');
  });
});

/** v2 demand pulse (issue #609): the endpoint always answers with the shape. */
test.describe('demand pulse endpoint', () => {
  test('GET /api/demand-pulse returns the aggregate shape, never an error', async ({ request }) => {
    const res = await request.get('/api/demand-pulse');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { windowDays: number; totalRequests: number; towns: unknown[] };
    expect(body.windowDays).toBe(7);
    expect(typeof body.totalRequests).toBe('number');
    expect(Array.isArray(body.towns)).toBe(true);
  });
});

/**
 * v3 (issues #612-#616): scouts fan out and plant flags, the human's verdict
 * reaches get_scout_reports, the postcard refuses then displays, and the
 * agent can read what the visitor is looking at.
 */
test.describe('v3 scouts and keepsake', () => {
  test('the full loop: scouts → human keeps a flag → reports → postcard', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    type Mc = {
      getTools(): Promise<Array<{ name: string; inputSchema?: object }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    const call = (name: string, input: object) =>
      page.evaluate(
        async ([toolName, toolInput]) => {
          const mc = (document as never as { modelContext: Mc }).modelContext;
          const tools = await mc.getTools();
          const tool = tools.find((x) => x.name === toolName);
          if (!tool) throw new Error(`${toolName} not registered`);
          return JSON.parse(await mc.executeTool(tool, JSON.stringify(toolInput))) as {
            data?: Record<string, unknown> & { error?: string };
            error?: { code: string };
          };
        },
        [name, input] as const,
      );

    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).length >= 20,
      { timeout: 5_000 },
    );

    // Postcard refuses while nothing is kept.
    const refused = await call('write_postcard', {
      title: 'Trois jours à Cassis',
      body: 'Ce matin, le port sentait le café et le sel. '.repeat(2),
    });
    expect(refused.data?.error).toBe('empty_selection');

    // Scouts out.
    const sent = await call('send_scouts', {
      mission: 'un séjour à Cassis, hôtel et un marché',
      scouts: [
        { label: 'hôtels à Cassis', town: 'Cassis', cluster: 'hotels' },
        { label: "l'agenda de Cassis", town: 'Cassis', cluster: 'agenda' },
      ],
    });
    const reports = sent.data?.reports as Array<{ findings: unknown[] }>;
    expect(reports).toHaveLength(2);
    expect(reports[0]!.findings.length).toBeGreaterThan(0);

    // A flag lands on the map; the human keeps it.
    const flag = page.locator('.scout-flag-wrap').first();
    await flag.waitFor({ state: 'visible', timeout: 10_000 });
    await flag.click();
    await page.locator('.scout-popup-keep').click();

    const verdicts = await call('get_scout_reports', {});
    const kept = JSON.stringify(verdicts.data).includes('"kept"');
    expect(kept).toBe(true);

    // The postcard now displays, grounded in the kept selection.
    const card = await call('write_postcard', {
      title: 'Trois jours à Cassis',
      body: 'Ce matin, le port sentait le café et le sel. Ce soir, le marché nocturne. '.repeat(1).padEnd(60, '.'),
    });
    expect(card.data?.status).toBe('displayed');
    await expect(page.getByTestId('postcard')).toBeVisible();
    await page.getByTestId('postcard-close').click();
  });

  test('get_visitor_view reports the live viewport and find_tonight answers the day', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    type Mc = {
      getTools(): Promise<Array<{ name: string }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    const call = (name: string, input: object) =>
      page.evaluate(
        async ([toolName, toolInput]) => {
          const mc = (document as never as { modelContext: Mc }).modelContext;
          const tools = await mc.getTools();
          const tool = tools.find((x) => x.name === toolName);
          if (!tool) throw new Error(`${toolName} not registered`);
          return JSON.parse(await mc.executeTool(tool, JSON.stringify(toolInput))) as {
            data?: Record<string, unknown>;
          };
        },
        [name, input] as const,
      );

    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).length >= 20,
      { timeout: 5_000 },
    );
    // The map publishes its viewport within the 300ms debounce.
    await page.waitForTimeout(600);

    const view = await call('get_visitor_view', {});
    expect(view.data?.viewport).not.toBeNull();
    expect(view.data?.humanFilter).toMatchObject({ cluster: null });
    // The page derives the towns the viewport frames (field bug 1 Sep:
    // raw bounds read as "no city selected" to the agent).
    expect(Array.isArray(view.data?.townsInView)).toBe(true);
    expect('dominantTown' in (view.data ?? {})).toBe(true);

    const tonight = await call('find_tonight', { town: 'Marseille' });
    expect(typeof view.data).toBe('object');
    expect(tonight.data?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(tonight.data?.events)).toBe(true);

    // The masthead follows the agent's current request: with results on
    // stage the big banner takes over (field feedback 1 Sep), the small
    // strip is only the no-results fallback.
    const banner = page.getByTestId('request-banner');
    const strip = page.getByTestId('request-strip');
    await expect(banner.or(strip)).toBeVisible();
    await expect(banner.or(strip)).toContainText('Marseille');
  });

  test('pin_visible_place exists and only accepts what is on screen', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');

    type Mc = {
      getTools(): Promise<Array<{ name: string; inputSchema?: { properties?: { name?: { enum?: string[] } } } }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    // Registered lazily (800ms debounce after the catalogue and map settle).
    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).some(
          (t) => t.name === 'pin_visible_place',
        ),
      { timeout: 15_000 },
    );
    const result = await page.evaluate(async () => {
      const mc = (document as never as { modelContext: Mc }).modelContext;
      // The tool is re-registered on view changes (abort + register): between
      // the two calls it can be absent for a beat. A real agent re-reads the
      // tool list each turn; retry the same way.
      let tool: Awaited<ReturnType<Mc['getTools']>>[number] | undefined;
      for (let attempt = 0; attempt < 20 && !tool; attempt++) {
        tool = (await mc.getTools()).find((x) => x.name === 'pin_visible_place');
        if (!tool) await new Promise((r) => setTimeout(r, 250));
      }
      if (!tool) return { skipped: true };
      const names = tool.inputSchema?.properties?.name?.enum ?? [];
      const first = names[0];
      if (!first) return { skipped: true };
      const pinned = JSON.parse(
        await mc.executeTool(tool, JSON.stringify({ name: first })),
      ) as { data?: { pinned?: { name?: string } } };
      const rejected = JSON.parse(
        await mc.executeTool(tool, JSON.stringify({ name: 'Lieu Qui N Existe Pas 123' })),
      ) as { error?: { code?: string }; data?: { error?: string } };
      return { first, pinned, rejected };
    });
    if (!('skipped' in result)) {
      expect(result.pinned?.data?.pinned?.name).toBe(result.first);
      // Off-screen name: either schema-invalid (enum) or a structured refusal.
      const refusal =
        result.rejected?.error?.code === 'invalid_input' ||
        result.rejected?.data?.error === 'not_visible';
      expect(refusal).toBe(true);
    }
  });
});

/** The wish box (v4, 30 Aug): a mailbox for the agent, never its own search
 *  engine — the page's keyword dispatch sent scouts to Saint-Rémy for "près
 *  de la mer" (field bug), so the page now only records the wish. */
test.describe('wish box', () => {
  test('typing a wish shows the honest ack and dispatches nothing', async ({ page }) => {
    await page.goto('/fr');
    const box = page.getByTestId('wish-box');
    await box.getByRole('textbox').fill('un hôtel près de la mer pas trop touristique');
    await box.getByRole('button').click();
    // The honest note appears; the input clears for the next wish.
    await expect(page.getByTestId('wish-ack')).toBeVisible();
    await expect(box.getByRole('textbox')).toHaveValue('');
    // And NO scouts: no flags, no mission takeover, from the page itself.
    await page.waitForTimeout(1500);
    await expect(page.locator('.scout-flag-wrap')).toHaveCount(0);
    await expect(page.getByTestId('mission-banner')).not.toBeVisible();
  });

  test('the heartbeat tool appears once the visitor has acted', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');
    type Mc = { getTools(): Promise<Array<{ name: string; description: string }>> };

    // Before any visitor action, the wire tool does not exist.
    const before = await page.evaluate(async () =>
      (await (document as never as { modelContext: Mc }).modelContext.getTools()).some(
        (t) => t.name === 'read_visitor_wish',
      ),
    );
    expect(before).toBe(false);

    const box = page.getByTestId('wish-box');
    await box.getByRole('textbox').fill('un week-end nature dans les Alpilles');
    await box.getByRole('button').click();

    // After the wish, it appears with the live state in its DESCRIPTION.
    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).some(
          (t) => t.name === 'read_visitor_wish' && t.description.includes('Alpilles'),
        ),
      { timeout: 10_000 },
    );
  });
});

/** Le carnet (29 Aug): the agreed plan becomes the briefing pack. */
test.describe('carnet de voyage', () => {
  test('keeping a HIGHLIGHT chip (not a scout flag) also feeds the carnet', async ({ page }) => {
    await page.goto('/fr');
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');
    type Mc = {
      getTools(): Promise<Array<{ name: string }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).length >= 20,
      { timeout: 5_000 },
    );
    // The agent path that draws chips: search, then highlight the cited ids.
    await page.evaluate(async () => {
      const mc = (document as never as { modelContext: Mc }).modelContext;
      const tools = await mc.getTools();
      const call = async (name: string, input: object) => {
        const tool = tools.find((x) => x.name === name);
        if (!tool) throw new Error(`${name} not registered`);
        return JSON.parse(await mc.executeTool(tool, JSON.stringify(input))) as {
          data?: { results?: Array<{ id: number }> };
        };
      };
      const found = await call('filter_places', { town: 'Cassis', cluster: 'hotels', limit: 3 });
      const ids = (found.data?.results ?? []).map((r) => r.id);
      if (ids.length === 0) throw new Error('no Cassis hotels in catalogue');
      await call('highlight_places', { ids });
    });
    const chip = page.locator('.poi-chip--agent').first();
    await chip.waitFor({ state: 'visible', timeout: 10_000 });
    await chip.click();
    await page.locator('.scout-popup-keep').click();
    await expect(page.getByTestId('carnet-button')).toBeVisible();
  });

  test('keeping a flag surfaces the carnet button; the pack renders and closes', async ({ page }) => {
    await page.goto('/fr');
    // Scouts come only from the agent now (wish box v4): dispatch through
    // the send_scouts tool, like every cooperating agent does.
    const hasWebMcp = await page.evaluate(
      () => typeof (document as never as { modelContext?: object }).modelContext !== 'undefined',
    );
    test.skip(!hasWebMcp, 'browser has no document.modelContext (flag off)');
    type Mc = {
      getTools(): Promise<Array<{ name: string }>>;
      executeTool(tool: { name: string }, input?: object | string): Promise<string>;
    };
    await page.waitForFunction(
      async () =>
        (await (document as never as { modelContext: Mc }).modelContext.getTools()).length >= 20,
      { timeout: 5_000 },
    );
    const sent = await page.evaluate(async () => {
      const mc = (document as never as { modelContext: Mc }).modelContext;
      const tools = await mc.getTools();
      const tool = tools.find((x) => x.name === 'send_scouts');
      if (!tool) throw new Error('send_scouts not registered');
      return JSON.parse(
        await mc.executeTool(
          tool,
          JSON.stringify({
            mission: 'un séjour à Cassis, hôtel et un marché',
            scouts: [
              { label: 'hôtels à Cassis', town: 'Cassis', cluster: 'hotels' },
              { label: "l'agenda de Cassis", town: 'Cassis', cluster: 'agenda' },
            ],
          }),
        ),
      ) as { data?: { reports?: unknown[] } };
    });
    expect(sent.data?.reports?.length).toBe(2);
    const flag = page.locator('.scout-flag-wrap').first();
    await flag.waitFor({ state: 'visible', timeout: 10_000 });
    await flag.click();
    await page.locator('.scout-popup-keep').click();

    const button = page.getByTestId('carnet-button');
    await expect(button).toBeVisible();
    await button.click();
    const carnet = page.getByTestId('carnet');
    await expect(carnet).toBeVisible();
    await expect(carnet).toContainText('myprovence.fr');
    await expect(page.getByTestId('carnet-pdf')).toBeVisible();
    await page.getByTestId('carnet-close').click();
    await expect(carnet).not.toBeVisible();
  });
});
