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

  test('a human filter updates the result count', async ({ page }) => {
    await page.goto('/fr');
    await page.getByRole('button', { name: 'Hôtels' }).click();
    await expect(page.getByTestId('result-count')).not.toHaveText(/^Aucun/);
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
        return (await mc.getTools()).length >= 9;
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
    // And the Demand Mirror recorded it.
    await expect(page.getByTestId('mirror-entries')).toContainText('filter_places');
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
