/** Five real selectors -> local Auth/RPC -> canonical persistence. Fictitious only. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { status, directory, rpc, login, request } from '../prepaid-hours/server-local.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const source = JSON.parse(readFileSync(join(directory, 'search-fixture.private.json'), 'utf8'));
const origin = source.app, target = source.target;
assert.equal(origin, 'http://127.0.0.1:3197'); assert.equal(status.API_URL, 'http://127.0.0.1:56031');
assert.ok(Object.values(source.targetIndices).every(index => index >= 132));
const output = join(process.cwd(), 'docs/prepaid-search'); mkdirSync(join(output, 'captures'), { recursive: true });
const results = [], errors = [], external = [], controls = {};
const allowed = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const ownerToken = await login(fixture.users.owner);
const ledger = () => allowed(rpc('crm_house_prepaid_state', ownerToken));
const payload = async () => (await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload', ownerToken)))[0].payload;
const before = await payload();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const normalize = x => x.replace(/[\u00a0\u202f]/g, ' ');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const test = async (name, operation) => { await operation(); results.push({ name, passed: true }); console.log('PASS ' + name); };
async function launch(who = 'owner', width = 1440, language = 'fr') {
 const context = await browser.newContext({ viewport: { width, height: 1100 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
 const user = fixture.users[who], transport = { settingsDelay: false, packageDelay: false, loseNewPayment: false, linkDelay: false };
 await context.addInitScript(({ language, id }) => { localStorage.setItem('oar.ui-language.v1:anonymous', language); localStorage.setItem('oar.ui-language.v1:account:' + id, language); }, { language, id: user.id });
 await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (['http:', 'https:'].includes(url.protocol) && ![origin, status.API_URL].includes(url.origin)) { external.push(url.origin + url.pathname); return route.abort('blockedbyclient'); }
  if (url.pathname.endsWith('/rpc/crm_save_house_prepaid') && req.method() === 'POST') {
   const body = req.postDataJSON();
   if (body.p_action === 'settings' && transport.settingsDelay) { transport.settingsDelay = false; await delay(900); }
   if (body.p_action === 'link_invoice' && transport.linkDelay) { transport.linkDelay = false; await delay(900); }
   if (body.p_action === 'package' && transport.packageDelay) { transport.packageDelay = false; await delay(900); }
   if (body.p_action === 'package' && body.p_patch.payment && transport.loseNewPayment) {
    transport.loseNewPayment = false;
    const actual = await route.fetch(); assert.equal(actual.status(), 200, 'Actual local server persists before response loss');
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fictitious lost response after actual commit' }) });
   }
  }
  return route.continue();
 });
 const page = await context.newPage(), saves = []; page.setDefaultTimeout(18000);
 page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
 page.on('request', item => { if (item.url().endsWith('/rpc/crm_save_house_prepaid') && item.method() === 'POST') saves.push(item.postDataJSON()); });
 await page.goto(origin + '/?module=houseTracking');
 await page.locator('input[type=email]').fill(user.email); await page.locator('input[autocomplete=current-password]').fill(user.password);
 await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click(); await page.locator('.house-tracking-view').waitFor();
 await page.locator('[data-prepaid-worker="worker-prepaid"]').waitFor();
 return { context, page, saves, transport, panel: page.locator('[data-prepaid-worker="' + target.workerId + '"]') };
}
const picker = (scope, name) => {
 const native = scope.locator('select[name="' + name + '"]');
 const root = native.locator('xpath=..'); return { native, root, input: root.getByRole('combobox') };
};
const settings = async app => {
 await app.page.locator('.house-tabs button').last().click();
 const card = app.page.locator('section.card').filter({ has: app.page.getByRole('heading', { name: /^(Mode de suivi par intervenant|Worker billing mode)$/ }) });
 await card.waitFor(); const root = card.locator('[data-searchable-select]').first();
 return { card, root, native: root.locator('select'), input: root.getByRole('combobox'), form: card.locator('form') };
};
async function searchAndChoose(pick, query, expectedId, keyboard = false) {
 const previous = await pick.native.inputValue(); await pick.input.fill(query);
 await pick.root.getByRole('option').first().waitFor(); assert.equal(await pick.native.inputValue(), previous, 'Typing never assigns an ID');
 if (keyboard) { await pick.input.press('ArrowDown'); await pick.input.press('Enter'); }
 else {
  const options = pick.root.getByRole('option'); let chosen = false;
  for (let index = 0; index < await options.count(); index++) { const text = await options.nth(index).innerText(); if (text.includes(expectedId) || await options.count() === 1) { await options.nth(index).click(); chosen = true; break; } }
  assert.ok(chosen, 'Explicit matching result selected');
 }
 assert.equal(await pick.native.inputValue(), expectedId);
}
async function metric(panel, label, expected) {
 const value = panel.locator('dl > div').filter({ has: panel.page().getByText(label, { exact: true }) }).locator('dd');
 await value.waitFor(); for (let i = 0; i < 100 && normalize(await value.innerText()) !== expected; i++) await delay(100);
 assert.equal(normalize(await value.innerText()), expected);
}
async function openPurchase(app, label = 'Enregistrer un forfait payé') {
 await app.panel.getByRole('button', { name: label, exact: true }).click();
 return app.panel.locator('form').filter({ has: app.page.locator('input[name=capacityHours]') });
}
let full, firstPackageId, secondPackageId, retryBodies;
try {
 full = await launch();
 await test('worker selector searches132+rows, canonical company despite stale label, accents/inverted names/typo, explicit keyboard IDs', async () => {
  const pick = await settings(full), original = await pick.native.inputValue(), saveCount = full.saves.length;
  await pick.input.fill('mediterranee'); assert.equal(await pick.root.getByRole('option').count(), 2, 'People sharing one canonical company stay distinct');
  assert.equal(await pick.native.inputValue(), original); await pick.input.press('Escape');
  await pick.input.fill('ELEONORE D AUBIGNY'); await pick.root.getByRole('option').first().waitFor(); assert.equal(await pick.native.inputValue(), original); await pick.input.press('Escape');
  await searchAndChoose(pick, 'eleonre', target.workerId, true);
  assert.equal(full.saves.length, saveCount, 'Search and selection are not persistence');
  assert.ok(await pick.native.locator('option').count() > 132); controls.worker = true;
  await pick.root.screenshot({ path: join(output, 'captures/worker-search-fr.png') });
 });
 await test('settings save blocks the external worker selector and pending fields; double-click sends one canonical settings request', async () => {
  const pick = await settings(full); await pick.form.locator('select[name=billingMode]').selectOption('prepaid');
  const count = full.saves.length; full.transport.settingsDelay = true;
  const click = pick.form.getByRole('button', { name: 'Enregistrer le mode', exact: true }).dblclick();
  await pick.form.locator('fieldset:disabled').waitFor(); assert.equal(await pick.input.isDisabled(), true); assert.equal(await pick.form.locator('select[name=billingMode]').isDisabled(), true);
  await click; await full.panel.waitFor(); await metric(full.panel, 'Heures réalisées', '32 h');
  assert.equal(full.saves.length - count, 1); assert.equal(full.saves.at(-1).p_patch.workerId, target.workerId); assert.equal(await pick.input.isDisabled(), false);
 });
 await test('existing payment and optional invoice selectors search full long lists; explicit attach preserves payment ID and creates no payment', async () => {
  const form = await openPurchase(full), payment = picker(form, 'paymentId'), invoice = picker(form, 'invoiceId');
  assert.ok(await payment.native.locator('option').count() > 132); assert.ok(await invoice.native.locator('option').count() > 132);
  await searchAndChoose(payment, 'boreale', target.paymentId, true); controls.existingPayment = true;
  const retained = await payment.native.inputValue(); await payment.input.fill('aucun rapprochement fictif'); await payment.root.getByText('Aucun résultat', { exact: true }).waitFor(); assert.equal(await payment.native.inputValue(), retained); await payment.input.press('Escape');
  await searchAndChoose(invoice, 'ecole archipel', target.invoiceId, true); controls.purchaseInvoice = true;
  full.transport.packageDelay = true; const count = full.saves.length;
  const clicked = form.getByRole('button', { name: 'Confirmer le forfait payé', exact: true }).dblclick(); await form.locator('fieldset:disabled').waitFor(); assert.equal(await payment.input.isDisabled(), true); assert.equal(await invoice.input.isDisabled(), true); await clicked;
  await metric(full.panel, 'Heures achetées', '30 h'); await metric(full.panel, 'Heures à couvrir', '2 h'); assert.equal(full.saves.length - count, 1);
  const saved = full.saves.at(-1); assert.equal(saved.p_patch.paymentId, target.paymentId); assert.equal(saved.p_patch.invoiceId, target.invoiceId); assert.equal(saved.p_patch.payment, undefined);
  const live = await ledger(), pack = live.packages.find(x => x.workerId === target.workerId); firstPackageId = pack.id; assert.equal(pack.paymentId, target.paymentId); assert.equal(pack.invoiceId, target.invoiceId);
  assert.equal((await payload()).housePayments.filter(x => x.workerId === target.workerId).length, source.counts.targetPayments);
 });
 await test('new payment house selector searches address/city/postcode beyond132rows and keeps empty/native IDs until explicit choice', async () => {
  const form = await openPurchase(full, 'Renouveler le forfait'); await form.locator('select[name=source]').selectOption('new');
  const house = picker(form, 'houseId'); assert.ok(await house.native.locator('option').count() > 132);
  const count = full.saves.length; await house.input.fill('06800 cagnes'); await house.root.getByRole('option').first().waitFor(); assert.equal(await house.native.inputValue(), ''); assert.equal(full.saves.length, count); await house.input.press('Escape');
  await searchAndChoose(house, 'allee ecureuils', target.houseId, true); controls.paymentHouse = true;
  const invoice = picker(form, 'invoiceId'); await invoice.input.fill('jasmin'); await invoice.root.getByRole('option').first().waitFor(); assert.equal(await invoice.native.inputValue(), ''); await invoice.input.press('Escape');
  await form.locator('input[name=date]').fill('2026-10-26'); await form.locator('input[name=confirmed]').check();
  await form.locator('input[name=note]').fill('Paiement fictif effectué');
  await form.screenshot({ path: join(output, 'captures/payment-search-fr.png') });
 });
 await test('actual server commit then lost response: pending controls block edits, query-only/same-ID/reformatted retry retains request and payment IDs without duplicate credit', async () => {
  const form = full.panel.locator('form').filter({ has: full.page.locator('input[name=capacityHours]') });
  const house = picker(form, 'houseId'), invoice = picker(form, 'invoiceId'); full.transport.packageDelay = true; full.transport.loseNewPayment = true;
  const count = full.saves.length, click = form.getByRole('button', { name: 'Confirmer le forfait payé', exact: true }).dblclick();
  await form.locator('fieldset:disabled').waitFor(); assert.equal(await house.input.isDisabled(), true); assert.equal(await invoice.input.isDisabled(), true); assert.equal(await form.locator('select[name=source]').isDisabled(), true); await click;
  await form.getByRole('alert').filter({ hasText: 'Paiement et forfait non confirmés' }).waitFor(); assert.equal(full.saves.length - count, 1);
  const first = full.saves.at(-1); const committed = await ledger(); assert.equal(committed.summaries.find(x => x.workerId === target.workerId).availableMinutes, 1680);
  await house.input.fill('cagnes'); await house.root.getByRole('option').first().waitFor(); assert.equal(await house.native.inputValue(), target.houseId); await house.input.press('Escape');
  await searchAndChoose(house, '06800', target.houseId, true);
  await invoice.input.fill('jasmin'); await invoice.root.getByRole('option').first().waitFor(); assert.equal(await invoice.native.inputValue(), ''); await invoice.input.press('Escape');
  await form.locator('input[name=price]').fill('500,00'); await form.locator('input[name=note]').fill('  Paiement fictif effectué  ');
  await form.getByRole('button', { name: 'Confirmer le forfait payé', exact: true }).dblclick(); await metric(full.panel, 'Heures disponibles', '28 h');
  assert.equal(full.saves.length - count, 2); const retry = full.saves.at(-1); assert.equal(retry.p_request_id, first.p_request_id); assert.equal(retry.p_patch.payment.id, first.p_patch.payment.id); assert.deepEqual(retry.p_patch, first.p_patch); retryBodies = [first, retry];
  const live = await ledger(), packs = live.packages.filter(x => x.workerId === target.workerId); assert.equal(packs.length, 2); secondPackageId = packs.find(x => x.id !== firstPackageId).id;
  const stored = await payload(); assert.equal(stored.housePayments.filter(x => x.workerId === target.workerId).length, source.counts.targetPayments + 1); assert.equal(stored.housePayments.filter(x => x.id === first.p_patch.payment.id).length, 1);
 });
 await test('EN mobile owner uses all five searchable selectors with keyboard/touch, reserved payment excluded and no search-only persistence', async () => {
  const app = await launch('owner', 390, 'en'); await app.panel.waitFor(); await metric(app.panel, 'Hours available', '28 h');
  const mode = await settings(app); await searchAndChoose(mode, 'mediterranee eleonore', target.workerId, true);
  const form = await openPurchase(app, 'Renew the package'), payment = picker(form, 'paymentId'); assert.equal(await payment.native.locator('option[value="' + target.paymentId + '"]').count(), 0);
  await searchAndChoose(payment, 'payment-search-131', 'payment-search-131', false);
  await form.locator('select[name=source]').selectOption('new'); await searchAndChoose(picker(form, 'houseId'), '06800', target.houseId, false);
  await searchAndChoose(picker(form, 'invoiceId'), 'jasmin', target.historyInvoiceId, true);
  await app.panel.locator('details summary').click(); const history = app.panel.locator('details form').last(); await searchAndChoose(picker(history, 'invoiceId'), 'jasmin', target.historyInvoiceId, false);
  assert.equal(app.saves.length, 0); assert.ok(await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await app.panel.screenshot({ path: join(output, 'captures/selectors-mobile-en.png') }); await app.context.close();
 });
 await test('history invoice selector searches complete list and persists the explicit canonical package/invoice link', async () => {
  await full.panel.locator('details summary').click(); const form = full.panel.locator('details form').last(), invoice = picker(form, 'invoiceId'); assert.ok(await invoice.native.locator('option').count() > 132);
  await searchAndChoose(invoice, 'hist jasmin', target.historyInvoiceId, true); controls.historyInvoice = true;
  full.transport.linkDelay = true; const clicked = form.getByRole('button', { name: 'Confirmer le lien', exact: true }).dblclick(); await form.locator('fieldset:disabled').waitFor(); assert.equal(await invoice.input.isDisabled(), true); await clicked;
  for (let i = 0; i < 100 && !(await ledger()).packages.some(x => x.id === secondPackageId && x.invoiceId === target.historyInvoiceId); i++) await delay(100);
  assert.equal((await ledger()).packages.find(x => x.id === secondPackageId).invoiceId, target.historyInvoiceId);
  const saved = full.saves.at(-1); assert.equal(saved.p_action, 'link_invoice'); assert.equal(saved.p_patch.packageId, secondPackageId); assert.equal(saved.p_patch.invoiceId, target.historyInvoiceId);
 });
 await test('restricted EN mobile hides unauthorized canonical-company and invoice metadata while retaining authorized IDs; reader remains read-only', async () => {
  const app = await launch('contributor', 390, 'en'); await app.panel.waitFor(); const mode = await settings(app), original = await mode.native.inputValue();
  await mode.input.fill('mediterranee'); await mode.root.getByText('No results', { exact: true }).waitFor(); assert.equal(await mode.native.inputValue(), original); await mode.input.press('Escape');
  await searchAndChoose(mode, 'Libelle historique professeur', target.workerId, true);
  const form = await openPurchase(app, 'Renew the package'); assert.equal(await form.locator('select[name=invoiceId]').count(), 0); assert.equal(await app.panel.locator('details form').count(), 0);
  const serialized = await mode.native.locator('option').evaluateAll(nodes => nodes.map(n => n.textContent + ' ' + n.getAttribute('data-search')).join(' ')); assert.doesNotMatch(serialized, /MÉDITERRANÉE|Ancienne étiquette|Éléonore/);
  assert.equal(app.saves.length, 0); await app.context.close();
  const reader = await launch('reader', 1440, 'fr'); await reader.panel.waitFor(); assert.ok(await reader.panel.getByRole('button', { name: /Renouveler le forfait|Enregistrer un forfait payé/ }).evaluateAll(nodes => nodes.every(n => n.disabled))); assert.equal(reader.saves.length, 0); await reader.context.close();
 });
 await test('fresh authentication rereads exactly two packages and one new payment, with source durations/legacy rates and hourly worker unchanged', async () => {
  const freshToken = await login(fixture.users.owner), live = await allowed(rpc('crm_house_prepaid_state', freshToken));
  const row = live.summaries.find(x => x.workerId === target.workerId); assert.deepEqual(row, { workerId: target.workerId, paidCents: 100000, purchasedMinutes: 3600, performedMinutes: 1920, coveredMinutes: 1920, availableMinutes: 1680, uncoveredMinutes: 0 });
  const stored = await payload(), strip = x => Object.fromEntries(Object.entries(x).filter(([key]) => !['billingMode', 'prepaid'].includes(key)));
  assert.deepEqual(stored.houseTimeEntries.filter(x => x.workerId === target.workerId).map(strip), before.houseTimeEntries.filter(x => x.workerId === target.workerId).map(strip));
  assert.deepEqual(stored.houseTrackingWorkers.find(x => x.id === 'worker-hourly'), before.houseTrackingWorkers.find(x => x.id === 'worker-hourly'));
  assert.deepEqual(stored.housePayments.find(x => x.id === 'payment-hourly'), before.housePayments.find(x => x.id === 'payment-hourly'));
  assert.equal(stored.housePayments.filter(x => x.id === retryBodies[0].p_patch.payment.id).length, 1); assert.equal(live.packages.filter(x => x.workerId === target.workerId).length, 2);
 });
 assert.deepEqual(Object.keys(controls).sort(), ['existingPayment', 'historyInvoice', 'paymentHouse', 'purchaseInvoice', 'worker'].sort()); assert.deepEqual(errors, []); assert.deepEqual(external, []);
 writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ passed: results.length, results, selectors: controls, fixtureCounts: source.counts, targetSourceIndices: source.targetIndices, lostResponseReplay: { requestIdUnchanged: retryBodies[0].p_request_id === retryBodies[1].p_request_id, paymentIdUnchanged: retryBodies[0].p_patch.payment.id === retryBodies[1].p_patch.payment.id, oneNewPaymentPersisted: true }, runtimeErrors: errors, externalRequests: external, evidence: 'Fictitious loopback data; actual Auth/JWT/RPC and server persistence; response loss simulated after actual local commit; Production not mutated' }, null, 2));
} catch (error) {
 if (full) await full.page.screenshot({ path: join(directory, 'search-failure.private.png'), fullPage: true }).catch(() => {});
 writeFileSync(join(directory, 'search-failure.private.json'), JSON.stringify({ passed: results.length, results, error: error.message }, null, 2), { mode: 0o600 }); throw error;
} finally { await full?.context.close(); await browser.close(); }
