/** Full UI late insertion/deletion -> real local Auth/RPC -> canonical projections.
 * Dedicated fictitious worker; never reads repository .env or production data.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { status, directory, rpc, login, request } from './server-local.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
assert.ok(Object.values(fixture.users).every(user => user.email.endsWith('@example.invalid')));
const origin = 'http://127.0.0.1:3197', workerId = 'worker-cross';
const allowed = async operation => { const result = await operation; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
const token = await login(fixture.users.owner);
let ledger = await allowed(rpc('crm_house_prepaid_state', token));
const existingPackages = ledger.packages.filter(pack => pack.workerId === workerId);
if (!existingPackages.length) {
  ledger = await allowed(rpc('crm_save_house_prepaid', token, { p_revision: ledger.revision, p_request_id: randomUUID(), p_action: 'settings', p_patch: { workerId, billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 } }));
  ledger = await allowed(rpc('crm_save_house_prepaid', token, { p_revision: ledger.revision, p_request_id: randomUUID(), p_action: 'package', p_patch: { workerId, capacityMinutes: 1800, priceCents: 50000, payment: { id: randomUUID(), houseId: 'house-a', date: '2026-10-26', method: 'Virement' } } }));
} else {
  assert.equal(existingPackages.length, 1, 'Only this dedicated correction package may be reused');
  assert.equal(existingPackages[0].capacityMinutes, 1800); assert.equal(existingPackages[0].priceCents, 50000);
}
assert.equal(ledger.summaries.find(summary => summary.workerId === workerId).uncoveredMinutes, 60);
const readPayload = async () => (await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload,updated_at', token)))[0].payload;
// Existing full-workspace normalization represents an absent optional note as
// an empty string. Preserve every substantive source value in this assertion.
const strip = ({ billingMode, prepaid, note, ...source }) => ({ ...source, note: note ?? '' });
const before = await readPayload();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const external = [], errors = [], requests = [], results = [];
await context.addInitScript(id => { localStorage.setItem('oar.ui-language.v1:anonymous', 'fr'); localStorage.setItem('oar.ui-language.v1:account:' + id, 'fr'); }, fixture.users.owner.id);
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
  return route.continue();
});
const page = await context.newPage(); page.setDefaultTimeout(18000);
page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
page.on('request', item => { if (item.url().startsWith(status.API_URL + '/rest/v1/')) requests.push({ url: item.url(), method: item.method() }); });
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ');
const panel = page.locator('[data-prepaid-worker="worker-cross"]');
async function metric(label, value) {
  const found = panel.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
  await found.waitFor();
  for (let attempt = 0; attempt < 150 && normalize(await found.innerText()) !== value; attempt++) await page.waitForTimeout(100);
  assert.equal(normalize(await found.innerText()), value);
}
async function canonicalConsistency() {
  const live = await allowed(rpc('crm_house_prepaid_state', token));
  const payload = await readPayload();
  for (const allocation of live.allocations.filter(item => item.workerId === workerId)) {
    const stored = payload.houseTimeEntries.find(entry => entry.id === allocation.entryId);
    assert.ok(stored?.prepaid);
    for (const key of ['minutes', 'coveredMinutes', 'uncoveredMinutes', 'coveredCents', 'uncoveredCents', 'amountCents']) assert.equal(stored.prepaid[key], allocation[key]);
  }
  return { live, payload };
}
async function dashboardExpected(minutes) {
  const reads = requests.filter(item => item.method === 'GET' && item.url.includes('/crm_workspace_state?')).length;
  await page.locator('[data-navigation-module="dashboard"]:visible').first().click();
  const notification = page.locator('.crm-notification-item').filter({ hasText: 'Traversée fictive' });
  await notification.waitFor();
  assert.match(normalize(await notification.innerText()), minutes === 75 ? /1 h 15 à couvrir/ : /1 h à couvrir/);
  assert.equal(requests.filter(item => item.method === 'GET' && item.url.includes('/crm_workspace_state?')).length, reads, 'Dashboard uses the updated mounted workspace, without a fresh source read');
  await notification.click();
  await page.locator('.house-tracking-view').waitFor();
}
try {
  await page.goto(origin + '/?module=houseTracking');
  await page.locator('input[type=email]').fill(fixture.users.owner.email);
  await page.locator('input[autocomplete=current-password]').fill(fixture.users.owner.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await panel.waitFor(); await metric('Heures réalisées', '31 h'); await metric('Heures à couvrir', '1 h');
  await page.locator('.house-control-card input[type=date]').nth(0).fill('2026-08-01');
  await page.locator('.house-control-card input[type=date]').nth(1).fill('2026-09-30');
  await page.locator('.house-worker-filter select').selectOption(workerId, { force: true });
  await page.locator('.house-tabs').getByRole('button', { name: 'Heures', exact: true }).click();
  const form = page.locator('.house-two-columns > section').first().locator('form');
  await form.locator('input[type=date]').fill('2026-08-31');
  await form.locator('select').nth(0).selectOption('house-a', { force: true });
  await form.locator('select').nth(1).selectOption(workerId, { force: true });
  for (const [name, hour, minute] of [['Heure de début', '08', '00'], ['Heure de fin', '08', '15']]) {
    const clock = form.getByRole('group', { name }); await clock.locator('select').nth(0).selectOption(hour); await clock.locator('select').nth(1).selectOption(minute);
  }
  const created = page.waitForResponse(response => response.url().endsWith('/rpc/crm_create_house_time_entry') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Ajouter les heures', exact: true }).click();
  const response = await created; assert.equal(response.status(), 200); const addedId = response.request().postDataJSON().p_id;
  await metric('Heures réalisées', '31,25 h'); await metric('Heures à couvrir', '1,25 h');
  let checked = await canonicalConsistency();
  assert.equal(checked.payload.houseTimeEntries.find(entry => entry.id === addedId).prepaid.minutes, 15);
  assert.equal(checked.payload.houseTimeEntries.find(entry => entry.id === 'hours-cross-2').prepaid.uncoveredMinutes, 75);
  await dashboardExpected(75);
  results.push({ name: 'late15minute UI insertion refreshes all canonical allocations and mounted dashboard without source reload', passed: true });
  console.log('PASS late15minute UI insertion, raw persistence and mounted dashboard');

  await page.locator('.house-tabs').getByRole('button', { name: 'Heures', exact: true }).click();
  const row = page.locator('[id="house-time-' + addedId + '"]'); await row.waitFor();
  const deleted = page.waitForResponse(item => item.url().includes('/rest/v1/crm_workspace_state?') && item.request().method() === 'PATCH');
  await row.getByRole('button', { name: 'Suppr.', exact: true }).click();
  assert.equal((await deleted).status(), 200);
  await metric('Heures réalisées', '31 h'); await metric('Heures à couvrir', '1 h');
  checked = await canonicalConsistency();
  assert.equal(checked.payload.houseTimeEntries.some(entry => entry.id === addedId), false);
  assert.equal(checked.payload.houseTimeEntries.find(entry => entry.id === 'hours-cross-2').prepaid.uncoveredMinutes, 60);
  await dashboardExpected(60);
  assert.deepEqual(checked.payload.houseTimeEntries.filter(entry => entry.workerId === workerId).map(strip), before.houseTimeEntries.filter(entry => entry.workerId === workerId).map(strip), 'Original intervention IDs/times/rates remain unchanged');
  assert.equal(checked.live.packages.filter(pack => pack.workerId === workerId).length, 1);
  results.push({ name: 'UI deletion through generic autosave restores canonical allocations and mounted dashboard without source reload', passed: true });
  console.log('PASS UI deletion, raw persistence and mounted dashboard');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  writeFileSync(join(process.cwd(), 'docs/prepaid-hours/browser-corrections-results.json'), JSON.stringify({ passed: results.length, results, runtimeErrors: errors, externalRequests: external, evidence: 'Fictitious sources; actual local Auth/RPC, full production build UI; no production access' }, null, 2));
} finally { await context.close(); await browser.close(); }
