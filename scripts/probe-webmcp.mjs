import { chromium } from '@playwright/test';

const candidates = [
  ['--enable-features=WebMCPTesting'],
  ['--enable-features=WebMCP'],
  ['--enable-features=WebMCPTesting,WebMCP'],
  ['--enable-blink-features=WebMCP'],
  ['--enable-blink-features=ModelContext'],
];
for (const args of candidates) {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args });
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const probe = await page.evaluate(() => ({
      doc: typeof document.modelContext,
      nav: typeof navigator.modelContext,
      reg: typeof (document.modelContext ?? navigator.modelContext)?.registerTool,
    }));
    console.log(JSON.stringify(args), '->', JSON.stringify(probe));
    if (probe.reg === 'function') break;
  } catch (e) {
    console.log(JSON.stringify(args), '-> ERROR', e.message.split('\n')[0]);
  } finally {
    await browser?.close();
  }
}
