/** Actual Charges UI with fresh local Auth and HTTP RPC. Fictional isolated data only. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { chromium } from '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
assert.equal(process.env.MONTHLY_CHARGES_TEST_ACK, 'MONTHLY_CHARGES_LOCAL_ONLY');
const statusFile = process.env.MONTHLY_CHARGES_STATUS_FILE;
assert(statusFile, 'Explicit owned isolated status file required');
const directory = dirname(statusFile), status = JSON.parse(readFileSync(statusFile, 'utf8'));
const api = new URL(status.API_URL), database = new URL(status.DB_URL);
assert.equal(api.hostname, '127.0.0.1'); assert(['55631', '56031'].includes(api.port));
assert.equal(database.hostname, '127.0.0.1'); assert.equal(Number(database.port), Number(api.port) + 1);
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const app = 'http://127.0.0.1:3183', output = join(process.cwd(), 'docs/monthly-charges/captures');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const sql = new Client({ connectionString: status.DB_URL }); await sql.connect();
const results = [], pageErrors = [], nonlocal = [], receipts = [];
const houseId = 'fixture-house';
let baselinePayload, baselineConfig, activePage;
async function login(role = 'owner') {
  const user = fixture.users[role], response = await fetch(status.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: status.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
  assert.equal(response.status, 200); return (await response.json()).access_token;
}
async function rpc(name, args = {}, role = 'owner') {
  const token = await login(role), response = await fetch(status.API_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
const current = () => rpc('crm_read_monthly_charges');
const check = async (name, fn) => {
  if (process.env.PERIOD_CASE && !name.includes(process.env.PERIOD_CASE)) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) {
    results.push({ name, passed: false, error: error.message });
    if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: join(output, 'period-failure.png'), fullPage: true }); console.log(JSON.stringify(await activePage.locator('label').allTextContents())); }
    throw error;
  }
};
const compact = value => value.replace(/[\s\u00a0\u202f]/g, '');
const euro = (value, en = false) => compact(new Intl.NumberFormat(en ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(value));
async function open(role = 'owner', en = false, width = 1440, target) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, isMobile: width < 700, hasTouch: width < 700, locale: en ? 'en-GB' : 'fr-FR', timezoneId: 'Europe/Paris', acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1' && ['3183', api.port].includes(url.port)) return route.continue(); nonlocal.push(url.origin + url.pathname); return route.abort(); });
  const page = await context.newPage(); activePage = page; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(app + '/charges' + (target ? '?crmTarget=' + encodeURIComponent(JSON.stringify(target)) : ''));
  await page.locator('input[type=email]').fill(fixture.users[role].email);
  await page.locator('input[type=password]').fill(fixture.users[role].password); await page.locator('input[type=password]').press('Enter');
  await page.locator('[data-month]').first().waitFor({ timeout: 60000 });
  if (en) { await page.getByRole('button', { name: 'English — EN', exact: true }).first().click(); await page.getByLabel('From month…', { exact: true }).waitFor(); }
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  return { page, context, en };
}
const month = (page, id) => page.locator(`[data-month="${id}"]`);
const toggle = (page, id) => month(page, id).locator('button[aria-expanded]').first();
async function period(page, start, end, en = false) {
  // Expand end first when necessary so the intermediate input state stays valid.
  await page.getByLabel(en ? 'To month…' : 'Au mois de…', { exact: true }).fill(end);
  await page.getByLabel(en ? 'From month…' : 'Du mois de…', { exact: true }).fill(start);
  await month(page, start).waitFor();
}
async function chooseHouse(page, id, en = false, query) {
  const snapshot = await current(), house = snapshot.sources.houses.find(item => item.id === id); assert(house);
  const input = page.getByRole('combobox', { name: en ? 'House' : 'Maison', exact: true });
  await input.fill(query || house.name); const option = page.getByRole('option').filter({ hasText: house.name });
  await option.first().waitFor(); await option.first().click();
  assert.equal(await page.locator('select[aria-label=' + JSON.stringify(en ? 'House' : 'Maison') + ']').inputValue(), id);
}
async function total(page, expected, en = false) {
  const region = page.locator('[aria-label=' + JSON.stringify(en ? 'Period totals' : 'Totaux de la période') + ']');
  assert.equal(compact(await region.locator('strong').first().innerText()), euro(expected, en));
}
function csvRows(text) { return text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map(match => match[1].replaceAll('""', '"'))); }
async function downloaded(page, label) { const event = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click(); const download = await event; return readFileSync(await download.path(), 'utf8'); }
async function actualMonthAmounts(page, en = false) {
  const expected = [['2026-09', 1233.34], ['2026-10', 1133.34], ['2026-11', 33.33], ['2026-12', 0]];
  for (const [id, amount] of expected) assert.equal(compact(await month(page, id).locator('button[aria-expanded] > strong').innerText()).replace(/^Total/, ''), euro(amount, en));
}
async function saveDialog(page, action) {
  const dialog = page.getByRole('dialog').last(); await action(dialog);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/rest/v1/rpc/crm_patch_monthly_charges' && result.status() === 200);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await response; await dialog.waitFor({ state: 'detached' });
}
try {
  baselinePayload = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
  baselineConfig = (await sql.query("select config from app_private.monthly_charges_config where workspace_id='oneaddress-riviera'")).rows[0].config;
  await check('desktop FR: initial compact annual view, inclusive September–December, exact totals, keyboard collapse and screenshots', async () => {
    const { page, context } = await open();
    try {
      assert.equal(await page.getByLabel('Du mois de…', { exact: true }).inputValue(), '2026-01');
      assert.equal(await page.locator('[data-month]').count(), 12); assert((await page.getByLabel('Du mois de…', { exact: true }).boundingBox()).width >= 180, 'Desktop month input remains readable'); assert.equal(await page.locator('button[aria-expanded=true][aria-controls^="charges-month-"]').count(), 0);
      assert.equal(await page.locator('[id^="charges-month-"]').count(), 0, 'Closed month details are not mounted');
      await period(page, '2026-09', '2026-12'); await chooseHouse(page, houseId); await total(page, 2400.01); await actualMonthAmounts(page);
      assert.equal(await page.locator('[data-month]').count(), 4); assert.equal(await page.locator('[id^="charges-month-"]').count(), 0);
      await page.screenshot({ path: join(output, 'period-september-december-collapsed.png'), fullPage: true });
      await toggle(page, '2026-10').focus(); await page.keyboard.press('Enter'); assert.equal(await toggle(page, '2026-10').getAttribute('aria-expanded'), 'true');
      const detail = page.locator('#charges-month-2026-10'); assert((await detail.innerText()).includes('180,00')); assert((await detail.innerText()).includes('20,00'));
      assert((await detail.innerText()).includes('600,00')); assert((await detail.innerText()).includes('300,00')); assert((await detail.innerText()).includes('33,34'));
      await page.screenshot({ path: join(output, 'period-october-open.png'), fullPage: true });
      await toggle(page, '2026-10').focus(); await page.keyboard.press('Space'); assert.equal(await detail.count(), 0);
    } finally { await context.close(); }
  });
  await check('period summary/detail downloads equal displayed totals and clearly identify filters and inclusive months', async () => {
    const { page, context } = await open();
    try {
      await period(page, '2026-09', '2026-12'); await chooseHouse(page, houseId); await total(page, 2400.01);
      const summary = csvRows(await downloaded(page, 'CSV · synthèse de période')), detail = csvRows(await downloaded(page, 'CSV · détail de période'));
      assert(summary[0].includes('2026-09') && summary[0].includes('2026-12'));
      assert.equal(summary.find(row => row[2] === 'Total des charges sélectionnées').at(-1), '2400,01');
      assert.equal(detail.find(row => row[2] === 'Total des charges sélectionnées')[12], '2400,01');
      const sum = detail.filter(row => row[10] === 'Charges').reduce((value, row) => value + Math.round(Number(row[12].replace(',', '.')) * 100), 0);
      assert.equal(sum, 240001); assert(summary.some(row => row[1].includes('Maison :'))); assert(detail.some(row => row[0] === '2026-09 – 2026-12'));
      await period(page, '2026-09', '2026-09'); await total(page, 1233.34); assert.equal(await page.locator('[data-month]').count(), 1);
      await period(page, '2026-11', '2027-02'); assert.deepEqual(await page.locator('[data-month]').evaluateAll(nodes => nodes.map(node => node.dataset.month)), ['2026-11', '2026-12', '2027-01', '2027-02']); await total(page, 33.33);
      await page.getByLabel('Du mois de…', { exact: true }).fill('2027-03'); await page.getByRole('alert').filter({ hasText: 'Le mois de début' }).waitFor(); assert.equal(await page.locator('[data-month]').count(), 0);
      assert(await page.getByRole('button', { name: 'CSV · synthèse de période', exact: true }).isDisabled());
    } finally { await context.close(); }
  });
  await check('mobile EN emulated touch, searchable house while invoice source, precise month reopening and no overflow', async () => {
    const { page, context } = await open('owner', true, 390);
    try {
      assert((await page.getByLabel('From month…', { exact: true }).boundingBox()).width >= 180, 'Mobile start month remains readable');
      assert((await page.getByLabel('To month…', { exact: true }).boundingBox()).width >= 180, 'Mobile end month remains readable');
      await period(page, '2026-09', '2026-12', true); await page.locator('select:has(option[value=all])').selectOption('invoice'); await chooseHouse(page, houseId, true, 'cedres theoule'); await total(page, 2200.01, true);
      await toggle(page, '2026-10').tap(); assert.equal(await toggle(page, '2026-10').getAttribute('aria-expanded'), 'true'); await toggle(page, '2026-10').tap(); assert.equal(await page.locator('#charges-month-2026-10').count(), 0);
      assert(await page.evaluate(() => navigator.maxTouchPoints > 0)); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page horizontal overflow');
      await page.screenshot({ path: join(output, 'period-mobile-en-collapsed.png'), fullPage: true });
      await page.getByRole('button', { name: 'This month', exact: true }).tap(); assert.equal(await page.locator('[data-month]').count(), 1); assert.equal(await page.getByLabel('From month…', { exact: true }).inputValue(), '2026-10');
      await page.getByRole('button', { name: 'Previous month', exact: true }).tap(); assert.equal(await page.getByLabel('From month…', { exact: true }).inputValue(), '2026-09');
      await page.getByRole('button', { name: 'Current year', exact: true }).tap(); assert.equal(await page.locator('[data-month]').count(), 12);
    } finally { await context.close(); }
  });
  await check('UI month and house edits persist independently through fresh authentication and reload', async () => {
    const { page, context } = await open();
    try {
      await period(page, '2026-09', '2026-12'); await chooseHouse(page, houseId); await toggle(page, '2026-10').click();
      const initial = await current(), invoice = initial.sources.invoices.find(row => row.id === 'invoice-B'); assert(invoice);
      let article = page.locator('#charges-month-2026-10 article').filter({ hasText: invoice.title }); assert.equal(await article.count(), 1);
      await article.getByRole('button', { name: 'Mois de charge / répartition', exact: true }).click();
      await saveDialog(page, async dialog => { await dialog.locator('select').selectOption('month'); await dialog.locator('input[type=month]').fill('2026-11'); });
      let fresh = await current(); assert.equal(fresh.config.attachments.find(row => row.sourceId === invoice.id).month, '2026-11'); assert.equal(fresh.config.houseAssignments.find(row => row.sourceId === invoice.id).houseId, houseId);
      await toggle(page, '2026-11').click(); article = page.locator('#charges-month-2026-11 article').filter({ hasText: invoice.title }); await article.getByRole('button', { name: 'Affecter une maison', exact: true }).click();
      const alternative = fresh.sources.houses.find(row => row.id !== houseId); assert(alternative);
      await saveDialog(page, async dialog => { const input = dialog.getByRole('combobox', { name: 'Maison de la facture', exact: true }); await input.fill(alternative.name); await dialog.getByRole('option').filter({ hasText: alternative.name }).first().click(); });
      fresh = await current(); assert.equal(fresh.config.houseAssignments.find(row => row.sourceId === invoice.id).houseId, alternative.id); assert.equal(fresh.config.attachments.find(row => row.sourceId === invoice.id).month, '2026-11');
      await page.reload(); await page.locator('[data-month]').first().waitFor(); await period(page, '2026-09', '2026-12'); await chooseHouse(page, alternative.id); await toggle(page, '2026-11').click();
      article = page.locator('#charges-month-2026-11 article').filter({ hasText: invoice.title }); await article.getByRole('button', { name: 'Mois de charge / répartition', exact: true }).click();
      await saveDialog(page, dialog => dialog.locator('select').selectOption('default'));
      fresh = await current(); assert(!fresh.config.attachments.some(row => row.sourceId === invoice.id)); assert.equal(fresh.config.houseAssignments.find(row => row.sourceId === invoice.id).houseId, alternative.id);
      await toggle(page, '2026-10').click(); article = page.locator('#charges-month-2026-10 article').filter({ hasText: invoice.title }); await article.getByRole('button', { name: 'Affecter une maison', exact: true }).click();
      const primary = fresh.sources.houses.find(row => row.id === houseId);
      await saveDialog(page, async dialog => { await dialog.getByRole('combobox', { name: 'Maison de la facture', exact: true }).fill(primary.name); await dialog.getByRole('option').filter({ hasText: primary.name }).first().click(); });
      fresh = await current(); assert.equal(fresh.config.houseAssignments.find(row => row.sourceId === invoice.id).houseId, houseId);
      receipts.push({ invoiceId: invoice.id, realHouseWrites: 2, realMonthWrites: 2, newAuthenticationOnEveryRead: true, reload: true });
    } finally { await context.close(); }
  });
  await check('monthly task created in multimonth view keeps exact month and invoice-house filters, then opens only its month', async () => {
    const { page, context } = await open();
    try {
      await period(page, '2026-09', '2026-12'); await chooseHouse(page, houseId); await page.locator('select:has(option[value=all])').selectOption('invoice'); await toggle(page, '2026-09').click();
      const action = month(page, '2026-09').locator('[data-task-source=monthly_charges]').first(); await action.locator('summary').click();
      await action.getByRole('button', { name: 'Créer une tâche', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Créer une tâche liée', exact: true }); const title = 'Contrôle période fictive ' + randomUUID();
      await panel.locator('input[name=title]').fill(title);
      const saved = page.waitForResponse(result => new URL(result.url()).pathname === '/rest/v1/rpc/crm_tasks_mutate' && result.status() === 200);
      await panel.getByRole('button', { name: 'Créer la tâche', exact: true }).click(); const task = await (await saved).json();
      const loaded = (await rpc('crm_tasks_read', { p_id: task.id }))[0], ref = loaded.links.find(link => link.target?.type === 'monthly_charges').target;
      assert.deepEqual(ref, { type: 'monthly_charges', id: '2026-09', context: { source: 'invoice', houseId } });
      await page.goto(app + '/charges?crmTarget=' + encodeURIComponent(JSON.stringify(ref))); await month(page, '2026-09').waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-month]').length === 1 && document.querySelector('[data-month="2026-09"] button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
      assert.equal(await page.locator('select[aria-label=Maison]').inputValue(), houseId); assert.equal(await page.locator('select:has(option[value=all])').inputValue(), 'invoice');
      await period(page, '2026-11', '2027-02');
      await page.evaluate(() => window.dispatchEvent(new Event('oar-task-target-navigated')));
      await page.waitForFunction(() => document.querySelectorAll('[data-month]').length === 1 && document.querySelector('[data-month="2026-09"] button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
      receipts.push({ taskId: task.id, target: ref, freshAuthRead: true, sourceActionMonth: true, reopenedOnlyTargetMonth: true, repeatedTargetReopen: true });
    } finally { await context.close(); }
  });
  await check('restricted read and export rights constrain controls and house-filtered export', async () => {
    const reader = await open('reader');
    try { assert.equal(await reader.page.getByRole('button', { name: 'CSV · synthèse de période', exact: true }).count(), 0); assert.equal(await reader.page.getByRole('button', { name: 'Sélectionner mes charges', exact: true }).count(), 0); await period(reader.page, '2026-09', '2026-12'); await chooseHouse(reader.page, houseId); await total(reader.page, 2400.01); } finally { await reader.context.close(); }
    const contributor = await open('contributor');
    try { await period(contributor.page, '2026-09', '2026-12'); await chooseHouse(contributor.page, houseId); assert(await contributor.page.getByRole('button', { name: 'CSV · synthèse de période', exact: true }).isDisabled()); await contributor.page.getByText('L’export filtré par maison nécessite le droit d’export des maisons.', { exact: true }).waitFor(); } finally { await contributor.context.close(); }
    const invoice = await open('invoice');
    try { assert.equal(await invoice.page.getByRole('combobox', { name: 'Maison', exact: true }).count(), 0); await period(invoice.page, '2026-09', '2026-12'); const csv = await downloaded(invoice.page, 'CSV · synthèse de période'); assert(!csv.includes('LADIVA')); } finally { await invoice.context.close(); }
  });
  await check('300 real isolated interventions stay unmounted while closed, paginate fully and retain whole-month totals', async () => {
    const payload = structuredClone(baselinePayload), original = payload.houseTimeEntries.find(row => row.id === 'hours-october'); assert(original);
    payload.houseTrackingHouses.push({ id: 'fixture-bulk-house', name: 'Maison fictive · 300 interventions', address: 'Adresse fictive' });
    const bulk = Array.from({ length: 300 }, (_, index) => ({ ...original, id: 'hours-bulk-' + index, houseId: 'fixture-bulk-house', houseName: 'Maison fictive · 300 interventions', date: '2026-10-23', startTime: '09:00', endTime: '10:00', breakMinutes: 0, hourlyRate: 1, expenseAmount: 0 }));
    payload.houseTimeEntries.push(...bulk);
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [payload]);
    const { page, context } = await open();
    try {
      assert.equal(await page.locator('[id^="charges-month-"]').count(), 0);
      await period(page, '2026-10', '2026-10'); await chooseHouse(page, 'fixture-bulk-house'); await total(page, 300);
      assert.equal(await page.locator('#charges-month-2026-10 article').count(), 0);
      await toggle(page, '2026-10').click(); assert.equal(await page.locator('#charges-month-2026-10 article').count(), 50);
      for (let count = 100; count <= 300; count += 50) {
        await page.locator('#charges-month-2026-10').getByRole('button', { name: /Afficher la suite/ }).click();
        assert.equal(await page.locator('#charges-month-2026-10 article').count(), count); await total(page, 300);
      }
      assert.equal(await page.locator('#charges-month-2026-10').getByRole('button', { name: /Afficher la suite/ }).count(), 0);
      await toggle(page, '2026-10').click(); assert.equal(await page.locator('#charges-month-2026-10 article').count(), 0);
      receipts.push({ storedFictionalInterventions: bulk.length, initialMountedInterventions: 0, firstPage: 50, allReachable: 300, totalCents: 30000 });
    } finally { await context.close(); }
  });
  assert.deepEqual(pageErrors, []); assert.deepEqual(nonlocal, []);
} finally {
  if (baselinePayload) await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baselinePayload]);
  if (baselineConfig) await sql.query("update app_private.monthly_charges_config set config=$1,revision=gen_random_uuid() where workspace_id='oneaddress-riviera'", [baselineConfig]);
  writeFileSync(join(output, 'period-browser-results.json'), JSON.stringify({ realAuth: true, realHTTPRPC: true, realPostgres: true, actualCRMComponents: true, fictionalData: true, physicalDevice: false, emulatedMobileTouch: true, results, receipts, pageErrors, nonlocal }, null, 2));
  await browser.close(); await sql.end();
}
