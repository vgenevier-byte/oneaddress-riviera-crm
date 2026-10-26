/** Real UI -> disposable local Auth/RPC -> PostgreSQL. No production identities or payments. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { connect, sql, status, directory, login, rpc, request } from './server-local.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = process.env.PREPAID_HOURS_APP_ORIGIN || 'http://127.0.0.1:3197';
const appURL = new URL(origin);
assert.equal(appURL.hostname, '127.0.0.1');
assert.ok(['3197', '3198', '3199'].includes(appURL.port));
assert.equal(appURL.origin, origin);
assert.equal(status.API_URL, 'http://127.0.0.1:56031');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(join(directory, 'baseline.private.json'), 'utf8'));
const output = join(process.cwd(), 'docs/prepaid-hours-input');
mkdirSync(join(output, 'captures'), { recursive: true });
const allowed = async operation => { const result = await operation; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
const results = [], errors = [], external = [], controls = { settingsReplay: null, purchaseReplay: null, renewalReplay: null, legacyMinutes: [] };
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const test = async (name, operation) => { await operation(); results.push({ name, passed: true }); console.log('PASS ' + name); };
const token = await login(fixture.users.owner);
const ledger = () => allowed(rpc('crm_house_prepaid_state', token));
const payload = async () => (await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload', token)))[0].payload;
async function saveSettings(minutes) {
 const state = await ledger();
 return allowed(rpc('crm_save_house_prepaid', token, { p_revision: state.revision, p_request_id: randomUUID(), p_action: 'settings', p_patch: { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: minutes, defaultPriceCents: 50000 } }));
}

await connect();
let browser, full;
try {
 // These are the same private disposable tables reset by server-reset.mjs.
 await sql.query('begin');
 await sql.query('truncate app_private.house_prepaid_settings,app_private.house_prepaid_packages,app_private.house_prepaid_requests,app_private.house_prepaid_entry_audit restart identity');
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
 await sql.query('commit');
 await saveSettings(1800);
 const before = await payload();
 browser = await chromium.launch({ headless: true, channel: 'chrome' });

 async function launch(width = 1440, language = 'fr', who = 'owner') {
  const context = await browser.newContext({ viewport: { width, height: 1100 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const user = fixture.users[who], transport = { settingsLosses: 0, packageLosses: 0 };
  await context.addInitScript(({ language, id }) => { localStorage.setItem('oar.ui-language.v1:anonymous', language); localStorage.setItem('oar.ui-language.v1:account:' + id, language); }, { language, id: user.id });
  await context.route('**/*', async route => {
   const req = route.request(), url = new URL(req.url());
   if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
   if (url.pathname.endsWith('/rpc/crm_save_house_prepaid') && req.method() === 'POST') {
    const body = req.postDataJSON(), loss = body.p_action === 'settings' ? 'settingsLosses' : body.p_action === 'package' ? 'packageLosses' : null;
    if (loss && transport[loss] > 0) {
     transport[loss]--;
     const actual = await route.fetch();
     assert.equal(actual.status(), 200, 'Actual local commit or canonical replay succeeds before simulated response loss');
     return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fictitious response loss after actual local server commit' }) });
    }
   }
   return route.continue();
  });
  const page = await context.newPage(), saves = [];
  page.setDefaultTimeout(18000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  page.on('request', item => { if (item.url().endsWith('/rpc/crm_save_house_prepaid') && item.method() === 'POST') saves.push(item.postDataJSON()); });
  await page.goto(origin + '/?module=houseTracking');
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[autocomplete=current-password]').fill(user.password);
  await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
  await page.locator('.house-tracking-view').waitFor();
  const panel = page.locator('[data-prepaid-worker="worker-prepaid"]'); await panel.waitFor();
  return { context, page, panel, saves, transport, language };
 }
 async function settings(app) {
  await app.page.locator('.house-tabs button').last().click();
  const card = app.page.locator('section.card').filter({ has: app.page.getByRole('heading', { name: /^(Mode de suivi par intervenant|Worker billing mode)$/ }) });
  const select = card.locator('[data-searchable-select]').first();
  if (await select.locator('select').inputValue() !== 'worker-prepaid') {
   await select.getByRole('combobox').fill('Alex fictif');
   await select.getByRole('option').filter({ hasText: 'Alex fictif' }).click();
  }
  return { card, form: card.locator('form'), input: card.locator('input[name=defaultHours]') };
 }
 async function purchase(app, renewal = false) {
  await app.panel.getByRole('button', { name: app.language === 'fr' ? renewal ? 'Renouveler le forfait' : 'Enregistrer un forfait payé' : renewal ? 'Renew the package' : 'Record a paid package', exact: true }).click();
  const form = app.panel.locator('form').filter({ has: app.page.locator('input[name=capacityHours]') });
  await form.locator('select[name=source]').selectOption('new');
  const root = form.locator('select[name=houseId]').locator('xpath=..');
  await root.getByRole('combobox').fill('Maison A fictive');
  await root.getByRole('option').filter({ hasText: 'Maison A fictive' }).click();
  await form.locator('input[name=date]').fill('2026-10-26');
  const note = form.locator('input[name=note]');
  if (await note.count()) await note.fill('Paiement fictif uniquement — test saisie heures');
  await form.locator('input[name=confirmed]').check();
  return { form, input: form.locator('input[name=capacityHours]') };
 }
 const submitSettings = item => item.form.getByRole('button', { name: /^(Enregistrer le mode|Save mode)$/ }).click();
 const submitPurchase = item => item.form.getByRole('button', { name: /^(Confirmer le forfait payé|Confirm paid package)$/ }).click();
 async function settingsSuccess(item) {
  // The full CRM may remount this form after accepting its server snapshot.
  // Its success paragraph is therefore transient; canonical reread is proof.
  await item.form.locator('button[type=submit]:enabled').waitFor();
  assert.doesNotMatch(await item.form.innerText(), /Enregistrement non confirmé|Save not confirmed/);
  return ledger();
 }
 async function metric(app, label, expected) {
  const value = app.panel.locator('dl > div').filter({ has: app.page.getByText(label, { exact: true }) }).locator('dd');
  await value.waitFor();
  for (let i = 0; i < 100 && normalize(await value.innerText()) !== expected; i++) await delay(100);
  assert.equal(normalize(await value.innerText()), expected);
 }
 function sameReplay(requests, count, minutes, action) {
  const bodies = requests.slice(count);
  assert.ok(bodies.length >= 2);
  assert.ok(bodies.every(body => body.p_action === action));
  for (const body of bodies) {
   assert.equal(body.p_request_id, bodies[0].p_request_id);
   assert.deepEqual(body.p_patch, bodies[0].p_patch);
   assert.equal(body.p_patch[action === 'settings' ? 'defaultMinutes' : 'capacityMinutes'], minutes);
   assert.equal(body.p_patch.defaultHours, undefined); assert.equal(body.p_patch.capacityHours, undefined);
  }
  return { attempts: bodies.length, canonicalMinutes: minutes, identicalRequestId: true, identicalPatch: true, ...(action === 'package' ? { identicalPaymentId: bodies.every(body => body.p_patch.payment.id === bodies[0].p_patch.payment.id) } : {}) };
 }

 full = await launch();
 await test('FR settings: 1800 stored minutes read as30h;30/30,0/30.00 commit and replay identical1800-minute settings', async () => {
  const item = await settings(full);
  assert.equal(await item.input.inputValue(), '30');
  assert.equal(await item.input.getAttribute('type'), 'text');
  assert.equal(await item.input.getAttribute('inputmode'), 'decimal');
  assert.match(await item.form.innerText(), /Volume du forfait \(heures\)/i);
  const count = full.saves.length; full.transport.settingsLosses = 2;
  for (const value of ['30', '30,0']) {
   await item.input.fill(value); await submitSettings(item);
   await item.form.getByRole('status').filter({ hasText: 'Enregistrement non confirmé' }).waitFor();
   assert.equal(await item.input.inputValue(), value);
  }
  await item.input.fill('30.00'); await submitSettings(item); await settingsSuccess(item);
  controls.settingsReplay = sameReplay(full.saves, count, 1800, 'settings');
  assert.equal((await ledger()).settings.find(x => x.workerId === 'worker-prepaid').defaultMinutes, 1800);
  const fresh = await launch(), reread = await settings(fresh); assert.equal(await reread.input.inputValue(), '30'); await fresh.context.close();
 });
 await test('FR settings comma fraction saves1830; fresh EN mobile rereads30.5 and dot fraction saves the same1830', async () => {
  const item = await settings(full); await item.input.fill('30,5'); await submitSettings(item); await settingsSuccess(item);
  assert.equal(full.saves.at(-1).p_patch.defaultMinutes, 1830);
  assert.equal((await ledger()).settings.find(x => x.workerId === 'worker-prepaid').defaultMinutes, 1830);
  const mobile = await launch(390, 'en'), fresh = await settings(mobile);
  assert.equal(await fresh.input.inputValue(), '30.5'); assert.match(await fresh.form.innerText(), /Package volume \(hours\)/i);
  await fresh.input.fill('30.5'); await submitSettings(fresh); await settingsSuccess(fresh);
  assert.equal(mobile.saves.at(-1).p_patch.defaultMinutes, 1830);
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await fresh.card.screenshot({ path: join(output, 'captures/settings-mobile-en.png') }); await mobile.context.close();
 });
 await test('FR creation:30/30,0/30.00 keep one request/payment identity after two actual commits with lost responses; fresh reread30h', async () => {
  await full.context.close(); full = await launch();
  const item = await purchase(full); assert.equal(await item.input.inputValue(), '30,5', 'New creation uses the stored default in hours');
  assert.match(await item.form.innerText(), /Volume du forfait \(heures\)/i);
  const count = full.saves.length; full.transport.packageLosses = 2;
  for (const value of ['30', '30,0']) {
   await item.input.fill(value); await submitPurchase(item);
   await item.form.getByRole('alert').filter({ hasText: 'Paiement et forfait non confirmés' }).waitFor();
   assert.equal(await item.input.inputValue(), value);
  }
  await item.input.fill('30.00'); await submitPurchase(item); await item.form.waitFor({ state: 'detached' });
  controls.purchaseReplay = sameReplay(full.saves, count, 1800, 'package');
  await metric(full, 'Heures achetées', '30 h'); await metric(full, 'Heures à couvrir', '2 h');
  const live = await ledger(); assert.equal(live.packages.filter(x => x.workerId === 'worker-prepaid').length, 1);
  const stored = await payload(); assert.equal(stored.housePayments.length, before.housePayments.length + 1);
  const fresh = await launch(); await metric(fresh, 'Heures achetées', '30 h'); await fresh.context.close();
 });
 await test('EN mobile renewal:30,5/30.5 send1830 with identical replay/payment IDs; saved summaries/history show60h30 and28h30', async () => {
  const mobile = await launch(390, 'en'), item = await purchase(mobile, true);
  assert.equal(await item.input.inputValue(), '30.5');
  assert.match(await item.form.innerText(), /Package volume \(hours\)/i);
  const count = mobile.saves.length; mobile.transport.packageLosses = 1;
  await item.input.fill('30,5'); await submitPurchase(item);
  await item.form.getByRole('alert').filter({ hasText: 'Payment and package not confirmed' }).waitFor();
  await item.input.fill('30.5'); await submitPurchase(item); await item.form.waitFor({ state: 'detached' });
  controls.renewalReplay = sameReplay(mobile.saves, count, 1830, 'package');
  await metric(mobile, 'Hours purchased', '60 h 30'); await metric(mobile, 'Hours available', '28 h 30');
  await mobile.panel.locator('details summary').click();
  assert.match(normalize(await mobile.panel.locator('details').innerText()), /30 h 30/);
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.panel.screenshot({ path: join(output, 'captures/renewal-mobile-en.png') }); await mobile.context.close();
  const fresh = await launch(); await metric(fresh, 'Heures achetées', '60 h 30'); await metric(fresh, 'Heures disponibles', '28 h 30');
  await fresh.panel.locator('details summary').click(); assert.match(normalize(await fresh.panel.locator('details').innerText()), /30 h 30/);
  await fresh.panel.screenshot({ path: join(output, 'captures/history-desktop-fr.png') }); await fresh.context.close();
 });
 await test('restricted EN mobile contributor rereads hour defaults/settings and reader preserves read-only controls', async () => {
  const app = await launch(390, 'en', 'contributor');
  await metric(app, 'Hours purchased', '60 h 30'); await metric(app, 'Hours available', '28 h 30');
  const item = await settings(app); assert.equal(await item.input.inputValue(), '30.5');
  await item.input.fill('30,5'); await submitSettings(item); await settingsSuccess(item);
  assert.equal(app.saves.at(-1).p_patch.defaultMinutes, 1830);
  const renew = await purchase(app, true); assert.equal(await renew.input.inputValue(), '30.5');
  assert.ok(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await renew.form.getByRole('button', { name: 'Cancel', exact: true }).click(); await app.context.close();
  const reader = await launch(390, 'en', 'reader'); await metric(reader, 'Hours purchased', '60 h 30');
  assert.ok(await reader.panel.getByRole('button', { name: /Renew the package|Record a paid package/ }).evaluateAll(nodes => nodes.every(node => node.disabled)));
  assert.equal(reader.saves.length, 0); await reader.context.close();
 });
 const purchasedBeforeLegacy = (await ledger()).packages;
 await test('existing1/59/1801-minute settings survive unedited save and prefill creation/renewal exactly; no quarter-hour restriction', async () => {
  for (const minutes of [1, 59, 1801]) {
   await saveSettings(minutes);
   const app = await launch(minutes === 59 ? 390 : 1440, minutes === 59 ? 'en' : 'fr'), item = await settings(app);
   const displayed = await item.input.inputValue(); assert.ok(displayed.length > 0);
   await submitSettings(item); await settingsSuccess(item); assert.equal(app.saves.at(-1).p_patch.defaultMinutes, minutes);
   assert.equal((await ledger()).settings.find(x => x.workerId === 'worker-prepaid').defaultMinutes, minutes);
   const create = await purchase(app, true); assert.equal(await create.input.inputValue(), displayed);
   await create.form.getByRole('button', { name: /^(Annuler|Cancel)$/ }).click();
   controls.legacyMinutes.push({ minutes, displayed, savedMinutes: app.saves.at(-1).p_patch.defaultMinutes });
   await app.context.close();
  }
  await saveSettings(1806);
  const app = await launch(), item = await settings(app); await item.input.fill('30,1'); await submitSettings(item); await settingsSuccess(item);
  assert.equal(app.saves.at(-1).p_patch.defaultMinutes, 1806, 'Six-minute fraction is accepted independently of quarter-hour choices'); await app.context.close();
 });
 await test('settings and purchase reject sub-minute fractions without silently rounding or sending any RPC', async () => {
  const app = await launch(), item = await settings(app), count = app.saves.length;
  await item.input.fill('30.333'); await submitSettings(item); await item.form.getByRole('status').waitFor();
  assert.equal(app.saves.length, count); assert.equal(await item.input.inputValue(), '30.333');
  const create = await purchase(app); await create.input.fill('30,333'); await submitPurchase(create); await create.form.getByRole('alert').waitFor();
  assert.equal(app.saves.length, count); assert.equal(await create.input.inputValue(), '30,333'); await app.context.close();
 });
 await test('fresh server reread preserves existing packages/prices/payments/source durations/rates and exact global totals', async () => {
  const live = await ledger(), stored = await payload();
  assert.deepEqual(live.packages, purchasedBeforeLegacy);
  assert.deepEqual(live.summaries.find(x => x.workerId === 'worker-prepaid'), { workerId: 'worker-prepaid', paidCents: 100000, purchasedMinutes: 3630, performedMinutes: 1920, coveredMinutes: 1920, availableMinutes: 1710, uncoveredMinutes: 0 });
  assert.equal(stored.housePayments.length, before.housePayments.length + 2);
  for (const payment of before.housePayments) assert.deepEqual(stored.housePayments.find(x => x.id === payment.id), payment);
  const strip = item => Object.fromEntries(Object.entries(item).filter(([key]) => !['billingMode', 'prepaid'].includes(key)));
  assert.deepEqual(stored.houseTimeEntries.map(strip), before.houseTimeEntries.map(strip));
  assert.deepEqual(stored.houseTrackingWorkers.find(x => x.id === 'worker-hourly'), before.houseTrackingWorkers.find(x => x.id === 'worker-hourly'));
  assert.deepEqual(stored.vendorInvoices, before.vendorInvoices);
  assert.ok(live.packages.every(x => x.priceCents === 50000));
 });
 await test('explicit renewal30h and creation30h30 each save canonical minutes and reread through fresh Auth', async () => {
  await saveSettings(1800);
  const renewal = await launch(), renewForm = await purchase(renewal, true);
  assert.equal(await renewForm.input.inputValue(), '30');
  await submitPurchase(renewForm); await renewForm.form.waitFor({ state: 'detached' });
  assert.equal(renewal.saves.at(-1).p_patch.capacityMinutes, 1800);
  await renewal.context.close();
  const rereadRenewal = await launch(390, 'en'); await metric(rereadRenewal, 'Hours purchased', '90 h 30');
  await rereadRenewal.panel.locator('details summary').click(); assert.match(normalize(await rereadRenewal.panel.locator('details').innerText()), /30 h/);
  const create = await purchase(rereadRenewal); await create.input.fill('30,5'); await submitPurchase(create); await create.form.waitFor({ state: 'detached' });
  assert.equal(rereadRenewal.saves.at(-1).p_patch.capacityMinutes, 1830); await rereadRenewal.context.close();
  const fresh = await launch(); await metric(fresh, 'Heures achetées', '121 h'); await metric(fresh, 'Heures disponibles', '89 h');
  await fresh.panel.locator('details summary').click(); assert.match(normalize(await fresh.panel.locator('details').innerText()), /30 h 30/); await fresh.context.close();
  const final = await ledger(); assert.deepEqual(final.packages.filter(x => purchasedBeforeLegacy.some(old => old.id === x.id)), purchasedBeforeLegacy);
  assert.equal(final.packages.filter(x => x.workerId === 'worker-prepaid').length, 4);
  assert.equal((await payload()).housePayments.length, before.housePayments.length + 4);
 });
 assert.deepEqual(errors, [], 'No browser runtime errors'); assert.deepEqual(external, [], 'No external browser network traffic');
 writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ passed: results.length, results, controls, runtimeErrors: errors, externalRequests: external, evidence: 'Actual disposable loopback Auth/RPC/PostgreSQL with fictitious sources and payments only; production not exercised' }, null, 2) + '\n');
} finally {
 await full?.context.close(); await browser?.close(); await sql.end();
}
