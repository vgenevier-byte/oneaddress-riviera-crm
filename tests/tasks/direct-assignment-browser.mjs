/** Targeted direct-assignment UI proof. Real isolated Auth/RPC/database only.
 * Loading holds an actual directory reply; 503/empty replies are explicit UI
 * fault injections. No repository env, existing fixtures, Admin journey or
 * external service is used. Own fictional accounts/tasks are cleaned up.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { assertDirectTasksTarget } from './direct-local-target.mjs';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
for (const key of ['TASKS_STATUS_FILE', 'TASKS_APP_MANIFEST']) assert.ok(process.env[key], key + ' required');
const status = JSON.parse(readFileSync(process.env.TASKS_STATUS_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(process.env.TASKS_APP_MANIFEST, 'utf8'));
const api = status.API_URL, app = manifest.app;
assertDirectTasksTarget({ api, database: status.DB_URL, app, acknowledgement: process.env.TASKS_TEST_ACK });
assert.equal(manifest.status, 'ready'); assert.equal(manifest.reviewMode, true);
assert.notEqual(resolve(manifest.sourceRoot), resolve(process.cwd()));
assert.equal(manifest.candidateBaseSHA, 'aeadd4c6999755001da34f60f85a028be30e59ca');
const hash = value => createHash('sha256').update(value).digest('hex');
for (const entry of manifest.sourceFiles) {
  assert.equal(hash(readFileSync(join(manifest.directory, entry.path))), entry.sha256, 'Served source: ' + entry.path);
  assert.equal(hash(readFileSync(join(manifest.sourceRoot, entry.path))), entry.sha256, 'Candidate source: ' + entry.path);
}
const output = process.env.TASKS_DIRECT_BROWSER_OUTPUT || '/private/tmp/oar-tasks-direct-state/browser';
mkdirSync(output, { recursive: true, mode: 0o700 });
const run = Date.now().toString(36), prefix = 'direct-browser-' + run;
const sql = new Client({ connectionString: status.DB_URL });
await sql.connect();
assert.equal((await sql.query("select count(*)::int n from auth.users where email is null or email not like '%@example.invalid'")).rows[0].n, 0);
const originalRecords = (await sql.query('select * from app_private.task_records order by id')).rows;
const originalAssignments = (await sql.query('select * from app_private.task_assignments order by task_id,user_id')).rows;
const users = {}, results = [];
const filter = process.env.TASKS_DIRECT_BROWSER_FILTER;
let browser, cleanupPassed = false;
const resultFile = join(output, 'direct-assignment-browser-results.json');
function save() { writeFileSync(resultFile, JSON.stringify({ results, candidateBaseSHA: manifest.candidateBaseSHA, sourceRoot: manifest.sourceRoot, sourceManifest: process.env.TASKS_APP_MANIFEST, sourceFiles: manifest.sourceFiles.length, actualLocalAuth: true, actualLocalRPC: true, actualLocalDatabase: true, simulatedFaults: ['held actual directory response', 'HTTP 503 directory response', 'empty directory response'], externalCalls: 0, productionWrites: 0, physicalDevice: false, adminJourney: false, cleanupPassed }, null, 2) + '\n', { mode: 0o600 }); }
async function check(name, fn) { if (filter && !name.includes(filter)) return; try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, passed: false, error: error.message }); process.exitCode = 1; console.log('FAIL ' + name + ': ' + error.message); } finally { save(); } }
async function authRequest(path, body, method = 'POST') {
  const response = await fetch(api + path, { method, headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + status.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error' });
  const data = await response.json(); assert.ok(response.ok, 'Local fictional account operation failed (' + response.status + ')'); return data;
}
async function createUser(role, name, level = 'contribute') {
  const email = prefix + '-' + role + '@example.invalid', password = 'Local-Direct-Fiction-' + randomUUID() + '!';
  const account = await authRequest('/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: name ? { full_name: name } : {} });
  users[role] = { id: account.id, email, password, label: name || email };
  await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,false)', [account.id]);
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')", [account.id]);
  await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'tasks',$2,'{}')", [account.id, level]);
  assert.equal((await sql.query('select count(*)::int n from app_private.task_identity_links where user_id=$1', [account.id])).rows[0].n, 0);
}
async function waitUntil(fn, label = 'Expected confirmed state') { for (let n = 0; n < 140; n++) { const result = await fn(); if (result) return result; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } throw new Error(label); }
async function open(role, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const audit = { blocked: [], errors: [], paths: [], mutations: [] };
  await context.route('**/*', route => { const url = new URL(route.request().url()); if ([api, app].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol)) return route.continue(); audit.blocked.push(url.origin); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; audit.paths.push(path); if (path === '/rest/v1/rpc/crm_tasks_mutate') audit.mutations.push(request.postDataJSON()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(app + '/?module=tasks');
  await page.getByLabel('Email', { exact: true }).fill(users[role].email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(users[role].password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('[data-task-workspace]').waitFor({ timeout: 45000 });
  await waitUntil(async () => !await page.locator('.taskws').getByRole('button', { name: 'Actualiser', exact: true }).isDisabled());
  return { context, page, audit };
}
const recipient = (dialog, role) => dialog.locator(`[data-task-recipient-id="${users[role].id}"]`);
const card = (page, id) => page.locator(`[data-task-id="${id}"]`);
async function begin(page, title) { await page.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Ajouter une tâche', exact: true }); await dialog.locator('[name=title]').fill(title); return dialog; }
async function fields(dialog, expected) { for (const [field, value] of Object.entries(expected)) assert.equal(await dialog.locator(`[name=${field}]`).inputValue(), value, 'Draft field survives directory operation: ' + field); }
async function confirmedSave(page, dialog, create = true) {
  const reply = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/crm_tasks_mutate' && response.status() === 200);
  await dialog.getByRole('button', { name: create ? 'Créer la tâche' : 'Enregistrer', exact: true }).click();
  const task = await (await reply).json(); await dialog.waitFor({ state: 'detached' }); await card(page, task.id).waitFor(); return task;
}
async function clean(session) {
  assert.deepEqual(session.audit.blocked, [], 'Loopback requests only'); assert.deepEqual(session.audit.errors, [], 'No browser or hydration error');
  assert.ok(!session.audit.paths.some(path => path.startsWith('/admin') || /crm_tasks_(identity|legacy)/.test(path)), 'Direct assignment does not open Admin or historical RPC');
  assert.equal(await session.page.locator('[data-task-identity-admin]').count(), 0);
}
async function fits(page, dialog, width) {
  const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
  const metrics = await dialog.evaluate(element => {
    const container = element.getBoundingClientRect();
    return { width: element.clientWidth, scroll: element.scrollWidth, bounds: { x: container.x, width: container.width }, overflowing: [...element.querySelectorAll('*')].map(child => { const box = child.getBoundingClientRect(); return { tag: child.tagName, name: child.getAttribute('name'), class: child.className, x: box.x, width: box.width, scroll: child.scrollWidth, client: child.clientWidth }; }).filter(child => child.x + child.width > container.right - 1 || child.x < container.left + 1 || child.scroll > child.client + 1) };
  });
  if (metrics.scroll > metrics.width + 1) { writeFileSync(join(output, 'overflow-' + width + '.json'), JSON.stringify(metrics, null, 2)); await page.screenshot({ path: join(output, 'overflow-' + width + '.png'), fullPage: true }); }
  assert.ok(metrics.scroll <= metrics.width + 1, JSON.stringify(metrics)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const heading = await dialog.locator('.taskws-dialog-heading h2').boundingBox(); assert.ok(heading && heading.width >= 120, 'Dialog title remains readable beside its close button');
}
const directoryURL = '**/rest/v1/rpc/crm_tasks_directory';
async function interceptDirectory(page, mode) {
  let received, release;
  const arrived = new Promise(resolveArrived => { received = resolveArrived; });
  const gate = new Promise(resolveGate => { release = resolveGate; });
  await page.route(directoryURL, async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200, 'Actual local directory response before UI fault injection');
    const data = await response.json(); received(data);
    if (mode === 'hold') { await gate; try { await route.fulfill({ response }); } catch { /* Scope retirement may cancel the request. */ } }
    else if (mode === 'error') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated local directory interruption' }) });
    else await route.fulfill({ response, contentType: 'application/json', body: '[]' });
  }, { times: 1 });
  return { arrived, release };
}
async function directJourney(engine, width) {
  const s = await open('creator', width), { page } = s;
  try {
    assert.equal(await page.getByRole('button', { name: 'Administration', exact: true }).count(), 0, 'Ordinary contributor has no Admin entry');
    const held = await interceptDirectory(page, 'hold');
    const draft = { title: prefix + ' ' + engine + '-' + width, notes: 'Note fictive ligne 1\nLigne 2 conservée', dueDate: '2026-12-11', priority: 'urgent' };
    const dialog = await begin(page, draft.title); await held.arrived;
    await dialog.locator('[data-task-directory=loading]').waitFor();
    assert.ok((await dialog.innerText()).includes('Chargement des personnes éligibles'));
    await dialog.locator('[name=notes]').fill(draft.notes); await dialog.locator('[name=dueDate]').fill(draft.dueDate); await dialog.locator('[name=priority]').selectOption(draft.priority);
    await fields(dialog, draft); held.release(); await dialog.locator('[data-task-directory=ready]').waitFor();
    const search = dialog.getByLabel('Rechercher un responsable', { exact: true });
    await search.fill(users.a.email); assert.equal(await dialog.locator('[data-task-recipient-kind=eligible]').count(), 1);
    await recipient(dialog, 'a').getByRole('checkbox').check();
    await search.fill('elodie'); await recipient(dialog, 'b').waitFor();
    for (const role of ['a', 'b']) assert.ok((await recipient(dialog, role).innerText()).includes(users[role].email), 'Homonyms show distinct confirmed emails');
    await recipient(dialog, 'b').getByRole('checkbox').check();
    await search.fill('unmatched-fictitious-person'); assert.equal(await dialog.locator('[data-task-recipient-kind=eligible]').count(), 0); assert.ok((await dialog.innerText()).includes('2 responsables sélectionnés'));
    await search.fill(users.email.email); assert.ok((await recipient(dialog, 'email').innerText()).includes(users.email.email), 'Email fallback account is available without Contact link');
    await search.fill('');
    await interceptDirectory(page, 'error'); await dialog.getByRole('button', { name: 'Actualiser les personnes éligibles', exact: true }).click(); await dialog.locator('[data-task-directory=error]').waitFor();
    await fields(dialog, draft); for (const role of ['a', 'b']) assert.ok(await recipient(dialog, role).getByRole('checkbox').isChecked());
    const retry = await interceptDirectory(page, 'hold'); await dialog.getByRole('button', { name: 'Réessayer de charger les responsables', exact: true }).click(); await retry.arrived;
    await fields(dialog, draft); for (const role of ['a', 'b']) assert.ok(await recipient(dialog, role).getByRole('checkbox').isChecked()); retry.release(); await dialog.locator('[data-task-directory=ready]').waitFor();
    await search.fill('elodie'); await fits(page, dialog, width);
    await dialog.evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: join(output, engine + '-' + width + '-direct-form.png'), fullPage: true });
    await dialog.locator('[data-task-directory]').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, engine + '-' + width + '-direct-selection.png'), fullPage: true });
    const task = await confirmedSave(page, dialog);
    assert.equal(task.createdBy, users.creator.id); assert.equal(task.createdByLabel, users.creator.label);
    assert.deepEqual(task.assignees.map(person => person.userId).sort(), [users.a.id, users.b.id].sort());
    for (const field of ['title', 'notes', 'dueDate', 'priority']) assert.equal(task[field], draft[field]);
    const stored = (await sql.query('select * from app_private.task_records where id=$1', [task.id])).rows[0]; assert.equal(stored.creator_id, users.creator.id); assert.equal(stored.notes, draft.notes);
    for (const role of ['a', 'b']) { const participant = await open(role, width); try { await card(participant.page, task.id).waitFor(); assert.ok((await card(participant.page, task.id).innerText()).includes(draft.title)); await clean(participant); } finally { await participant.context.close(); } }
    await sql.query('update public.crm_access_profiles set active=false where user_id=$1', [users.b.id]);
    try {
      await card(page, task.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor();
      const retained = recipient(edit, 'b'); assert.equal(await retained.getAttribute('data-task-recipient-kind'), 'retained'); assert.ok((await retained.innerText()).includes(users.b.label)); assert.ok((await retained.innerText()).includes('Affectation conservée')); assert.ok(await retained.getByRole('checkbox').isChecked());
      await edit.locator('[name=notes]').fill(draft.notes + '\nAffectation inactive conservée'); const saved = await confirmedSave(page, edit, false); assert.ok(saved.assignees.some(person => person.userId === users.b.id && !person.active));
      assert.equal('assigneeIds' in s.audit.mutations.at(-1).p_patch, false, 'Other edits do not silently remove an inactive assignment');
    } finally { await sql.query('update public.crm_access_profiles set active=true where user_id=$1', [users.b.id]); }
    const empty = await interceptDirectory(page, 'empty'); const personal = await begin(page, draft.title + ' personnelle'); await empty.arrived; await personal.locator('[data-task-directory=ready]').waitFor();
    assert.ok((await personal.innerText()).includes('Aucun compte éligible')); assert.ok((await personal.innerText()).includes('visible uniquement par son créateur'));
    const personalTask = await confirmedSave(page, personal); assert.deepEqual(personalTask.assignees, []);
    assert.equal((await sql.query('select count(*)::int n from app_private.task_assignments where task_id=$1 and removed_at is null', [personalTask.id])).rows[0].n, 0);
    const third = await open('a', width); try { assert.equal(await card(third.page, personalTask.id).count(), 0); await clean(third); } finally { await third.context.close(); }
    await clean(s);
  } finally { await s.context.close(); }
}

try {
  await createUser('creator', 'Léa Créatrice Directe Fictive'); await createUser('a', 'Élodie Responsable Fictive'); await createUser('b', 'Élodie Responsable Fictive'); await createUser('email', '', 'read');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await check('Chromium desktop 1440: automatic directory, confirmed name/email search, UUID multi-select, loading/error/retry, save, personal task, inactive retention, no Admin', () => directJourney('chromium', 1440));
  await check('Chromium mobile 390: same direct-assignment journey with all fields and selections preserved and no horizontal overflow', () => directJourney('chromium', 390));
  await check('Revocation while an actual directory response is delayed clears private draft and ignores the late response', async () => {
    const s = await open('creator', 390); let held;
    try {
      held = await interceptDirectory(s.page, 'hold'); const dialog = await begin(s.page, prefix + ' private revoked draft'); await held.arrived; await dialog.locator('[name=notes]').fill('Saisie privée retirée après révocation');
      await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='tasks'", [users.creator.id]);
      await s.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await dialog.waitFor({ state: 'detached' }); held.release(); await new Promise(resolveWait => setTimeout(resolveWait, 300));
      assert.equal(await s.page.getByRole('dialog').count(), 0); assert.ok(!(await s.page.locator('body').innerText()).includes('private revoked draft')); await clean(s);
    } finally { held?.release(); await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='tasks'", [users.creator.id]); await s.context.close(); }
  });
  await browser.close(); browser = null;
  if (process.env.TASKS_DIRECT_WEBKIT === '1') await check('WebKit mobile 390: real direct assignment, search, retry, multi-select, personal task and inactive retention', async () => { browser = await webkit.launch({ headless: true, ...(process.env.TASKS_WEBKIT_EXECUTABLE ? { executablePath: process.env.TASKS_WEBKIT_EXECUTABLE } : {}) }); await directJourney('webkit', 390); });
} finally {
  await browser?.close();
  const ids = Object.values(users).map(user => user.id);
  if (ids.length) {
    const tasks = (await sql.query('select id from app_private.task_records where creator_id=any($1::uuid[])', [ids])).rows.map(row => row.id);
    for (const table of ['task_requests', 'task_events', 'task_assignments']) await sql.query('delete from app_private.' + table + ' where task_id=any($1::text[])', [tasks]);
    await sql.query('delete from app_private.task_records where id=any($1::text[])', [tasks]);
    await sql.query('delete from public.crm_module_grants where user_id=any($1::uuid[])', [ids]);
    await sql.query("delete from public.app_memberships where user_id=any($1::uuid[]) and workspace_id='oar'", [ids]);
    await sql.query('delete from public.crm_access_profiles where user_id=any($1::uuid[])', [ids]);
    for (const user of Object.values(users)) await authRequest('/auth/v1/admin/users/' + user.id, null, 'DELETE');
  }
  const remainingRecords = (await sql.query('select * from app_private.task_records order by id')).rows;
  const remainingAssignments = (await sql.query('select * from app_private.task_assignments order by task_id,user_id')).rows;
  cleanupPassed = JSON.stringify(remainingRecords) === JSON.stringify(originalRecords) && JSON.stringify(remainingAssignments) === JSON.stringify(originalAssignments);
  assert.equal(cleanupPassed, true, 'Existing fictional task records and assignments preserved byte-for-byte');
  await sql.end(); save();
}
