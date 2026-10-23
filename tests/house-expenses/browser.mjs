/** Integrated UI against disposable Supabase Auth/PostgreSQL/PostgREST.
 * All business writes are real local RPCs except explicitly aborted requests
 * that exercises network failure. No remote environment or app stubs are read.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { assertHouseExpensesLocalTarget } from './server-local-target.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const statusFile = process.env.HOUSE_EXPENSES_STATUS_FILE;
assert.ok(statusFile, 'Explicit disposable status required');
const status = JSON.parse(readFileSync(statusFile, 'utf8'));
const origin = 'http://127.0.0.1:3184';
assertHouseExpensesLocalTarget({ api: status.API_URL, database: status.DB_URL, app: origin, mail: 'http://127.0.0.1:56134', acknowledgement: process.env.IZORD_TEST_ACK });
const fixture = JSON.parse(readFileSync(join(dirname(statusFile), 'fixtures.private.json'), 'utf8'));
const output = process.env.HOUSE_EXPENSES_BROWSER_OUTPUT || join(dirname(statusFile), 'browser');
mkdirSync(output, { recursive: true });
const phase = process.env.HOUSE_EXPENSES_BROWSER_PHASE || 'full';
assert.ok(['full', 'mobile'].includes(phase));
const checks = [], errors = [], external = [], writes = [];
const check = async (name, run) => { await run(); checks.push(name); writeFileSync(join(output, 'progress-' + phase + '.json'), JSON.stringify({ checks }, null, 2)); console.log('PASS ' + name); };
async function projection() {
  const response = await fetch(status.API_URL + '/rest/v1/rpc/crm_read_module', { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + fixture.users.owner.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_module: 'houseTracking' }) });
  assert.equal(response.status, 200);
  return (await response.json()).collections;
}
function entryInvariant(before, after) {
  for (const key of ['id', 'houseId', 'houseName', 'workerId', 'workerName', 'date', 'startTime', 'endTime', 'breakMinutes', 'hourlyRate', 'note', 'createdAt', 'createdBy']) assert.deepEqual(after[key], before[key], key + ' preserved');
}
async function language(page, lang) {
  if (await page.locator('html').getAttribute('lang') === (lang === 'en' ? 'en-GB' : 'fr')) return;
  let mobile = false;
  if (!await page.locator('[data-language-selector]:visible').count()) { mobile = true; await page.locator('#unified-more-trigger').click(); }
  await page.locator('[data-language-selector]:visible').getByRole('button', { name: lang === 'en' ? 'English — EN' : 'Français — FR', exact: true }).click();
  await page.waitForFunction(lang => document.documentElement.lang === lang, lang === 'en' ? 'en-GB' : 'fr');
  if (mobile) await page.locator('.unified-more-close').click();
}
async function hours(page) {
  await page.locator('.house-tracking-view').waitFor();
  await page.locator('.house-tabs').getByRole('button', { name: /^(Heures|Hours)$/ }).click();
  await page.locator('.house-two-columns form').first().waitFor();
}
async function mainWorker(page) {
  await page.locator('.house-worker-filter-scroll').getByRole('button', { name: 'Intervenant frais fictif', exact: true }).click();
}
const creation = page => page.locator('.house-two-columns > section').first().locator('form');
async function prepareCreation(page) {
  const form = creation(page);
  await form.locator('select').nth(0).selectOption('expense-house');
  await form.locator('select').nth(1).selectOption('expense-worker');
  await form.locator('select').nth(2).selectOption('09:00');
  await form.locator('select').nth(3).selectOption('13:00');
  await form.locator('input[type=text][inputmode=decimal]').first().fill('25');
  return form;
}
const row = (page, id = 'expense-main') => page.locator('#house-time-' + id);
const editor = page => page.locator('.house-time-history-item > section');
async function openEditor(page, id = 'expense-main') {
  await row(page, id).getByRole('button', { name: /^(Modifier les frais|Edit expenses)$/ }).click();
  await editor(page).waitFor();
  return editor(page);
}
async function saveEditor(page, amount, reason) {
  const panel = editor(page);
  await panel.locator('[name=expenseAmount]').fill(amount);
  if (reason !== undefined) await panel.locator('[name=expenseNote]').fill(reason);
  const response = page.waitForResponse(response => response.url().endsWith('/rpc/crm_update_house_time_expenses') && response.request().method() === 'POST');
  await panel.locator('button[type=submit]').click();
  assert.equal((await response).status(), 200);
  await panel.waitFor({ state: 'detached' });
}
async function reloadHours(page) {
  await page.reload(); await hours(page); await mainWorker(page);
}
async function noOverflow(page, name) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(metrics.scrollWidth <= metrics.width + 1, name + ': document must fit viewport ' + JSON.stringify(metrics));
}
async function start(browser, user, width) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => { if (request.method() === 'POST' && /\/rpc\/(crm_update_house_time_expenses|crm_create_house_time_entry|crm_mutate_record)$/.test(request.url())) writes.push(new URL(request.url()).pathname); });
  await page.goto(origin + '/?module=houseTracking');
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[autocomplete=current-password]').fill(user.password);
  await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
  await hours(page); await mainWorker(page);
  return { context, page };
}
if (phase !== 'mobile') {
const desktop = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const { context, page } = await start(desktop, fixture.users.owner, 1440);
  try {
    const baseline = await projection();
    const original = baseline.houseTimeEntries.find(entry => entry.id === 'expense-main');
    await check('Owner: real RPC saves comma expenses and reason; reload retains 148.60 due / 98.60 balance', async () => {
      await openEditor(page); await saveEditor(page, '48,60', 'Frais kilométriques fictifs Port Grimaud');
      await reloadHours(page);
      const stored = await projection(), actual = stored.houseTimeEntries.find(entry => entry.id === original.id);
      assert.equal(actual.expenseAmount, 48.6); assert.equal(actual.expenseNote, 'Frais kilométriques fictifs Port Grimaud');
      entryInvariant(original, actual); assert.deepEqual(stored.housePayments, baseline.housePayments);
      assert.equal(stored.houseTimeEntries.length, baseline.houseTimeEntries.length);
      const text = (await row(page).innerText()).replace(/[\u00a0\u202f]/g, ' ');
      for (const amount of ['100,00', '48,60', '148,60']) assert.ok(text.includes(amount), amount + ' displayed');
      assert.ok((await page.locator('.house-summary-grid').innerText()).replace(/[\u00a0\u202f]/g, ' ').includes('98,60'));
      await noOverflow(page, '1440px owner history');
      await page.locator('.house-tracking-view').screenshot({ path: join(output, 'owner-desktop-history.png') });
    });
    await check('Owner: invalid negative / excessive decimals stay in editor without an RPC; blank resets to historical 100', async () => {
      await openEditor(page);
      for (const invalid of ['-1', '1.234', 'abc']) {
        const count = writes.length;
        await editor(page).locator('[name=expenseAmount]').fill(invalid);
        await editor(page).locator('button[type=submit]').click();
        await editor(page).getByRole('alert').waitFor();
        assert.equal(await editor(page).locator('[name=expenseAmount]').inputValue(), invalid);
        assert.equal(writes.length, count);
      }
      await saveEditor(page, '', '');
      await reloadHours(page);
      const stored = (await projection()).houseTimeEntries.find(entry => entry.id === original.id);
      assert.equal(stored.expenseAmount, 0); assert.equal(stored.expenseNote, ''); entryInvariant(original, stored);
      assert.ok((await row(page).innerText()).includes('100,00'));
    });
    await check('Owner: simulated failed request retains amount/reason; real retry then persists', async () => {
      await openEditor(page);
      await editor(page).locator('[name=expenseAmount]').fill('48.60');
      await editor(page).locator('[name=expenseNote]').fill('Brouillon conservé après échec fictif');
      const url = status.API_URL + '/rest/v1/rpc/crm_update_house_time_expenses';
      await page.route(url, route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
      await editor(page).locator('button[type=submit]').click();
      await editor(page).getByRole('alert').waitFor();
      assert.equal(await editor(page).locator('[name=expenseAmount]').inputValue(), '48.60');
      assert.equal(await editor(page).locator('[name=expenseNote]').inputValue(), 'Brouillon conservé après échec fictif');
      assert.equal((await projection()).houseTimeEntries.find(entry => entry.id === original.id).expenseAmount, 0);
      await page.unroute(url); await saveEditor(page, '48.60'); await reloadHours(page);
      assert.equal((await projection()).houseTimeEntries.find(entry => entry.id === original.id).expenseAmount, 48.6);
    });
    await check('Owner: CSV distinguishes hours amount / expenses / total / reason and includes each entry once', async () => {
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const file = await download; const csv = readFileSync(await file.path(), 'utf8');
      assert.ok(csv.includes('"Montant des heures","Frais annexes","Total dû"'));
      assert.ok(csv.includes('"100.00","48.60","148.60"'));
      assert.equal(csv.split('\n').filter(line => line.includes('Brouillon conservé après échec fictif')).length, 1);
      writeFileSync(join(output, 'personnel-fr.csv'), csv);
    });
    await check('Owner: desktop creation preview explicitly shows 4 hours × 25 + 48.60 = 148.60', async () => {
      const form = await prepareCreation(page);
      await form.locator('[name=expenseAmount]').fill('48,60');
      await form.locator('[name=expenseNote]').fill('Frais kilométriques fictifs – Port Grimaud');
      assert.ok((await form.locator('.house-calculation-line').innerText()).includes('148,60'));
      await form.screenshot({ path: join(output, 'owner-desktop-form-fr.png') });
      await form.locator('[name=expenseAmount]').fill(''); await form.locator('[name=expenseNote]').fill('');
    });
    await check('Owner: creates one intervention with expenses; confirmed input resets; reload persists', async () => {
      const before = await projection(); const form = await prepareCreation(page);
      await form.locator('input[type=text][inputmode=decimal]').first().fill('25.10');
      await form.locator('[name=expenseAmount]').fill('0,20'); await form.locator('[name=expenseNote]').fill('=1+1');
      const response = page.waitForResponse(response => response.url().endsWith('/rpc/crm_create_house_time_entry') && response.request().method() === 'POST');
      await form.locator('button[type=submit]').click(); assert.equal((await response).status(), 200);
      await page.waitForFunction(() => document.querySelector('.house-two-columns form [name=expenseAmount]')?.value === '');
      await reloadHours(page);
      const after = await projection(); assert.equal(after.houseTimeEntries.length, before.houseTimeEntries.length + 1);
      const created = after.houseTimeEntries.find(entry => entry.expenseNote === '=1+1');
      assert.ok(created); assert.equal(created.expenseAmount, 0.2); assert.equal(created.hourlyRate, 25.1);
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const csv = readFileSync(await (await download).path(), 'utf8');
      assert.ok(csv.includes('"100.40","0.20","100.60"'));
      assert.ok(csv.includes("\"'=1+1\""));
      writeFileSync(join(output, 'personnel-fr.csv'), csv);
      assert.deepEqual(after.housePayments, before.housePayments);
    });
  } finally { await context.close(); }
} finally { await desktop.close(); }
}
const mobile = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const { context, page } = await start(mobile, fixture.users.contributor, 390);
  try {
    await check('Contributor: 390px FR/EN draft survives language switch; direct expense RPC edits existing intervention', async () => {
      await openEditor(page);
      await editor(page).locator('[name=expenseAmount]').fill('7,89'); await editor(page).locator('[name=expenseNote]').fill('Frais fictifs contributeur');
      await language(page, 'en');
      assert.equal(await editor(page).locator('[name=expenseAmount]').inputValue(), '7,89');
      assert.equal(await editor(page).getByLabel('Expense reason', { exact: true }).inputValue(), 'Frais fictifs contributeur');
      await noOverflow(page, '390px contributor editor EN');
      await page.screenshot({ path: join(output, 'contributor-mobile-editor-en.png'), fullPage: true });
      const failureUrl = status.API_URL + '/rest/v1/rpc/crm_update_house_time_expenses';
      await page.route(failureUrl, route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
      await editor(page).locator('button[type=submit]').click();
      await editor(page).getByRole('alert').waitFor();
      assert.equal(await editor(page).locator('[name=expenseAmount]').inputValue(), '7,89');
      assert.equal(await editor(page).locator('[name=expenseNote]').inputValue(), 'Frais fictifs contributeur');
      await page.unroute(failureUrl);
      await saveEditor(page, '7,89'); await reloadHours(page);
      assert.equal((await projection()).houseTimeEntries.find(entry => entry.id === 'expense-main').expenseAmount, 7.89);
      assert.ok((await row(page).innerText()).includes('107.89'));
      await language(page, 'fr');
    });
    await check('Contributor: creation includes comma expenses via restricted generic RPC; reload and EN export agree', async () => {
      const before = await projection(), form = await prepareCreation(page);
      await form.locator('[name=expenseAmount]').fill('48,60'); await form.locator('[name=expenseNote]').fill('Création frais fictifs contributeur');
      const response = page.waitForResponse(response => response.url().endsWith('/rpc/crm_mutate_record') && response.request().method() === 'POST');
      await form.locator('button[type=submit]').click(); assert.equal((await response).status(), 200);
      await page.waitForFunction(() => document.querySelector('.house-two-columns form [name=expenseAmount]')?.value === '');
      await reloadHours(page); const after = await projection();
      assert.equal(after.houseTimeEntries.length, before.houseTimeEntries.length + 1);
      const created = after.houseTimeEntries.find(entry => entry.expenseNote === 'Création frais fictifs contributeur');
      assert.equal(created.expenseAmount, 48.6); assert.equal(created.hourlyRate, 25);
      await language(page, 'en'); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const csv = readFileSync(await (await download).path(), 'utf8');
      assert.ok(csv.includes('"Hours amount","Additional expenses","Total due"'));
      assert.ok(csv.includes('"100.00","48.60","148.60"'));
      writeFileSync(join(output, 'personnel-en.csv'), csv);
      await noOverflow(page, '390px contributor creation EN');
      await page.screenshot({ path: join(output, 'contributor-mobile-form-en.png'), fullPage: true });
    });
  } finally { await context.close(); }
  const reader = await start(mobile, fixture.users.reader, 390);
  try {
    await check('Read-only: expenses and reason readable; edit action absent and creation disabled in FR/EN', async () => {
      assert.equal(await reader.page.getByRole('button', { name: 'Modifier les frais', exact: true }).count(), 0);
      assert.equal(await creation(reader.page).locator('[name=expenseAmount]').isDisabled(), true);
      await language(reader.page, 'en');
      assert.equal(await reader.page.getByRole('button', { name: 'Edit expenses', exact: true }).count(), 0);
      assert.equal(await creation(reader.page).locator('[name=expenseNote]').isDisabled(), true);
      assert.ok((await row(reader.page).innerText()).includes('7.89'));
      await noOverflow(reader.page, '390px reader EN');
      await reader.page.screenshot({ path: join(output, 'reader-mobile-en.png'), fullPage: true });
    });
  } finally { await reader.context.close(); }
} finally { await mobile.close(); }
assert.deepEqual(errors, [], 'No browser page errors'); assert.deepEqual(external, [], 'No external calls');
writeFileSync(join(output, 'results-' + phase + '.json'), JSON.stringify({ phase, browser: 'Installed Google Chrome / Playwright; 1440px desktop and 390px touch emulation', passed: checks.length, checks, pageErrors: errors, external, proof: 'Real disposable local Auth/RPC/PostgreSQL persistence through integrated application; network failures are explicitly aborted requests; no Production session/data used.' }, null, 2));
console.log('Browser checks passed: ' + checks.length + '; artifacts: ' + output);
