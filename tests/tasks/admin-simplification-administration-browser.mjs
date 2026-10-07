/** Administration UI on an isolated local app with real fictional Auth/accounts
 * and crm_admin_users/access_snapshot reads. History pages and transport faults
 * are explicit UI fixtures; server authorization/keyset proof is a separate test.
 * Invitation POSTs are intercepted before transport. No business mutation, mail,
 * Google call, production call, fabricated session or fixture privilege change.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
for (const key of ['TASKS_STATUS_FILE', 'TASKS_FIXTURE_FILE', 'TASKS_APP_MANIFEST']) assert.ok(process.env[key], key + ' required');
assert.equal(process.env.TASKS_TEST_ACK, 'TASKS_DISPOSABLE_LOCAL_ONLY');
const status = JSON.parse(readFileSync(process.env.TASKS_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.TASKS_FIXTURE_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(process.env.TASKS_APP_MANIFEST, 'utf8'));
const api = status.API_URL, app = manifest.app;
for (const [value, port] of [[api, '55731'], [status.DB_URL, '55732'], [app, '3200']]) {
  const url = new URL(value); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, port);
}
assert.equal(manifest.status, 'ready'); assert.equal(manifest.reviewMode, true);
assert.notEqual(resolve(manifest.sourceRoot), resolve(manifest.directory));
assert.ok(manifest.candidateBaseSHA.startsWith('39aa898'));
const hash = value => createHash('sha256').update(value).digest('hex');
for (const entry of manifest.sourceFiles) {
  assert.equal(hash(readFileSync(join(manifest.directory, entry.path))), entry.sha256, 'Served source: ' + entry.path);
  assert.equal(hash(readFileSync(join(manifest.sourceRoot, entry.path))), entry.sha256, 'Candidate source: ' + entry.path);
}
const out = process.env.TASKS_ADMIN_BROWSER_OUTPUT || '/private/tmp/oar-tasks-admin-state/administration-browser';
mkdirSync(out, { recursive: true, mode: 0o700 });
const results = [];
const historyURL = '**/rest/v1/rpc/crm_admin_history_page';
const bigId = 900719925474112100n;
function events(count, action = 'access_saved') {
  return Array.from({ length: count }, (_, index) => ({ id: String(bigId + BigInt(count - index)), created_at: '2026-10-07T08:15:00.000Z', action: action + ':' + (index + 1), actor_id: fixture.users.creator.id, subject_id: fixture.users.contributor.id }));
}
function pageOf(all, args) {
  assert.equal(args.p_limit, 50, 'Bounded UI page');
  assert.equal(args.p_before_id === null, args.p_snapshot_id === null, 'Cursor and anchor travel together');
  const anchor = args.p_snapshot_id ?? all[0]?.id;
  const remaining = all.filter(event => BigInt(event.id) <= BigInt(anchor) && (args.p_before_id === null || BigInt(event.id) < BigInt(args.p_before_id)));
  const page = remaining.slice(0, 50), hasMore = remaining.length > 50;
  return { events: page, hasMore, nextCursor: hasMore ? { beforeId: page.at(-1).id, snapshotId: anchor } : null };
}
async function until(fn, label) { for (let n = 0; n < 120; n++) { if (await fn()) return; await new Promise(resolveWait => setTimeout(resolveWait, 50)); } throw new Error(label); }

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function open({ count = 4, width = 1440, role = 'creator' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', hasTouch: width === 390 });
  const state = { events: events(count), paths: [], historyArgs: [], errors: [], blocked: [], sentInvitations: [], hold: null, historyFault: null };
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([api, app].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    state.blocked.push(url.origin); return route.abort();
  });
  if (context.routeWebSocket) await context.routeWebSocket('**', socket => { const url = new URL(socket.url()); if (url.origin === app.replace('http:', 'ws:')) socket.connectToServer(); else socket.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('request', request => state.paths.push({ method: request.method(), path: new URL(request.url()).pathname }));
  await page.route(historyURL, async route => {
    const args = route.request().postDataJSON(); state.historyArgs.push(args);
    const response = pageOf(state.events, args), fault = state.historyFault;
    if (fault && args.p_before_id !== null) { state.historyFault = null; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Explicit local UI history interruption' }) }); }
    if (state.hold && args.p_before_id !== null) { const held = state.hold; state.hold = null; held.arrived(args); await held.gate; }
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) }); } catch { /* The retiring account can abort its transport. */ }
  });
  await page.route(app + '/api/access/invite', async route => {
    assert.equal(route.request().method(), 'POST'); const body = route.request().postDataJSON();
    assert.ok(body.email.endsWith('@example.invalid')); state.sentInvitations.push(body);
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Transport fictif interrompu : saisie conservée.' }) });
  });
  async function login(nextRole = role) {
    const user = fixture.users[nextRole]; await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    if (nextRole === 'noTasks') await page.getByRole('heading', { name: 'Tableau de bord', exact: true }).waitFor({ timeout: 90000 });
    else { await page.getByRole('heading', { name: 'Utilisateurs et accès', exact: true }).waitFor({ timeout: 90000 }); await page.getByRole('button', { name: fixture.users.contributor.email, exact: false }).waitFor(); await ready(page); }
  }
  await page.goto(app + '/admin'); await login();
  return { context, page, state, width, login };
}
const history = page => page.locator('[data-admin-history]');
const shown = page => history(page).locator('[data-admin-history-event]');
async function ready(page) { await until(async () => await history(page).getByText('Chargement de l’historique…', { exact: true }).count() === 0, 'History reply confirmed in UI'); }
function holdNext(state) {
  let release, arrived;
  const gate = new Promise(resolveGate => { release = resolveGate; }), received = new Promise(resolveArrived => { arrived = resolveArrived; });
  state.hold = { gate, arrived }; return { release, received };
}
async function clean(f) {
  assert.deepEqual(f.state.blocked, [], 'Loopback only'); assert.deepEqual(f.state.errors, [], 'No runtime/hydration error');
  assert.ok(!f.state.paths.some(entry => /crm_tasks_(admin_(directory|identity)|identity|legacy)/.test(entry.path)), 'Removed Administration panel never calls historical identity RPCs');
  assert.equal(await f.page.locator('[data-task-identity-admin]').count(), 0, 'Historical identity panel is not mounted');
  assert.equal(await f.page.getByRole('heading', { name: 'Identités et reprise Tâches', exact: true }).count(), 0);
  assert.ok(!f.state.paths.some(entry => /crm_admin_save|crm_invite_prepare|crm_mutate_record|crm_tasks_mutate|\/storage\//.test(entry.path)), 'No business or invitation backend writes');
}
async function completeEvents(f, count) {
  assert.equal(await shown(f.page).count(), count);
  for (const element of await shown(f.page).all()) {
    assert.equal(await element.locator('time').getAttribute('datetime'), '2026-10-07T08:15:00.000Z');
    const text = await element.innerText(); assert.ok(text.includes('Auteur : ' + fixture.users.creator.email)); assert.ok(text.includes('Action : access_saved:')); assert.ok(text.includes('Destinataire : ' + fixture.users.contributor.email));
  }
}
async function check(name, fn) {
  if (process.env.TASKS_ADMIN_BROWSER_FILTER && !name.includes(process.env.TASKS_ADMIN_BROWSER_FILTER)) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); process.exitCode = 1; console.log('FAIL ' + name + ': ' + error.message); }
  finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ passed: results.every(result => result.passed), results, candidateBaseSHA: manifest.candidateBaseSHA, sourceRoot: manifest.sourceRoot, actualLocalAuth: true, actualAdminUsersRPC: true, actualAccessSnapshotRPC: true, historyRepliesSimulated: true, simulatedFaults: ['history page 503', 'delayed history page', 'invitation HTTP503 intercepted before transport'], businessWrites: 0, actualInvitationTransportCalls: 0, googleCalls: 0, productionCalls: 0, physicalDevice: false }, null, 2) + '\n', { mode: 0o600 }); }
}

try {
  for (const count of [0, 1, 3, 4]) await check(count + ' events: complete latest three, conditional toggle and no identity panel', async () => {
    for (const width of count === 4 ? [1440, 390] : [1440]) {
    const f = await open({ count, width });
    try {
      await completeEvents(f, Math.min(3, count));
      assert.equal(await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).count(), count > 3 ? 1 : 0);
      assert.equal(await history(f.page).getByRole('button', { name: 'Réduire l’historique', exact: true }).count(), 0);
      if (count === 0) assert.equal(await history(f.page).getByText('Aucun changement enregistré.', { exact: true }).count(), 1);
      if (count === 4) { await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await completeEvents(f, 4); await history(f.page).getByRole('button', { name: 'Réduire l’historique', exact: true }).click(); await completeEvents(f, 3); }
      assert.equal(await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).count(), 0);
      if (count === 4) await history(f.page).screenshot({ path: join(out, 'history-compact-' + width + '.png') });
      await clean(f);
    } finally { await f.context.close(); }
    }
  });
  for (const width of [1440, 390]) await check('121 events at ' + width + ': stable string cursor, 50/100/121 pages, repli preserves loaded pages and access reads', async () => {
    const f = await open({ count: 121, width });
    try {
      await completeEvents(f, 3); const usersReads = f.state.paths.filter(entry => entry.path.endsWith('/crm_admin_users')).length;
      assert.ok((await history(f.page).innerText()).includes('sur 50 chargés. Des événements plus anciens restent à charger.'));
      assert.ok(!(await history(f.page).innerText()).includes('Historique entièrement chargé.'));
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await completeEvents(f, 50);
      await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await ready(f.page); await completeEvents(f, 100);
      await history(f.page).getByRole('button', { name: 'Réduire l’historique', exact: true }).click(); await completeEvents(f, 3);
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await completeEvents(f, 100);
      await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await ready(f.page); await completeEvents(f, 121);
      const ids = await shown(f.page).evaluateAll(elements => elements.map(element => element.getAttribute('data-admin-history-event')));
      assert.deepEqual(ids, f.state.events.map(event => event.id)); assert.equal(new Set(ids).size, 121);
      const continued = f.state.historyArgs.filter(args => args.p_before_id !== null); assert.equal(continued.length, 2);
      assert.equal(continued[0].p_before_id, f.state.events[49].id); assert.equal(continued[1].p_before_id, f.state.events[99].id); assert.equal(continued[0].p_snapshot_id, f.state.events[0].id); assert.equal(continued[1].p_snapshot_id, f.state.events[0].id);
      assert.equal(f.state.paths.filter(entry => entry.path.endsWith('/crm_admin_users')).length, usersReads, 'Pagination does not reload users/grants');
      assert.equal(await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).count(), 0);
      assert.ok((await history(f.page).innerText()).includes('121 événements chargés. Historique entièrement chargé.'));
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
      await history(f.page).screenshot({ path: join(out, 'history-' + width + '.png') }); await clean(f);
    } finally { await f.context.close(); }
  });
  await check('Pagination error retains loaded events and retries the same anchored page without access reload', async () => {
    const f = await open({ count: 121 });
    try {
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); f.state.historyFault = true;
      await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click();
      await history(f.page).getByRole('button', { name: 'Réessayer le chargement de l’historique', exact: true }).waitFor(); await completeEvents(f, 50);
      const failedArgs = f.state.historyArgs.at(-1); await history(f.page).getByRole('button', { name: 'Réduire l’historique', exact: true }).click(); await completeEvents(f, 3);
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await history(f.page).getByRole('button', { name: 'Réessayer le chargement de l’historique', exact: true }).click(); await ready(f.page); await completeEvents(f, 100);
      assert.deepEqual(f.state.historyArgs.at(-1), failedArgs); await clean(f);
    } finally { await f.context.close(); }
  });
  await check('History expansion/pagination preserves dirty access fields, user selection guard and navigation guard', async () => {
    const f = await open({ count: 121 });
    try {
      await f.page.getByRole('button', { name: fixture.users.contributor.email, exact: false }).click();
      const field = f.page.getByLabel('Droit Contacts', { exact: true }), original = await field.inputValue(); await field.selectOption(original === 'read' ? 'contribute' : 'read'); const edited = await field.inputValue();
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await ready(f.page);
      assert.equal(await field.inputValue(), edited); await history(f.page).getByRole('button', { name: 'Réduire l’historique', exact: true }).click(); assert.equal(await field.inputValue(), edited);
      let dialogs = 0; const dismiss = async dialog => { dialogs++; await dialog.dismiss(); }; f.page.on('dialog', dismiss);
      await f.page.getByRole('button', { name: fixture.users.reader.email, exact: false }).click(); assert.equal(await field.inputValue(), edited);
      await f.page.getByRole('button', { name: 'Inviter un utilisateur', exact: true }).click(); assert.equal(await field.inputValue(), edited);
      await f.page.getByRole('button', { name: 'Contacts', exact: true }).first().click(); assert.equal(new URL(f.page.url()).pathname, '/admin'); assert.equal(await field.inputValue(), edited);
      await f.page.getByRole('button', { name: 'Déconnexion', exact: true }).first().click(); assert.equal(await field.inputValue(), edited); assert.equal(dialogs, 4);
      f.page.off('dialog', dismiss); await f.page.getByRole('button', { name: 'Annuler et recharger', exact: true }).click(); await ready(f.page); assert.equal(await f.page.getByRole('button', { name: 'Enregistrer', exact: true }).count(), 0);
      await clean(f);
    } finally { await f.context.close(); }
  });
  await check('Invitation draft remains dirty through history, canceled navigation and simulated transport failure; no mail sent', async () => {
    const f = await open({ count: 121 });
    try {
      await f.page.getByRole('button', { name: 'Inviter un utilisateur', exact: true }).click(); const field = f.page.getByLabel('Email du destinataire', { exact: true }); const draft = 'admin-draft-only@example.invalid'; await field.fill(draft);
      await f.page.getByLabel('Droit Contacts', { exact: true }).selectOption('read');
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await ready(f.page);
      let dialogs = 0; const dismiss = async dialog => { dialogs++; await dialog.dismiss(); }; f.page.on('dialog', dismiss);
      await f.page.getByRole('button', { name: 'Contacts', exact: true }).first().click(); await f.page.getByRole('button', { name: 'Déconnexion', exact: true }).first().click(); assert.equal(dialogs, 2); f.page.off('dialog', dismiss);
      await f.page.getByRole('button', { name: 'Envoyer l’invitation', exact: true }).click(); await f.page.getByText('Transport fictif interrompu : saisie conservée.', { exact: true }).waitFor(); assert.equal(await field.inputValue(), draft); assert.equal(await f.page.getByLabel('Droit Contacts', { exact: true }).inputValue(), 'read'); assert.equal(f.state.sentInvitations.length, 1);
      f.page.once('dialog', async dialog => { dialogs++; await dialog.dismiss(); }); await f.page.getByRole('button', { name: 'Déconnexion', exact: true }).first().click(); assert.equal(dialogs, 3); assert.equal(await field.inputValue(), draft);
      await clean(f);
    } finally { await f.context.close(); }
  });
  await check('Reload replaces the history generation and ignores a delayed older-page reply', async () => {
    const f = await open({ count: 121 }); let held;
    try {
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); held = holdNext(f.state); await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await held.received;
      f.state.events = events(4, 'reloaded_snapshot'); await f.page.getByRole('button', { name: fixture.users.reader.email, exact: false }).click(); await f.page.getByRole('button', { name: 'Annuler et recharger', exact: true }).click(); await ready(f.page);
      held.release(); await f.page.waitForTimeout(200); assert.equal(await shown(f.page).count(), 3); assert.ok((await history(f.page).innerText()).includes('Action : reloaded_snapshot:1')); assert.ok(!(await history(f.page).innerText()).includes('Action : access_saved:'));
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); assert.equal(await shown(f.page).count(), 4); await clean(f);
    } finally { held?.release(); await f.context.close(); }
  });
  await check('Logout and another fictional account discard a delayed private history reply', async () => {
    const f = await open({ count: 121 }); let held;
    try {
      await history(f.page).getByRole('button', { name: 'Voir tout l’historique', exact: true }).click(); held = holdNext(f.state); await history(f.page).getByRole('button', { name: 'Charger les événements plus anciens', exact: true }).click(); await held.received;
      const logout = f.page.waitForResponse(response => new URL(response.url()).pathname === '/auth/v1/logout');
      await f.page.getByRole('button', { name: 'Déconnexion', exact: true }).first().click(); assert.ok((await logout).ok()); await until(async () => await f.page.getByLabel('Email', { exact: true }).isVisible().catch(() => false), 'Auth logout completed and login form is ready'); await f.page.waitForLoadState('domcontentloaded'); assert.equal(await history(f.page).count(), 0);
      f.state.events = events(4, 'another_account_snapshot'); await f.page.goto(app + '/admin'); await f.login('fullOther'); held.release(); await f.page.waitForTimeout(200);
      assert.ok((await history(f.page).innerText()).includes('Action : another_account_snapshot:1')); assert.ok(!(await history(f.page).innerText()).includes('Action : access_saved:')); assert.equal(await shown(f.page).count(), 3); await clean(f);
    } catch (error) { await f.page.screenshot({ path: join(out, 'logout-failure.png'), fullPage: true }).catch(() => {}); writeFileSync(join(out, 'logout-failure.txt'), await f.page.locator('body').innerText().catch(() => 'Page retired'), { mode: 0o600 }); throw error; }
    finally { held?.release(); await f.context.close(); }
  });
} finally { await browser.close(); }
assert.ok(results.every(result => result.passed), 'All targeted Administration UI cases must pass');
console.log(JSON.stringify({ passed: true, groups: results.length, artifacts: out, historyBoundary: 'Simulated pages on actual fictional local Auth/Admin user reads; backend authorization verified separately' }));
