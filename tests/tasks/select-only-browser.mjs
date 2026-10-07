/** UI proof with the actual candidate component and fictional HTTP replies only.
 * No Auth, RPC, SQL, account creation, persistence service, or business writes.
 * The route closure retains fictional state across reload within each context.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.env.TASKS_SELECT_ONLY_ACK, 'TASKS_UI_FICTION_ONLY');
const sourceRoot = resolve(process.env.TASKS_SELECT_ONLY_SOURCE || process.cwd());
assert.ok(sourceRoot.startsWith('/private/tmp/'));
const output = resolve(process.env.TASKS_SELECT_ONLY_OUTPUT || join(sourceRoot, 'docs/tasks/select-only'));
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(join(output, 'ui-source-manifest.json'), 'utf8'));
assert.equal(manifest.status, 'ready'); assert.equal(manifest.sourceRoot, sourceRoot);
assert.equal(manifest.app, 'http://127.0.0.1:3201', 'Fixed loopback UI fixture origin required');
assert.equal(manifest.candidateBaseSHA, 'bfc1ef853afe215e420fe5be3c7ab334964b492a');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const entry of manifest.sourceFiles) {
  assert.equal(hash(join(sourceRoot, entry.path)), entry.sha256, 'Candidate hash: ' + entry.path);
  assert.equal(hash(join(manifest.directory, entry.path)), entry.sha256, 'Served hash: ' + entry.path);
}
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const people = {
  self: { userId: id(1), label: 'Léa Créatrice Fictive', email: 'lea@example.invalid', access: 'contribute' },
  a: { userId: id(2), label: 'Élodie Responsable Fictive', email: 'elodie.a@example.invalid', access: 'contribute' },
  b: { userId: id(3), label: 'Élodie Responsable Fictive', email: 'elodie.b@example.invalid', access: 'read' },
  email: { userId: id(4), label: 'sans-nom@example.invalid', email: 'sans-nom@example.invalid', access: 'read' },
  inactive: { userId: id(5), label: 'Nora Inactive Fictive', email: 'nora@example.invalid', access: 'none' },
  manager: { userId: id(6), label: 'Marc Gestionnaire Fictif', email: 'marc@example.invalid', access: 'none' },
};
const stamp = '2026-10-07T12:00:00.000Z';
const assignee = (role, active = true) => ({ ...people[role], active });
const task = (number, title, extras = {}) => ({ id: id(number), title, status: 'À faire', notes: '', dueDate: '', priority: 'normal', createdBy: people.self.userId, createdByLabel: people.self.label, createdAt: stamp, updatedAt: stamp, revision: 1, assignees: [], ...extras });
const results = [], sessions = [];
const resultFile = join(output, 'ui-browser-results.json');
function save() {
  writeFileSync(resultFile, JSON.stringify({ candidateBaseSHA: manifest.candidateBaseSHA, componentSHA256: manifest.sourceFiles.find(entry => entry.path === 'components/TasksWorkspace.tsx').sha256, sourceManifest: 'ui-source-manifest.json', results, fictionalFixture: true, simulatedHTTPConfirmation: true, statePersistence: 'In-memory Playwright route closure across page reload', actualAuth: false, actualRPC: false, actualDatabase: false, accountsCreated: 0, businessWrites: 0, productionWrites: 0, externalCalls: 0, physicalDevice: false, isolatedFixtureLayout: true, audits: sessions.map(session => ({ engine: session.engine, width: session.width, ...session.audit })) }, null, 2) + '\n');
}
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); process.exitCode = 1; console.log('FAIL ' + name + ': ' + error.message); }
  finally { save(); }
}
const clone = value => JSON.parse(JSON.stringify(value));
async function until(fn, label) { for (let attempt = 0; attempt < 100; attempt++) { if (await fn()) return; await new Promise(done => setTimeout(done, 50)); } throw new Error(label); }
function deferred() { let release; const promise = new Promise(done => { release = done; }); return { promise, release }; }
async function open(browser, engine, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  const state = { tasks: [task(101, 'Dossier Alpha Fictif', { notes: 'Texte de recherche gardé' }), task(102, 'Dossier Beta Fictif')], directory: [people.self, people.a, people.b, people.email], nextDirectory: null, nextMutation: null };
  const audit = { blocked: [], pageErrors: [], consoleErrors: [], fixtureRequests: [], mutations: [] };
  const session = { context, engine, width, state, audit }; sessions.push(session);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== manifest.app) { audit.blocked.push(url.origin + url.pathname); return route.abort(); }
    if (!url.pathname.startsWith('/__task_fixture/')) return route.continue();
    audit.fixtureRequests.push({ method: route.request().method(), path: url.pathname });
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/__task_fixture/list') return reply(clone(state.tasks));
    if (url.pathname === '/__task_fixture/directory') {
      const mode = state.nextDirectory; state.nextDirectory = null;
      if (mode?.arrived) mode.arrived.release();
      if (mode?.gate) await mode.gate.promise;
      if (mode?.kind === 'error') return reply({ message: 'Simulated UI directory interruption' }, 503);
      return reply(mode?.kind === 'empty' ? [] : clone(state.directory));
    }
    if (url.pathname === '/__task_fixture/mutate') {
      const request = route.request().postDataJSON(); audit.mutations.push(clone(request));
      const mode = state.nextMutation; state.nextMutation = null;
      if (mode?.arrived) mode.arrived.release(); if (mode?.gate) await mode.gate.promise;
      const previous = state.tasks.find(item => item.id === request.id);
      if (previous && request.expectedRevision !== previous.revision) return reply({ message: 'revision_conflict' }, 409);
      if (request.delete) { state.tasks = state.tasks.filter(item => item.id !== request.id); return reply(null); }
      const confirmed = { ...(previous || task(999, '')), ...request.patch, id: request.id, revision: previous ? previous.revision + 1 : 1, updatedAt: stamp };
      if ('assigneeIds' in request.patch) confirmed.assignees = request.patch.assigneeIds.map(userId => {
        const selected = state.directory.find(person => person.userId === userId) || previous?.assignees.find(person => person.userId === userId);
        assert.ok(selected, 'Fictional fixture recipient exists'); return { ...selected, active: state.directory.some(person => person.userId === userId) };
      });
      delete confirmed.assigneeIds;
      state.tasks = state.tasks.filter(item => item.id !== request.id).concat(confirmed);
      return reply(clone(confirmed));
    }
    return reply({ message: 'Unknown UI fixture endpoint' }, 404);
  });
  const page = await context.newPage(); session.page = page;
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503 (Service Unavailable)')) audit.consoleErrors.push(message.text()); });
  await page.goto(manifest.app + '/select-demo'); await page.locator('[data-task-workspace]').waitFor();
  await page.locator(`[data-task-id="${id(101)}"]`).waitFor();
  return session;
}
const select = dialog => dialog.getByRole('combobox', { name: 'Sélectionner un responsable', exact: true });
const recipient = (dialog, role) => dialog.locator(`[data-task-recipient-id="${people[role].userId}"]`);
const card = (page, uuid) => page.locator(`[data-task-id="${uuid}"]`);
async function begin(page, title) { await page.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Ajouter une tâche', exact: true }); await dialog.locator('[name=title]').fill(title); return dialog; }
async function formWithoutSearch(dialog) {
  const directory = dialog.locator('[data-task-directory]');
  assert.equal(await directory.locator('input').count(), 0, 'Responsible section has no input');
  assert.equal(await dialog.locator('input[type=search], input[type=checkbox]').count(), 0, 'No recipient search or checkbox inside editor');
  assert.equal(await dialog.getByLabel('Rechercher un responsable', { exact: true }).count(), 0);
  assert.equal(await dialog.getByPlaceholder(/nom|e-mail|email/i).count(), 0);
  assert.equal(await select(dialog).getAttribute('multiple'), null); assert.equal(await select(dialog).getAttribute('size'), null);
  assert.equal(await select(dialog).locator('option[value=""]').innerText(), 'Sélectionner un responsable');
}
async function optionIds(dialog, expected) {
  assert.deepEqual(await select(dialog).locator('option').evaluateAll(elements => elements.map(option => option.value)), ['', ...expected.map(role => people[role].userId)], 'Complete eligible directory minus chosen UUIDs');
}
async function add(dialog, role) { await select(dialog).selectOption(people[role].userId); await recipient(dialog, role).waitFor(); assert.equal(await select(dialog).inputValue(), ''); assert.equal(await select(dialog).locator(`option[value="${people[role].userId}"]`).count(), 0); }
async function chosen(dialog, roles) { assert.deepEqual((await dialog.locator('[data-task-recipient-id]').evaluateAll(elements => elements.map(element => element.dataset.taskRecipientId))).sort(), roles.map(role => people[role].userId).sort()); }
async function fields(dialog, values) { for (const [key, value] of Object.entries(values)) assert.equal(await dialog.locator(`[name=${key}]`).inputValue(), value, 'Preserved field: ' + key); }
async function fits(page, dialog, width) { const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1); assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
function holdDirectory(session) { const mode = { kind: 'hold', gate: deferred(), arrived: deferred() }; session.state.nextDirectory = mode; return mode; }
async function confirmedSave(session, dialog, create = true) {
  const response = session.page.waitForResponse(item => new URL(item.url()).pathname === '/__task_fixture/mutate' && item.status() === 200);
  await dialog.getByRole('button', { name: create ? 'Créer la tâche' : 'Enregistrer', exact: true }).click();
  const saved = await (await response).json(); await dialog.waitFor({ state: 'detached' }); await card(session.page, saved.id).waitFor(); return saved;
}
function clean(session) { assert.deepEqual(session.audit.blocked, [], 'No external URL attempted'); assert.deepEqual(session.audit.pageErrors, [], 'No browser error'); assert.deepEqual(session.audit.consoleErrors, [], 'No hydration/console error'); assert.ok(session.audit.fixtureRequests.every(request => /^\/__task_fixture\/(list|directory|mutate)$/.test(request.path))); }
async function journey(browser, engine, width) {
  const session = await open(browser, engine, width), { page, state, audit } = session;
  try {
    const search = page.getByRole('searchbox', { name: 'Recherche', exact: true });
    assert.equal(await search.getAttribute('placeholder'), 'Dans mes tâches visibles'); await search.fill(width === 390 ? 'Beta' : 'Alpha');
    assert.equal(await page.locator('[data-task-id]').count(), 1); await card(page, id(width === 390 ? 102 : 101)).waitFor();
    await search.fill('Texte de recherche gardé'); await card(page, id(101)).waitFor(); assert.equal(await page.locator('[data-task-id]').count(), 1); await search.fill('');
    assert.equal(await page.locator('[data-task-id]').count(), 2);
    const held = holdDirectory(session);
    const values = { title: `Sélection directe ${engine} ${width}`, notes: 'Note fictive ligne 1\nLigne 2 conservée', dueDate: '2026-12-11', priority: 'urgent' };
    const dialog = await begin(page, values.title); await held.arrived.promise; await dialog.locator('[data-task-directory=loading]').waitFor();
    await dialog.locator('[name=notes]').fill(values.notes); await dialog.locator('[name=dueDate]').fill(values.dueDate); await dialog.locator('[name=priority]').selectOption(values.priority);
    await fields(dialog, values); assert.ok(await select(dialog).isDisabled()); held.gate.release(); await dialog.locator('[data-task-directory=ready]').waitFor();
    await formWithoutSearch(dialog); await optionIds(dialog, ['self', 'a', 'b', 'email']);
    assert.ok((await select(dialog).locator(`option[value="${people.self.userId}"]`).innerText()).includes('(moi)'));
    for (const role of ['a', 'b']) { const label = await select(dialog).locator(`option[value="${people[role].userId}"]`).innerText(); assert.ok(label.includes('Élodie Responsable Fictive')); assert.ok(label.includes(people[role].email)); }
    assert.ok((await select(dialog).locator(`option[value="${people.email.userId}"]`).innerText()).includes(people.email.email));
    await select(dialog).focus(); await select(dialog).press('Enter'); assert.equal(audit.mutations.length, 0, 'Select Enter does not submit');
    await add(dialog, 'self'); await chosen(dialog, ['self']); await optionIds(dialog, ['a', 'b', 'email']);
    const removeSelf = recipient(dialog, 'self').getByRole('button', { name: 'Retirer ' + people.self.label, exact: true }); assert.equal(await removeSelf.getAttribute('type'), 'button');
    if (width === 390) await removeSelf.tap(); else { await removeSelf.focus(); await removeSelf.press('Space'); }
    await chosen(dialog, []); await optionIds(dialog, ['self', 'a', 'b', 'email']);
    await add(dialog, 'a'); await add(dialog, 'b'); await chosen(dialog, ['a', 'b']); await optionIds(dialog, ['self', 'email']);
    await add(dialog, 'self'); await add(dialog, 'email'); await chosen(dialog, ['self', 'a', 'b', 'email']); await optionIds(dialog, []);
    assert.ok(await select(dialog).isDisabled(), 'All eligible accounts selected disables the select');
    await recipient(dialog, 'email').getByRole('button', { name: 'Retirer ' + people.email.label, exact: true }).click();
    await optionIds(dialog, ['email']); assert.ok(!await select(dialog).isDisabled(), 'Explicit removal restores exactly the removed UUID option');
    await recipient(dialog, 'self').getByRole('button', { name: 'Retirer ' + people.self.label, exact: true }).click(); await chosen(dialog, ['a', 'b']); await optionIds(dialog, ['self', 'email']);
    assert.equal(audit.mutations.length, 0, 'Multiple selections never auto-submit'); await fields(dialog, values);
    state.nextDirectory = { kind: 'error' }; await dialog.getByRole('button', { name: 'Actualiser les personnes éligibles', exact: true }).click(); await dialog.locator('[data-task-directory=error]').waitFor();
    await fields(dialog, values); await chosen(dialog, ['a', 'b']); await formWithoutSearch(dialog);
    const retry = holdDirectory(session); await dialog.getByRole('button', { name: 'Réessayer de charger les responsables', exact: true }).click(); await retry.arrived.promise;
    await fields(dialog, values); await chosen(dialog, ['a', 'b']); retry.gate.release(); await dialog.locator('[data-task-directory=ready]').waitFor();
    await optionIds(dialog, ['self', 'email']);
    state.nextDirectory = { kind: 'empty' }; await dialog.getByRole('button', { name: 'Actualiser les personnes éligibles', exact: true }).click(); await dialog.locator('[data-task-directory=ready]').waitFor();
    await chosen(dialog, ['a', 'b']); await fields(dialog, values); await optionIds(dialog, []); assert.ok(await select(dialog).isDisabled()); assert.ok((await dialog.innerText()).includes('Aucun compte éligible'));
    await dialog.getByRole('button', { name: 'Actualiser les personnes éligibles', exact: true }).click(); await until(async () => (await select(dialog).locator('option').count()) === 3, 'Eligible directory restored');
    await chosen(dialog, ['a', 'b']); await optionIds(dialog, ['self', 'email']);
    const removeA = recipient(dialog, 'a').getByRole('button', { name: 'Retirer ' + people.a.label, exact: true }); if (width === 390) await removeA.tap(); else await removeA.click();
    await chosen(dialog, ['b']); await optionIds(dialog, ['self', 'a', 'email']); assert.equal(audit.mutations.length, 0, 'Explicit removal does not submit'); await fields(dialog, values); await fits(page, dialog, width);
    await dialog.evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: join(output, `${engine}-${width}-creation.png`), fullPage: true });
    await dialog.locator('[data-task-directory]').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `${engine}-${width}-selection.png`), fullPage: true });
    const confirm = { gate: deferred(), arrived: deferred() }; state.nextMutation = confirm;
    const pendingSave = confirmedSave(session, dialog); await confirm.arrived.promise;
    assert.equal(await dialog.locator('button[type=submit]').innerText(), 'Confirmation en cours…'); assert.ok(await dialog.locator('button[type=submit]').isDisabled());
    assert.equal(await page.getByRole('button', { name: values.title, exact: true }).count(), 0, 'Draft not shown as saved before simulated response');
    confirm.gate.release(); const saved = await pendingSave;
    assert.deepEqual(saved.assignees.map(person => person.userId), [people.b.userId]); for (const [field, value] of Object.entries(values)) assert.equal(saved[field], value);
    assert.deepEqual(audit.mutations.at(-1).patch.assigneeIds, [people.b.userId]);
    await page.reload(); await card(page, saved.id).waitFor(); await card(page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor();
    await formWithoutSearch(edit); await fields(edit, values); await chosen(edit, ['b']); await optionIds(edit, ['self', 'a', 'email']); await fits(page, edit, width);
    await edit.locator('[name=notes]').fill(values.notes + '\nÉdition explicite conservée'); const edited = await confirmedSave(session, edit, false);
    assert.equal('assigneeIds' in audit.mutations.at(-1).patch, false, 'Unchanged assignment omitted from edit patch'); assert.deepEqual(edited.assignees.map(person => person.userId), [people.b.userId]);
    clean(session);
  } finally { await session.context.close(); }
}

let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps'] });
  await check('Chromium desktop 1440: direct complete UUID select, self/homonyms/email labels, multi-add/remove, no editor search, explicit simulated confirmation, reload, search unchanged, loading/503/retry/empty preservation', () => journey(browser, 'chromium', 1440));
  await check('Chromium mobile 390 touch emulation: same direct select journey, wrapped chips and no horizontal overflow', () => journey(browser, 'chromium', 390));
  await check('Inactive existing assignment is retained until explicit removal; historical manager remains selected and non-removable', async () => {
    const session = await open(browser, 'chromium', 1440), { page, state, audit } = session;
    try {
      state.tasks.push(task(103, 'Affectation inactive fictive', { assignees: [assignee('self'), assignee('inactive', false)] }));
      state.tasks.push(task(104, 'Gestionnaire historique fictif', { createdBy: null, createdByLabel: 'Auteur historique fictif non confirmé', managerId: people.manager.userId, managerLabel: people.manager.label, managerActive: false, assignees: [assignee('self'), assignee('manager', false)] }));
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await card(page, id(103)).waitFor();
      await card(page, id(103)).getByRole('button', { name: 'Modifier', exact: true }).click(); let edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor();
      await formWithoutSearch(edit); await chosen(edit, ['self', 'inactive']); assert.equal(await recipient(edit, 'inactive').getAttribute('data-task-recipient-kind'), 'retained'); assert.ok((await recipient(edit, 'inactive').innerText()).includes('Affectation conservée'));
      await edit.locator('[name=notes]').fill('Notes fictives, affectation inactive gardée'); const retained = await confirmedSave(session, edit, false); assert.ok(retained.assignees.some(person => person.userId === people.inactive.userId)); assert.equal('assigneeIds' in audit.mutations.at(-1).patch, false);
      await card(page, id(103)).getByRole('button', { name: 'Modifier', exact: true }).click(); edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor();
      await recipient(edit, 'inactive').getByRole('button', { name: 'Retirer ' + people.inactive.label, exact: true }).click(); await chosen(edit, ['self']); assert.equal(await select(edit).locator(`option[value="${people.inactive.userId}"]`).count(), 0);
      const removed = await confirmedSave(session, edit, false); assert.deepEqual(removed.assignees.map(person => person.userId), [people.self.userId]);
      await card(page, id(104)).getByRole('button', { name: 'Modifier', exact: true }).click(); edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor(); await chosen(edit, ['self', 'manager']);
      assert.equal(await recipient(edit, 'manager').getAttribute('data-task-recipient-kind'), 'retained'); assert.ok((await recipient(edit, 'manager').innerText()).includes('Gestionnaire conservé')); assert.ok(await recipient(edit, 'manager').getByRole('button', { name: 'Retirer ' + people.manager.label, exact: true }).isDisabled());
      const before = audit.mutations.length; await edit.getByRole('button', { name: 'Annuler', exact: true }).click(); assert.equal(audit.mutations.length, before); clean(session);
    } finally { await session.context.close(); }
  });
  await check('Conflict keeps local notes and UUID chips; explicit revision acceptance and save required', async () => {
    const session = await open(browser, 'chromium', 1440), { page, state, audit } = session;
    try {
      await card(page, id(101)).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor();
      const draft = { title: 'Titre privé fictif en conflit', notes: 'Notes privées fictives gardées' }; await edit.locator('[name=title]').fill(draft.title); await edit.locator('[name=notes]').fill(draft.notes); await add(edit, 'a'); await add(edit, 'b');
      state.tasks[0] = { ...state.tasks[0], title: 'Titre fictif concurrent simulé', revision: 2 };
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await edit.locator('.taskws-conflict').waitFor(); await chosen(edit, ['a', 'b']); await fields(edit, draft);
      assert.ok(await edit.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled()); assert.equal(audit.mutations.length, 0);
      await edit.getByRole('button', { name: 'Reprendre sur cette révision avec ma saisie', exact: true }).click(); await fields(edit, draft); await chosen(edit, ['a', 'b']);
      const saved = await confirmedSave(session, edit, false); assert.equal(saved.title, draft.title); assert.equal(saved.notes, draft.notes); assert.deepEqual(saved.assignees.map(person => person.userId), [people.a.userId, people.b.userId]); clean(session);
    } finally { await session.context.close(); }
  });
  await browser.close(); browser = null;
  const webkitPath = '/private/tmp/monthly-charges-browsers/webkit-2336/pw_run.sh';
  if (existsSync(webkitPath)) {
    browser = await webkit.launch({ headless: true, executablePath: webkitPath });
    await check('WebKit mobile 390 touch emulation: source-identical select journey and preserved chips/draft', () => journey(browser, 'webkit', 390));
  }
} finally { await browser?.close(); save(); }
assert.ok(results.length >= 4); assert.ok(results.every(result => result.passed), 'All UI fixture checks must pass');
