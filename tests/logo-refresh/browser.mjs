/** Browser-only fictitious transport. Every cloud/business response is mocked. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { foncierePayload } = require('../task-links/native-fixtures.cjs');
const origin = process.env.LOGO_REFRESH_ORIGIN || 'http://127.0.0.1:3199';
const api = 'http://127.0.0.1:3997';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const output = process.env.LOGO_REFRESH_OUTPUT || 'docs/logo-refresh'; mkdirSync(output, { recursive: true });
const results = [], errors = [], contexts = [], audits = [];
const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','fonciere','izord','publisher','monthlyCharges'];
const projectId = '00000000-0000-4000-8000-000000000010';
const data = foncierePayload(); data.data.name = 'Villa fictive actualisation'; data.data.presentationData.photos = { main: '', view: '', inside: '', operation: '' };
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const normalize = text => text.replace(/[\u00a0\u202f]/g, ' ');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function deadline(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fictitious request was not reached')), 12000); })]); } finally { clearTimeout(timer); } }
const report = () => writeFileSync(output + '/validation.json', JSON.stringify({ mode: 'production-built local application; browser HTTP fixture only', data: 'fictitious; no production Auth, database, Storage, Drive or Publisher request', origin, results, errors, audits: audits.map(state => ({ unexpectedRequests: state.blocked, businessWrites: state.writes.map(item => item.rpc), signIns: state.auth.filter(item => item === 'sign-in').length, signOuts: state.auth.filter(item => item === 'sign-out').length })) }, null, 2));
async function test(name, fn) { if (process.env.LOGO_REFRESH_ONLY && !name.includes(process.env.LOGO_REFRESH_ONLY)) return; try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); } report(); }
async function session({ profile = 'full', language = 'fr', mobile = false, width = mobile ? 768 : 1440, expectLogo = true, path = '/?module=contacts&fixture=a%20b#preserved-anchor' } = {}) {
 const full = profile === 'full', id = full ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002';
 const grants = Object.fromEntries(modules.map(module => [module, { level: full || ['contacts','fonciere','houseTracking','planning'].includes(module) ? 'contribute' : 'none', sensitive: { delete: true, export: true, bank_read: true, bank_write: true } }]));
 const access = { revision: 1, active: true, generalAdmin: full, fullAccess: full, modules: grants };
 const user = { id, aud: 'authenticated', role: 'authenticated', email: 'refresh-' + profile + '@example.invalid', email_confirmed_at: '2026-10-27T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: '2026-10-27T00:00:00Z' };
 const target = { ...user, id: '00000000-0000-4000-8000-000000000003', email: 'refresh-target@example.invalid', confirmed: true, active: true, generalAdmin: false, revision: 1, modules: structuredClone(grants), izordRole: 'contributor', assignments: [], fonciereAssignments: [] };
 const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', email: user.email, exp: 4102444800 })).toString('base64url'), 'local-fixture-signature'].join('.');
 const payload = Object.fromEntries(['contacts','leads','properties','vehicles','boats','tasks','suppliers','planningEntries','quotes','documents','vendorQuotes','vendorInvoices','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key => [key, []]));
 const project = { id: projectId, owner_id: id, title: data.data.name, project_number: 10, project_reference: 'OAR-FICTIF-10', revision: 1, status: 'active', payload: structuredClone(data), created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z' };
 const arbitration = { projectId, fingerprint: 'fictitious-fingerprint', revision: 1, private: true, canVote: 'vincent', status: 'pending', pending: ['vincent','ann_charlotte'], disagreement: false, opinions: {}, history: [], bank: { presentationId: null, state: 'none', reason: null, approvedFingerprint: null, currentApproval: false, needsUpdate: false, canPrepare: false, canOpen: false, missing: [] } };
 const state = { writes: [], auth: [], blocked: [], requests: [], holdSave: null, saveEntered: null, saves: 0, documents: 0, holdWorkspace: null, workspaceEntered: null, driveStatus: 'retry', holdDrive: null, driveEntered: null, transfers: 0 }; audits.push(state);
 const context = await browser.newContext({ viewport: { width, height: 1000 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) }); contexts.push(context);
 await context.addInitScript(({ id, language }) => { if (!sessionStorage.getItem('logo-fixture-initialized')) { localStorage.setItem('oar.ui-language.v1:anonymous', language); localStorage.setItem('oar.ui-language.v1:account:' + id, language); sessionStorage.setItem('logo-fixture-initialized', '1'); } window.__refreshDocumentId = crypto.randomUUID(); }, { id, language });
 await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
  if (url.origin === origin && request.resourceType() === 'document') state.documents++;
  const respond = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });
  if (url.origin === api) {
   state.requests.push(method + ' ' + path);
   if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
   if (path === '/auth/v1/token') { state.auth.push('sign-in'); return respond({ access_token: token, refresh_token: 'fixture-refresh-token', token_type: 'bearer', expires_in: 31536000, user }); }
   if (path === '/auth/v1/user') { state.auth.push('get-user'); return respond(user); }
   if (path === '/auth/v1/logout') { state.auth.push('sign-out'); return respond({}); }
   const rpc = path.split('/rest/v1/rpc/')[1];
   if (rpc === 'crm_access_snapshot') return respond(access);
   if (rpc === 'crm_admin_users') return respond({ users: [{ ...user, confirmed: true, active: true, generalAdmin: true, revision: 1, modules: grants, izordRole: 'admin', assignments: [], fonciereAssignments: [] }, target], invitations: [], projects: [], fonciereProjects: [], canAssignFonciere: true });
   if (rpc === 'crm_admin_save') { state.writes.push({ rpc, body: request.postDataJSON() }); state.saves++; state.saveEntered?.(); if (state.holdSave) await state.holdSave; Object.assign(target, { revision: 2, modules: request.postDataJSON().p_grants }); return respond(2); }
   if (rpc === 'crm_admin_history_page') return respond({ events: [], nextCursor: null, hasMore: false });
   if (rpc === 'fonciere_arbitrage_config') return respond({ revision: 1, vincent: id, annCharlotte: target.id });
   if (rpc === 'fonciere_arbitrage_list') return respond({ [projectId]: { status: 'pending', pending: ['vincent','ann_charlotte'], disagreement: false } });
   if (rpc === 'fonciere_arbitrage_read') return respond(arbitration);
   if (rpc === 'fonciere_access_options') return respond([]);
   if (rpc === 'crm_read_module') return respond({ revision: '2026-10-27T00:00:00Z', collections: payload });
   if (rpc === 'crm_reference_options') return respond({});
   if (rpc === 'crm_tasks_read' || rpc === 'crm_tasks_directory' || rpc === 'crm_tasks_for_target') return respond([]);
   if (rpc === 'crm_house_prepaid_state') return respond({ revision: 0, settings: [], packages: [], links: [], summaries: [] });
   if (rpc) { state.blocked.push(method + ' ' + path); return respond({ message: 'Unexpected fictitious RPC ' + rpc }, 400); }
   if (path === '/rest/v1/app_memberships') return respond([{ workspace_id: 'oar', role: 'member' }, { workspace_id: 'izord', role: 'admin' }]);
   if (path === '/rest/v1/crm_workspace_state' && method === 'PATCH') { state.writes.push({ rpc: 'workspace-update', body: request.postDataJSON() }); state.workspaceEntered?.(); if (state.holdWorkspace) await state.holdWorkspace; return respond({ message: 'Fictitious unconfirmed save', code: 'FAKE503' }, 503); }
   if (path === '/rest/v1/crm_workspace_state') return respond({ payload, updated_at: '2026-10-27T00:00:00Z' });
   if (path === '/rest/v1/fonciere_projects') return respond(url.searchParams.has('id') ? project : [project]);
   if (path === '/rest/v1/fonciere_assets') return respond([]);
   if (path === '/rest/v1/fonciere_project_contacts') return respond(null);
   if (['/rest/v1/izord_projects','/rest/v1/izord_project_versions','/rest/v1/contact_bank_accounts'].includes(path)) return respond([]);
   state.blocked.push(method + ' ' + path); return respond({ message: 'Unexpected fictitious resource' }, 400);
  }
  if (url.origin === origin && path === '/api/fonciere/drive') {
   if (method === 'POST') { state.writes.push({ rpc: 'drive-retry', body: request.postDataJSON() }); state.transfers++; state.driveEntered?.(); if (state.holdDrive) await state.holdDrive; state.driveStatus = 'synced'; return respond({ accepted: true }); }
   return respond({ configured: true, projectId, status: state.driveStatus, files: [], canRetry: state.driveStatus === 'retry', canOpen: false });
  }
  if (url.origin === origin && path.startsWith('/api/')) { state.blocked.push(method + ' ' + path); return respond({ error: 'Fictitious API disabled' }, 403); }
  if (url.origin === origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
  state.blocked.push(method + ' ' + url.origin + path); return route.abort('blockedbyclient');
 });
 const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
 await page.goto(origin + path); await page.locator('input[type=email]').first().fill(user.email); await page.locator('input[autocomplete=current-password]').fill('fictitious-password'); await page.getByRole('button', { name: /^(Se connecter|Sign in)$/ }).click();
 await page.locator('.crm-shell:visible').waitFor({ timeout: 90000 });
 const logo = () => page.getByRole('button', { name: language === 'fr' ? 'Actualiser le CRM' : 'Refresh CRM', exact: true }).filter({ visible: true });
 if (expectLogo) await logo().first().waitFor(); if (full && path.startsWith('/?')) await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' }); await wait(150);
 return { page, context, state, user, logo, language };
}
async function identity(page) { return page.evaluate(() => ({ id: window.__refreshDocumentId, url: location.href, language: document.documentElement.lang, storage: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('sb-') || key.includes('ui-language')).map(key => [key, localStorage.getItem(key)])) })); }
async function reload(run, key = null) {
 const before = await identity(run.page), reads = run.state.requests.length;
 const loaded = run.page.waitForEvent('load'); if (key === 'repeat') await run.logo().first().evaluate(button => { button.click(); button.click(); button.click(); }); else if (key) { await run.logo().first().focus(); await run.logo().first().press(key); } else await run.logo().first().click(); await loaded; await run.logo().first().waitFor(); if (await run.page.locator('[data-retained-crm-host]:visible').count()) await run.page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' });
 const after = await identity(run.page); assert.notEqual(after.id, before.id, 'new document'); assert.equal(after.url, before.url, 'entire current URL'); assert.deepEqual(after.storage, before.storage, 'session and language storage'); assert.equal(await run.page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload'); assert(run.state.requests.length > reads, 'server-backed module reads restarted'); assert(!run.state.auth.includes('sign-out')); assert.equal(await run.page.locator('input[autocomplete=current-password]:visible').count(), 0, 'still signed in');
}
function dialogs(run, accept = false) { const seen = []; const handler = async dialog => { seen.push({ type: dialog.type(), message: dialog.message() }); if (accept || dialog.type() === 'alert') await dialog.accept(); else await dialog.dismiss(); }; run.page.on('dialog', handler); return { seen, dispose: () => run.page.off('dialog', handler) }; }
async function cancel(run, field, expected) { const before = await identity(run.page), d = dialogs(run); await run.logo().first().click(); await wait(150); assert.equal((await identity(run.page)).id, before.id); assert.equal(run.page.url(), before.url); assert.equal(await field.inputValue(), expected); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'confirm'); assert.match(d.seen[0].message, /non enregistrées.*perdues|unsaved.*lost/i); d.dispose(); }
try {
 await test('Desktop FR classic CRM: actual reload retains full URL, account, language, logo image dimensions; no business save', async () => {
  const run = await session(); try { await run.page.locator('.contact-create-form').first().waitFor(); const img = run.logo().first().locator('img'); const box = await img.boundingBox(); assert(box.width > 0 && box.height > 0); const d = dialogs(run, true); await reload(run); assert.deepEqual(await run.logo().first().locator('img').boundingBox(), box); assert.equal(d.seen.length, 0); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Desktop EN native Administration: Space and Enter reload; dirty cancel preserves input, confirmed refresh gives exactly one warning', async () => {
  const run = await session({ language: 'en', path: '/admin?fixture=full%20url&order=2#admin-record' }); try { await run.page.locator('.unified-admin').waitFor(); await reload(run, 'Space'); await run.page.locator('.unified-user').filter({ hasText: 'refresh-target@example.invalid' }).click(); const select = run.page.locator('[data-admin-module=contacts] select'); await select.selectOption('read'); await cancel(run, select, 'read'); const d = dialogs(run, true); await reload(run, 'Enter'); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'confirm'); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Classic contact dirty input: cancel keeps complete value and URL; confirm reloads once without business autosave', async () => {
  const run = await session(); try { const field = run.page.locator('.contact-create-form:visible input[name=name]').first(); await field.fill('Saisie fictive — préservée intégralement'); await cancel(run, field, 'Saisie fictive — préservée intégralement'); const d = dialogs(run, true); await reload(run); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'confirm'); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Existing browser reload protection remains active after cancelling a logo refresh', async () => {
  const run = await session(); try { const field = run.page.locator('.contact-create-form:visible input[name=name]').first(); await field.fill('Protection navigateur fictive'); await cancel(run, field, 'Protection navigateur fictive'); const before = await identity(run.page), d = dialogs(run); await run.page.reload({ timeout: 1000 }).catch(error => assert.match(error.message, /ERR_ABORTED|aborted|Timeout/i)); await wait(150); assert.equal((await identity(run.page)).id, before.id); assert.equal(await field.inputValue(), 'Protection navigateur fictive'); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'beforeunload'); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Mobile/tablet 768px EN full CRM: existing mobile logo, native button semantics, keyboard focus and Enter reload', async () => {
  const run = await session({ language: 'en', mobile: true, path: '/?module=contacts&mobile=1#kept' }); try { assert.equal(await run.logo().count(), 1); assert.equal(await run.logo().first().getAttribute('type'), 'button'); await run.logo().first().focus(); await run.page.keyboard.press('Tab'); await run.page.keyboard.press('Shift+Tab'); assert(await run.logo().first().evaluate(node => node === document.activeElement)); const focus = await run.logo().first().evaluate(node => ({ width: getComputedStyle(node).outlineWidth, style: getComputedStyle(node).outlineStyle })); assert.notEqual(focus.style, 'none'); assert(parseFloat(focus.width) >= 2); const d = dialogs(run, true); await reload(run, 'Enter'); assert.equal(d.seen.length, 0); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Phone 390px: existing header remains compact with no newly displayed logo or overflow', async () => {
  const run = await session({ mobile: true, width: 390, expectLogo: false }); try { await run.page.locator('.contact-create-form').first().waitFor(); assert.equal(await run.logo().count(), 0); assert(await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); } finally { await run.context.close(); }
 });
 await test('Restricted desktop CRM: common navigation logo actually reloads and retains account/module/URL', async () => {
  const run = await session({ profile: 'restricted', path: '/?module=contacts&restricted=1#kept' }); try { await run.page.locator('.business-workspace').waitFor(); const d = dialogs(run, true); await reload(run); assert.equal(d.seen.length, 0); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Native Fonciere: rapid repeated logo clicks reload only once and retain project URL/record', async () => {
  const run = await session({ path: '/fonciere?project=' + projectId + '&fixture=native#fonciere-section-identity' }); try { await run.page.locator('#fonciere-name').waitFor(); assert.equal(await run.page.locator('#fonciere-name').inputValue(), data.data.name); const d = dialogs(run, true); const documents = run.state.documents; await reload(run, 'repeat'); assert.equal(run.state.documents, documents + 1, 'Repeated synchronous logo clicks request only one new document'); await run.page.locator('#fonciere-name').waitFor(); assert.equal(await run.page.locator('#fonciere-name').inputValue(), data.data.name); assert.equal(d.seen.length, 0); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 await test('Clean visible Administration still warns for an arbitration remark retained in the background Fonciere view', async () => {
  const run = await session({ path: '/fonciere?project=' + projectId }); try { const remark = run.page.locator('#arbitrage-remark-vincent'); await remark.waitFor(); await remark.fill('Remarque seule en arrière-plan'); const navigation = dialogs(run, true); await run.page.locator('[data-navigation-module=admin]:visible').click(); await run.page.locator('.unified-admin:visible').waitFor(); navigation.dispose(); assert.equal(navigation.seen.length, 1); await cancel(run, remark, 'Remarque seule en arrière-plan'); const d = dialogs(run, true); await reload(run); assert.equal(d.seen.length, 1); assert.equal(run.state.writes.length, 0); d.dispose(); } finally { await run.context.close(); }
 });
 for (const profile of ['full','restricted']) await test('Retained Project → Contact (' + profile + '): hidden project remark, edits and pending file survive cancel; confirmed reload warns once', async () => {
  const run = await session({ profile, path: '/fonciere?project=' + projectId }); try {
   const name = run.page.locator('#fonciere-name'); await name.waitFor(); const remark = run.page.locator('#arbitrage-remark-vincent'); await remark.waitFor(); await remark.fill('Remarque fictive non enregistrée');
   await run.page.locator('input[type=file][aria-label="Ajouter des documents"]').setInputFiles({ name: 'plan-fictif.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfictitious-only') });
   await name.fill('Projet en arrière-plan'); await run.page.getByRole('button', { name: 'Créer un contact', exact: true }).click(); await run.page.locator('[data-retained-project-host][hidden]').waitFor({ state: 'attached' });
   const field = run.page.locator('.contact-create-form:visible input[name=name]').first(); await field.waitFor(); await cancel(run, field, ''); await field.fill('Contact provisoire fictif'); await cancel(run, field, 'Contact provisoire fictif');
   assert.equal(await name.inputValue(), 'Projet en arrière-plan'); assert.equal(await remark.inputValue(), 'Remarque fictive non enregistrée'); assert.match(normalize(await run.page.locator('[data-retained-project-host]').textContent()), /plan-fictif\.pdf/);
   const d = dialogs(run, true); await reload(run); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'confirm'); assert.equal(run.state.writes.length, 0); d.dispose();
  } finally { await run.context.close(); }
 });
 await test('Drive transfer retry request: logo blocks while POST is pending and refresh never replays the admitted retry', async () => {
  const run = await session({ path: '/fonciere?project=' + projectId }); try {
   await run.page.locator('#fonciere-name').waitFor(); const drive = run.page.locator('[data-project-drive]'), retry = drive.getByRole('button', { name: 'Réessayer la copie', exact: true }); await retry.waitFor();
   let release; run.state.holdDrive = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { run.state.driveEntered = resolve; }); const before = await identity(run.page), d = dialogs(run, true);
   await retry.click(); await deadline(entered); await run.logo().first().click(); assert.equal((await identity(run.page)).id, before.id); assert.equal(d.seen.length, 1); assert.equal(d.seen[0].type, 'alert'); release(); await drive.getByText('Synchronisé avec Google Drive', { exact: true }).waitFor(); const count = d.seen.length; await reload(run); assert.equal(d.seen.length, count); assert.equal(run.state.transfers, 1); assert.equal(run.state.writes.length, 1); d.dispose();
  } finally { await run.context.close(); }
 });
 await test('Full CRM house save: refresh blocked while request is pending; failed response retains form and refresh warning without retry', async () => {
  const run = await session({ path: '/?module=houseTracking&fixture=failed-save#kept' }); try {
   await run.page.locator('.shared-db-status-panel.connected').waitFor(); await run.page.locator('.house-tabs button').last().click(); const form = run.page.locator('form.house-compact-form').filter({ has: run.page.locator('input[name=name]') }), field = form.locator('input[name=name]'); await field.fill('Maison fictive non confirmée');
   let release; run.state.holdWorkspace = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { run.state.workspaceEntered = resolve; }); const before = await identity(run.page), busyDialogs = dialogs(run, true);
   await form.locator('button[type=submit]').click(); await deadline(entered); await run.logo().first().click(); assert.equal((await identity(run.page)).id, before.id); assert.equal(busyDialogs.seen.length, 1); assert.equal(busyDialogs.seen[0].type, 'alert'); release(); await form.getByRole('alert').waitFor(); busyDialogs.dispose();
   assert.equal(await field.inputValue(), 'Maison fictive non confirmée'); await cancel(run, field, 'Maison fictive non confirmée'); const d = dialogs(run, true); await reload(run); assert.equal(d.seen.length, 1); assert.equal(run.state.writes.length, 1, 'Only the explicit failed save, with no automatic retry or replay'); d.dispose();
  } finally { await run.context.close(); }
 });
 await test('Saving Administration: repeated logo clicks are blocked; admitted save finishes once, no silent interruption or replay after later refresh', async () => {
  const run = await session({ path: '/admin?fixture=save#held' }); try {
   await run.page.locator('.unified-user').filter({ hasText: 'refresh-target@example.invalid' }).click(); await run.page.locator('[data-admin-module=contacts] select').selectOption('read');
   let release; run.state.holdSave = new Promise(resolve => { release = resolve; }); const entered = new Promise(resolve => { run.state.saveEntered = resolve; });
   const d = dialogs(run, true), before = await identity(run.page);
   await run.page.locator('.unified-admin > section').nth(1).getByRole('button', { name: 'Enregistrer', exact: true }).click(); await deadline(entered);
   await run.logo().first().click(); await run.logo().first().click(); assert.equal((await identity(run.page)).id, before.id); assert.equal(run.state.saves, 1); assert(d.seen.length >= 1); assert(d.seen.every(dialog => dialog.type === 'alert')); assert(d.seen.every(dialog => /en cours|in progress|finish/i.test(dialog.message)));
   release(); await run.page.getByText('Droits enregistrés et confirmés par le serveur.', { exact: true }).waitFor(); await wait(200); const count = d.seen.length; await reload(run); assert.equal(d.seen.length, count); assert.equal(run.state.saves, 1); assert.equal(run.state.writes.length, 1); d.dispose();
  } finally { await run.context.close(); }
 });
} finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); report(); }
if (results.some(result => !result.passed) || errors.length || audits.some(state => state.blocked.length)) process.exitCode = 1;
