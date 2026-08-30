import { chromium } from '@playwright/test';
import { writeFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';

const LOG = '/private/tmp/claude-501/-Users-vincentsider-Projects-geotravel/42520fec-8eaa-4416-8dd6-0653765ef400/scratchpad/badge-flow.log';
const log = (m) => appendFileSync(LOG, m + '\n');
writeFileSync(LOG, 'start\n');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.setDefaultTimeout(90000);
await page.goto('https://trustwright.deepblocker.ai/badge', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.locator('input#site').fill('https://webmcp.myprovence.fr/fr');
await page.getByRole('button', { name: /verification code/i }).click();
await page.waitForTimeout(4000);
const text = await page.evaluate(() => document.body.innerText);
const code = text.match(/trustwright-verify-[A-Za-z0-9_-]+/)[0];
log('code: ' + code);
writeFileSync('public/.well-known/trustwright-challenge.txt', code);
execSync('vercel deploy --prod --yes', { stdio: 'ignore', timeout: 420000 });
for (let i = 0; i < 40; i++) {
  const live = execSync('curl -s https://webmcp.myprovence.fr/.well-known/trustwright-challenge.txt').toString();
  if (live === code) break;
  await new Promise((r) => setTimeout(r, 4000));
}
log('live file matches');
await page.getByRole('button', { name: /check now/i }).click();
await page.waitForTimeout(6000);
log('ownership: ' + ((await page.evaluate(() => document.body.innerText)).includes('Verified') ? 'VERIFIED' : 'UNKNOWN'));
await page.getByRole('button', { name: /scan my site/i }).click({ timeout: 30000 });
log('scan started');
let last = '';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(10000);
  last = await page.evaluate(() => document.body.innerText);
  const tail = last.slice(last.indexOf('create my badge'));
  if (/score|signed|minted|report|grade|congrat|badge is live|error|fail/i.test(tail)) break;
  if (i % 6 === 0) log('waiting... ' + i * 10 + 's');
}
log('--- FINAL ---');
log(last.slice(0, 6000));
await page.screenshot({ path: '/private/tmp/claude-501/-Users-vincentsider-Projects-geotravel/42520fec-8eaa-4416-8dd6-0653765ef400/scratchpad/badge-scan.png', fullPage: true });
await browser.close();
log('done');
