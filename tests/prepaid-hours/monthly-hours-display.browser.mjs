/** Monthly display contract: real local Auth/RPC, intercepted in-memory projections only. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { status, directory } from './server-local.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = process.env.PREPAID_HOURS_APP_ORIGIN || 'http://127.0.0.1:3198';
assert.equal(origin, 'http://127.0.0.1:3198');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const output = join(process.cwd(), 'docs/prepaid-hours-input'); mkdirSync(join(output, 'captures'), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [], runtimeErrors = [], externalRequests = [], businessWrites = [];
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ');
try {
 for (const variant of ['actual-local-duration', 'exact-minute-projection', 'invalid-projection']) {
  let reads = 0;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(id => { localStorage.setItem('oar.ui-language.v1:anonymous', 'fr'); localStorage.setItem('oar.ui-language.v1:account:' + id, 'fr'); }, fixture.users.owner.id);
  await context.route('**/*', async route => {
   const req = route.request(), url = new URL(req.url());
   if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { externalRequests.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
   if (url.pathname.includes('/rest/v1/') && ['PATCH', 'DELETE'].includes(req.method()) || url.pathname.includes('/rpc/crm_patch_') || url.pathname.includes('/rpc/crm_save_')) businessWrites.push(url.pathname);
   if (url.pathname.endsWith('/rpc/crm_read_monthly_charges')) {
    const actual = await route.fetch(); assert.equal(actual.status(), 200);
    const projection = await actual.json(); reads++;
    const entry = projection.sources.timeEntries.find(row => row.id === 'hours-prepaid-08');
    assert.ok(entry?.prepaid); assert.equal(entry.prepaid.minutes, 120);
    // Select one authorized synthetic source in the display response only.
    projection.sources.timeEntries = [entry]; projection.sources.invoices = [];
    projection.config.personRules = [{ source: 'hours', personId: entry.personId, included: true }];
    if (variant === 'exact-minute-projection') entry.prepaid = { ...entry.prepaid, minutes: 31, coveredMinutes: 31, uncoveredMinutes: 0, coveredCents: 1000, uncoveredCents: 0, amountCents: 1000 };
    if (variant === 'invalid-projection') entry.prepaid = { ...entry.prepaid, coveredMinutes: -1 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projection) });
   }
   return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(18000);
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto(origin + '/charges');
  await page.locator('input[type=email]').fill(fixture.users.owner.email);
  await page.locator('input[autocomplete=current-password]').fill(fixture.users.owner.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('heading', { name: 'Charges mensuelles', exact: true }).waitFor();
  await page.locator('[data-month="2026-10"]').waitFor();
  if (variant === 'invalid-projection') {
   await page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Données à vérifier' }) }).locator('summary').click();
   await page.getByText('Valorisation du forfait indisponible : actualiser les données serveur.', { exact: true }).waitFor();
   assert.equal(await page.locator('article p').filter({ hasText: /^Forfait prépayé ·/ }).count(), 0, 'Invalid projection keeps diagnostic without calling exact formatter');
  } else {
   await page.locator('[data-month="2026-10"] button[aria-expanded]').click();
   const expected = variant === 'actual-local-duration' ? 'Forfait prépayé · 2 h couvertes · 0 h à couvrir' : 'Forfait prépayé · 0 h 31 couvertes · 0 h à couvrir';
   const paragraph = page.locator('article p').filter({ hasText: /^Forfait prépayé ·/ }); await paragraph.waitFor();
   assert.equal(normalize(await paragraph.innerText()), expected);
  }
  assert.ok(reads > 0);
  if (variant === 'exact-minute-projection') await page.screenshot({ path: join(output, 'captures/monthly-exact-minute-fr.png'), fullPage: true });
  results.push({ variant, passed: true, actualLocalRPCReads: reads, databaseWrites: 0 });
  console.log('PASS monthly ' + variant); await context.close();
 }
 assert.deepEqual(runtimeErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(businessWrites, []);
 writeFileSync(join(output, 'monthly-display-results.json'), JSON.stringify({ passed: results.length, results, runtimeErrors, externalRequests, businessWrites, evidence: 'Real disposable local Auth/RPC source reads, then in-memory response projections for display-only contract checks. No persistence claim for projected31minutes/invalidfields; production not exercised.' }, null, 2) + '\n');
} finally { await browser.close(); }
