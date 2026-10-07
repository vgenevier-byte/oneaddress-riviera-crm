/** Actual candidate components with fictional intercepted HTTP replies only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.env.TASKS_COMPANY_SEARCH_ACK, 'TASKS_UI_FICTION_ONLY');
const sourceRoot = resolve(process.env.TASKS_COMPANY_SEARCH_SOURCE || process.cwd());
assert.ok(sourceRoot.startsWith('/private/tmp/'));
const output = resolve(process.env.TASKS_COMPANY_SEARCH_OUTPUT || join(sourceRoot, 'docs/tasks/company-search'));
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(join(output, 'ui-source-manifest.json'), 'utf8'));
assert.equal(manifest.status, 'ready'); assert.equal(manifest.sourceRoot, sourceRoot);
assert.equal(manifest.app, 'http://127.0.0.1:3203');
assert.equal(manifest.candidateBaseSHA, 'b33ec9841d111727f48ace0f3c06ec2830da4b13');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const entry of manifest.sourceFiles) {
  assert.equal(hash(join(sourceRoot, entry.path)), entry.sha256, 'Candidate hash: ' + entry.path);
  assert.equal(hash(join(manifest.directory, entry.path)), entry.sha256, 'Served hash: ' + entry.path);
}
for (const entry of manifest.supportingSourceFiles) assert.equal(hash(join(sourceRoot, entry.path)), entry.sha256, 'Supporting candidate hash: ' + entry.path);
for (const entry of manifest.fixtureOnlyFiles) assert.equal(hash(join(manifest.directory, entry.path)), entry.sha256, 'Fixture hash: ' + entry.path);
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const people = {
  self: { userId: id(1), label: 'Léa Créatrice Fictive', email: 'lea@example.invalid', access: 'contribute' },
  a: { userId: id(2), label: 'Élodie Responsable Fictive', email: 'elodie.a@example.invalid', access: 'contribute' },
  b: { userId: id(3), label: 'Élodie Responsable Fictive', email: 'elodie.b@example.invalid', access: 'read' },
};
const contacts = [
  { id: 'contact-clement-a-fictional', firstName: 'Clément', name: 'Minodier', companyName: 'Entreprise A fictive', email: 'clement.a@example.invalid' },
  { id: 'contact-clement-b-fictional', firstName: 'Clément', name: 'Minodier', companyName: 'Entreprise B fictive', email: 'clement.b@example.invalid' },
  { id: 'contact-compound-fictional', firstName: 'Anne-Marie', name: 'De La Résidence', companyName: 'Société composée fictive' },
  { id: 'contact-surname-fictional', name: 'Dùpont' },
  { id: 'contact-firstname-fictional', firstName: 'Élodie' },
  { id: 'contact-company-fictional', firstName: ' \t ', name: '   ', companyName: '  Société Riviera fictive  ' },
  { id: 'contact-unnamed-fictional', email: 'unnamed@example.invalid' },
  { id: 'contact-other-fictional', firstName: 'Nora', name: 'Autre Fictive' },
  { id: 'contact-julien-fictional', firstName: 'Julien', name: 'Martin', companyName: 'Azur Services', email: 'julien@example.invalid' },
  { id: 'contact-camille-fictional', firstName: 'Camille', name: 'Laurent', companyName: 'Azur Services', email: 'camille@example.invalid' },
  { id: 'contact-julien-fictional', firstName: 'Ignored duplicate fictif', name: 'Second row fictive', companyName: 'Autre société fictive', email: 'duplicate@example.invalid' },
  { id: 'contact-accent-company-fictional', firstName: 'Benoît', name: 'Simon', companyName: 'Élévation Île' },
  { id: 'contact-no-company-fictional', firstName: 'Adrien', name: 'SansEntreprise' },
];
const stamp = '2026-10-07T12:00:00.000Z';
const task = (number, title, extras = {}) => ({ id: id(number), title, status: 'À faire', notes: '', dueDate: '', priority: 'normal', createdBy: people.self.userId, createdByLabel: people.self.label, createdAt: stamp, updatedAt: stamp, revision: 1, assignees: [], ...extras });
const results = [], sessions = [];
const resultFile = join(output, 'ui-browser-results.json');
function save() {
  writeFileSync(resultFile, JSON.stringify({ candidateBaseSHA: manifest.candidateBaseSHA, sourceManifest: 'ui-source-manifest.json', results, fictionalFixture: true, simulatedHTTPConfirmation: true, statePersistence: 'In-memory Playwright route closure across page reload', actualAuth: false, actualRPC: false, actualDatabase: false, accountsCreated: 0, businessWrites: 0, productionWrites: 0, externalCalls: 0, physicalDevice: false, isolatedFixtureLayout: true, integratedCRMPageRendered: false, audits: sessions.map(session => ({ engine: session.engine, width: session.width, ...session.audit })) }, null, 2) + '\n');
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
  const state = { tasks: [task(101, 'Dossier Alpha Fictif', { notes: 'Texte de recherche gardé' }), task(102, 'Dossier Beta Fictif')], directory: [people.self, people.a, people.b], contacts: clone(contacts), nextMutation: null, nextDirectory: null };
  const audit = { blocked: [], pageErrors: [], consoleErrors: [], expectedHTTPFailures: [], fixtureRequests: [], mutations: [] };
  const session = { context, engine, width, state, audit }; sessions.push(session);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== manifest.app) { audit.blocked.push(url.origin + url.pathname); return route.abort(); }
    if (!url.pathname.startsWith('/__task_fixture/')) return route.continue();
    audit.fixtureRequests.push({ method: route.request().method(), path: url.pathname });
    const reply = (body, status = 200) => { if (status >= 400) audit.expectedHTTPFailures.push({ path: url.pathname, status }); return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); };
    if (url.pathname === '/__task_fixture/list') return reply(clone(state.tasks));
    if (url.pathname === '/__task_fixture/contacts') return reply(clone(state.contacts));
    if (url.pathname === '/__task_fixture/directory') {
      const mode = state.nextDirectory; state.nextDirectory = null;
      if (mode?.kind === 'error') return reply({ message: 'Simulated UI directory interruption' }, 503);
      return reply(clone(state.directory));
    }
    if (url.pathname === '/__task_fixture/mutate') {
      const request = route.request().postDataJSON(); audit.mutations.push(clone(request));
      const mode = state.nextMutation; state.nextMutation = null;
      if (mode?.arrived) mode.arrived.release(); if (mode?.gate) await mode.gate.promise;
      if (mode?.kind === 'error') return reply({ message: 'network simulated fictional save interruption' }, 503);
      const previous = state.tasks.find(item => item.id === request.id);
      if (previous && request.expectedRevision !== previous.revision) return reply({ message: 'revision_conflict' }, 409);
      if (request.delete) { state.tasks = state.tasks.filter(item => item.id !== request.id); return reply(null); }
      const confirmed = { ...(previous || task(999, '')), ...request.patch, id: request.id, revision: previous ? previous.revision + 1 : 1, updatedAt: stamp };
      if ('assigneeIds' in request.patch) confirmed.assignees = request.patch.assigneeIds.map(userId => {
        const selected = state.directory.find(person => person.userId === userId) || previous?.assignees.find(person => person.userId === userId);
        assert.ok(selected, 'Fictional fixture recipient exists'); return { ...selected, active: state.directory.some(person => person.userId === userId) };
      });
      delete confirmed.assigneeIds;
      state.tasks = state.tasks.filter(item => item.id !== request.id).concat(confirmed); return reply(clone(confirmed));
    }
    return reply({ message: 'Unknown UI fixture endpoint' }, 404);
  });
  const page = await context.newPage(); session.page = page;
  page.on('pageerror', error => audit.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/503 \(Service Unavailable\)|409 \(Conflict\)/.test(message.text())) audit.consoleErrors.push(message.text()); });
  await page.goto(manifest.app + '/company-demo'); await page.locator('[data-task-workspace]').waitFor();
  await page.locator('[data-fixture-contacts-state=ready]').waitFor(); await card(page, id(101)).waitFor(); return session;
}
const card = (page, uuid) => page.locator(`[data-task-id="${uuid}"]`);
const contactInput = dialog => dialog.getByRole('combobox', { name: 'Contact lié — facultatif', exact: true });
const contactOptions = dialog => dialog.getByRole('listbox', { name: 'Contacts correspondants', exact: true }).getByRole('option');
const chosenContact = dialog => dialog.locator('.task-contact-selected');
const responsibleSelect = dialog => dialog.getByRole('combobox', { name: 'Sélectionner un responsable', exact: true });
async function begin(page, title) { await page.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Ajouter une tâche', exact: true }); await dialog.locator('[name=title]').fill(title); await dialog.locator('[data-task-directory=ready]').waitFor(); return dialog; }
async function queryOptions(dialog, query, expectedNames) {
  await contactInput(dialog).fill(query); await until(async () => (await contactInput(dialog).getAttribute('aria-expanded')) === 'true', 'Contact suggestions opened'); await until(async () => (await contactOptions(dialog).count()) === expectedNames.length, 'Contact result count for ' + query);
  const texts = await contactOptions(dialog).allTextContents(); for (const name of expectedNames) assert.ok(texts.some(text => text.includes(name)), query + ' result ' + name); return texts;
}
async function pickContact(dialog, query, distinction) { await contactInput(dialog).fill(query); const option = contactOptions(dialog).filter({ hasText: distinction }); assert.equal(await option.count(), 1, 'Explicit distinct contact result'); await option.click(); await chosenContact(dialog).waitFor(); }
async function clearContact(dialog) { await dialog.getByRole('button', { name: 'Retirer le contact lié', exact: true }).click(); assert.equal(await chosenContact(dialog).count(), 0); }
async function fields(dialog, values) { for (const [key, value] of Object.entries(values)) assert.equal(await dialog.locator(`[name=${key}]`).inputValue(), value, 'Preserved field: ' + key); }
async function fits(page, dialog, width) { const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1); assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
async function confirmedSave(session, dialog, create = true) {
  const response = session.page.waitForResponse(item => new URL(item.url()).pathname === '/__task_fixture/mutate' && item.status() === 200);
  await dialog.getByRole('button', { name: create ? 'Créer la tâche' : 'Enregistrer', exact: true }).click();
  const saved = await (await response).json(); await dialog.waitFor({ state: 'detached' }); await card(session.page, saved.id).waitFor(); return saved;
}
function clean(session) { assert.deepEqual(session.audit.blocked, [], 'No external URL attempted'); assert.deepEqual(session.audit.pageErrors, [], 'No browser error'); assert.deepEqual(session.audit.consoleErrors, [], 'No hydration/console error'); assert.ok(session.audit.fixtureRequests.every(request => /^\/__task_fixture\/(list|directory|mutate|contacts)$/.test(request.path))); }
async function responsibleAndLeadUnchanged(dialog, audit) {
  const directory = dialog.locator('[data-task-directory]');
  assert.equal(await directory.locator('input[type=search],input[type=checkbox]').count(), 0, 'Responsible native select has no search or checkbox');
  assert.equal(await responsibleSelect(dialog).getAttribute('multiple'), null); assert.equal(await responsibleSelect(dialog).getAttribute('size'), null);
  assert.equal(await responsibleSelect(dialog).locator('option[value=""]').innerText(), 'Sélectionner un responsable');
  const labels = await responsibleSelect(dialog).locator('option').allTextContents(); assert.ok(labels.some(value => value.includes('elodie.a@example.invalid'))); assert.ok(labels.some(value => value.includes('elodie.b@example.invalid')));
  await responsibleSelect(dialog).focus(); await responsibleSelect(dialog).press('Enter'); assert.equal(audit.mutations.length, 0);
  await responsibleSelect(dialog).selectOption(people.a.userId); assert.equal(await responsibleSelect(dialog).inputValue(), ''); assert.equal(await directory.locator(`[data-task-recipient-id="${people.a.userId}"]`).count(), 1);
  await dialog.locator('[name=leadId]').selectOption('lead-alpha-fictional'); assert.equal(await dialog.locator('[name=leadId]').inputValue(), 'lead-alpha-fictional'); assert.equal(audit.mutations.length, 0);
}
async function journey(browser, engine, width) {
  const session = await open(browser, engine, width), { page, audit } = session;
  try {
    const generalSearch = page.getByRole('searchbox', { name: 'Recherche', exact: true }); await generalSearch.fill('Texte de recherche gardé'); await card(page, id(101)).waitFor(); assert.equal(await page.locator('[data-task-id]').count(), 1); await generalSearch.fill('');
    const values = { title: `Contact explicite ${engine} ${width}`, notes: 'Notes fictives ligne 1\nBrouillon conservé', dueDate: '2026-12-11', priority: 'urgent' };
    const dialog = await begin(page, values.title); for (const field of ['notes', 'dueDate']) await dialog.locator(`[name=${field}]`).fill(values[field]); await dialog.locator('[name=priority]').selectOption(values.priority);
    await responsibleAndLeadUnchanged(dialog, audit);
    for (const query of ['clement', 'CLÉMENT', 'clem', 'minodier', 'clement minodier', 'minodier clement', '  MINO\t clem  ', 'Cle\u0301ment', 'ＣＬÉＭＥＮＴ']) {
      const texts = await queryOptions(dialog, query, ['Clément Minodier', 'Clément Minodier']); assert.ok(texts.some(text => text.includes('Entreprise A fictive') && text.includes('clement.a@example.invalid'))); assert.ok(texts.some(text => text.includes('Entreprise B fictive') && text.includes('clement.b@example.invalid')));
      assert.equal(await chosenContact(dialog).count(), 0, 'Typing never chooses a homonym'); assert.equal(audit.mutations.length, 0);
    }
    for (const query of ['anne', 'marie', 'resid', 'résidence anne', 'la marie de']) await queryOptions(dialog, query, ['Anne-Marie De La Résidence']);
    await queryOptions(dialog, 'dupont', ['Dùpont']); await queryOptions(dialog, 'elo', ['Élodie']); await queryOptions(dialog, 'riviera societe', ['Société Riviera fictive']);
    const companyOnly = contactOptions(dialog).filter({ hasText: 'Société Riviera fictive' }); assert.equal(((await companyOnly.innerText()).match(/Société Riviera fictive/g) || []).length, 1, 'Company-only suggestion does not repeat its label as metadata'); await companyOnly.click(); assert.equal(((await chosenContact(dialog).innerText()).match(/Société Riviera fictive/g) || []).length, 1, 'Company-only selected label is not repeated'); await clearContact(dialog);
    assert.equal(await contactInput(dialog).getAttribute('placeholder'), 'Rechercher par prénom, nom ou entreprise…');
    for (const query of ['azur', 'services', 'azur services', '  SERVICES\t AZUR  ', 'ＡＺＵＲ']) await queryOptions(dialog, query, ['Julien Martin', 'Camille Laurent']);
    for (const query of ['julien', 'martin', 'julien martin', 'julien azur', 'martin azur', 'services julien martin azur', '  AZUR\t JuL  ']) await queryOptions(dialog, query, ['Julien Martin']);
    for (const query of ['elevation ile', 'ÎLE ÉLÉVATION', 'eleva', 'E\u0301le\u0301vation', 'ÉＬÉＶＡＴＩＯＮ']) await queryOptions(dialog, query, ['Benoît Simon']);
    await queryOptions(dialog, 'adrien', ['Adrien SansEntreprise']); assert.equal(await contactOptions(dialog).locator('small').count(), 0, 'An absent company is not invented'); await queryOptions(dialog, 'ignored duplicate', []);
    assert.equal(await chosenContact(dialog).count(), 0, 'A unique result never auto-selects'); assert.equal(audit.mutations.length, 0);
    await queryOptions(dialog, 'clement dupont', []); await queryOptions(dialog, 'unmatched contact', []);
    await pickContact(dialog, 'clem', 'clement.a@example.invalid'); assert.ok((await chosenContact(dialog).innerText()).includes('Clément Minodier')); assert.equal(audit.mutations.length, 0);
    await clearContact(dialog); await pickContact(dialog, 'clem', 'clement.b@example.invalid'); assert.equal(audit.mutations.length, 0); await fields(dialog, values); await fits(page, dialog, width);
    await contactInput(dialog).fill('clem'); await contactInput(dialog).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `${engine}-${width}-suggestions.png`), fullPage: true });
    await contactInput(dialog).press('Escape'); await page.screenshot({ path: join(output, `${engine}-${width}-selected.png`), fullPage: true });
    const confirm = { gate: deferred(), arrived: deferred() }; session.state.nextMutation = confirm; const pendingSave = confirmedSave(session, dialog); await confirm.arrived.promise;
    assert.ok(await dialog.locator('button[type=submit]').isDisabled()); assert.equal(await page.getByRole('button', { name: values.title, exact: true }).count(), 0, 'Draft is not saved before response'); confirm.gate.release(); const saved = await pendingSave;
    assert.equal(saved.contactId, contacts[1].id); assert.equal(audit.mutations.at(-1).patch.contactId, contacts[1].id); assert.equal(saved.leadId, 'lead-alpha-fictional'); assert.deepEqual(saved.assignees.map(person => person.userId), [people.a.userId]); await page.reload(); await card(page, saved.id).waitFor();
    await card(page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await edit.locator('[data-task-directory=ready]').waitFor(); await chosenContact(edit).waitFor(); assert.ok((await chosenContact(edit).innerText()).includes('Clément Minodier')); await fields(edit, values); await fits(page, edit, width);
    await edit.locator('[name=notes]').fill(values.notes + '\nÉdition explicite'); const edited = await confirmedSave(session, edit, false); assert.equal(edited.contactId, contacts[1].id); assert.equal('contactId' in audit.mutations.at(-1).patch, false, 'Unchanged contact omitted from edit patch');
    await card(page, saved.id).getByRole('button', { name: values.title, exact: true }).click(); const detail = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true }); await detail.waitFor(); assert.ok((await detail.innerText()).includes('Clément Minodier'), 'Detail uses first name and surname'); await detail.getByRole('button', { name: 'Fermer', exact: true }).first().click();
    await card(page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const removal = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(removal).waitFor(); await clearContact(removal); const cleared = await confirmedSave(session, removal, false); assert.equal(cleared.contactId, ''); assert.equal(audit.mutations.at(-1).patch.contactId, '', 'Explicit removal persists only on save'); clean(session);
  } finally { await session.context.close(); }
}
async function companyJourney(browser, engine, width) {
  const session = await open(browser, engine, width), { page, audit } = session;
  try {
    const title = `Entreprise explicite ${engine} ${width}`;
    const dialog = await begin(page, title);
    const results = await queryOptions(dialog, 'azur services', ['Julien Martin', 'Camille Laurent']);
    assert.equal(results.length, 2, 'Same ID duplicate is excluded; distinct company interlocutors remain');
    assert.ok(results.some(text => text.includes('julien@example.invalid'))); assert.ok(results.some(text => text.includes('camille@example.invalid')));
    assert.ok(!results.some(text => text.includes('duplicate@example.invalid'))); assert.equal(await chosenContact(dialog).count(), 0); assert.equal(audit.mutations.length, 0);
    await fits(page, dialog, width); await contactInput(dialog).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `${engine}-${width}-company-suggestions.png`), fullPage: true });
    await pickContact(dialog, 'services azur', 'julien@example.invalid'); const saved = await confirmedSave(session, dialog); assert.equal(saved.contactId, 'contact-julien-fictional'); assert.equal(audit.mutations.at(-1).patch.contactId, 'contact-julien-fictional');
    await page.reload(); await card(page, saved.id).waitFor(); await card(page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(edit).waitFor(); assert.ok((await chosenContact(edit).innerText()).includes('Julien Martin'));
    await queryOptions(edit, 'azur services', ['Julien Martin', 'Camille Laurent']); assert.ok((await chosenContact(edit).innerText()).includes('Julien Martin'), 'Company typing alone retains the already chosen exact contact'); const before = audit.mutations.length; await pickContact(edit, 'azur', 'camille@example.invalid'); assert.equal(audit.mutations.length, before, 'Changing interlocutor never auto-submits'); const replaced = await confirmedSave(session, edit, false); assert.equal(replaced.contactId, 'contact-camille-fictional'); assert.equal(audit.mutations.at(-1).patch.contactId, 'contact-camille-fictional');
    await page.reload(); await card(page, saved.id).waitFor(); await card(page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const reloaded = page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(reloaded).waitFor(); assert.ok((await chosenContact(reloaded).innerText()).includes('Camille Laurent')); await reloaded.getByRole('button', { name: 'Annuler', exact: true }).click(); clean(session);
  } finally { await session.context.close(); }
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps'] });
  await check('Chromium 1440: prior contact journey plus company/cross-field search, stable ID dedup and distinct interlocutor save/reload/replace', async () => { await journey(browser, 'chromium', 1440); await companyJourney(browser, 'chromium', 1440); });
  await check('Chromium 390 touch emulation: prior contact journey plus company results, interlocutor choice and no horizontal overflow', async () => { await journey(browser, 'chromium', 390); await companyJourney(browser, 'chromium', 390); });
  await check('Typing alone never selects: one result or no result saved explicitly as a personal contact-free draft', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      for (const query of ['anne', 'no contact matches']) { const dialog = await begin(session.page, 'Saisie seule fictive ' + query); await contactInput(dialog).fill(query); await contactInput(dialog).press('Enter'); assert.equal(await chosenContact(dialog).count(), 0); assert.equal(session.audit.mutations.length, query === 'anne' ? 0 : 1, 'Enter without active result never submits or chooses'); const saved = await confirmedSave(session, dialog); assert.equal(saved.contactId, ''); assert.equal(session.audit.mutations.at(-1).patch.contactId, ''); }
      clean(session);
    } finally { await session.context.close(); }
  });
  await check('Keyboard ArrowDown/ArrowUp/Enter picks only on Enter without form submission; Escape closes suggestions before dialog', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      const dialog = await begin(session.page, 'Clavier fictif'); await queryOptions(dialog, 'clem', ['Clément Minodier', 'Clément Minodier']); await contactInput(dialog).press('ArrowDown'); assert.ok(await contactInput(dialog).getAttribute('aria-activedescendant')); await contactInput(dialog).press('ArrowDown'); await contactInput(dialog).press('ArrowUp'); await contactInput(dialog).press('Enter'); await chosenContact(dialog).waitFor(); assert.equal(session.audit.mutations.length, 0);
      await contactInput(dialog).fill('anne'); await contactOptions(dialog).waitFor(); await contactInput(dialog).press('Escape'); assert.equal(await contactOptions(dialog).count(), 0); assert.ok(await dialog.isVisible()); assert.equal(session.audit.mutations.length, 0); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click(); clean(session);
    } finally { await session.context.close(); }
  });
  await check('Contact-origin draft prefills first name and surname, saves its exact ID only after explicit confirmation', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      await session.page.getByRole('button', { name: 'Créer depuis Contact (fixture)', exact: true }).click(); const dialog = session.page.getByRole('dialog', { name: 'Ajouter une tâche', exact: true }); await chosenContact(dialog).waitFor(); assert.ok((await chosenContact(dialog).innerText()).includes('Clément Minodier')); assert.equal(session.audit.mutations.length, 0); const saved = await confirmedSave(session, dialog); assert.equal(saved.contactId, contacts[0].id); clean(session);
    } finally { await session.context.close(); }
  });
  await check('No Contacts read produces no options; unreadable contact ID remains generic and is omitted from unrelated edit patch', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      await session.page.getByRole('button', { name: 'Retirer Contacts (fixture)', exact: true }).click(); const creation = await begin(session.page, 'Sans lecture Contacts fictif'); await contactInput(creation).fill('clem'); assert.equal(await contactOptions(creation).count(), 0); assert.equal(await chosenContact(creation).count(), 0); assert.ok(!(await creation.innerText()).includes('clement.a@example.invalid')); await creation.getByRole('button', { name: 'Annuler', exact: true }).click();
      const secret = 'unreadable-contact-id-fictional'; session.state.tasks.push(task(103, 'Référence indisponible fictive', { contactId: secret })); await session.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await card(session.page, id(103)).waitFor(); await card(session.page, id(103)).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = session.page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(edit).waitFor(); assert.ok(!(await edit.innerText()).includes(secret)); assert.ok(!(await edit.innerText()).includes('Clément')); await edit.locator('[name=notes]').fill('Correction sans toucher référence'); const saved = await confirmedSave(session, edit, false); assert.equal(saved.contactId, secret); assert.equal('contactId' in session.audit.mutations.at(-1).patch, false); clean(session);
    } finally { await session.context.close(); }
  });
  await check('Contacts option revocation removes stale selected labels and suggestions while preserving draft ID until explicit replacement/removal', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      session.state.tasks.push(task(104, 'Révocation fictive', { contactId: contacts[0].id })); await session.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await card(session.page, id(104)).waitFor(); await card(session.page, id(104)).getByRole('button', { name: 'Modifier', exact: true }).click(); const dialog = session.page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(dialog).waitFor(); await dialog.locator('[name=notes]').fill('Saisie privée maintenue'); await contactInput(dialog).fill('clem');
      await session.page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Retirer Contacts (fixture)'); button?.click(); });
      await until(async () => !(await dialog.innerText()).includes('clement.a@example.invalid'), 'Revocation removes stale authorized label'); assert.equal(await contactOptions(dialog).count(), 0); assert.ok(!(await dialog.innerText()).includes('Clément Minodier')); await fields(dialog, { title: 'Révocation fictive', notes: 'Saisie privée maintenue' }); const saved = await confirmedSave(session, dialog, false); assert.equal(saved.contactId, contacts[0].id); assert.equal('contactId' in session.audit.mutations.at(-1).patch, false, 'Existing reference omitted from unrelated edit after Contacts revocation'); clean(session);
    } finally { await session.context.close(); }
  });
  await check('Simulated save interruption preserves typed query, explicit contact, responsible chip and fields; conflict requires explicit revision acceptance', async () => {
    const session = await open(browser, 'chromium', 1440); try {
      const dialog = await begin(session.page, 'Erreur fictive'); await dialog.locator('[name=notes]').fill('Saisie erreur préservée'); await pickContact(dialog, 'clem', 'clement.b@example.invalid'); await responsibleSelect(dialog).selectOption(people.b.userId); await contactInput(dialog).fill('anne'); session.state.nextMutation = { kind: 'error' };
      await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click(); await until(async () => (await dialog.innerText()).includes('Connexion interrompue'), 'Simulated error reported'); assert.ok(await dialog.isVisible()); await fields(dialog, { title: 'Erreur fictive', notes: 'Saisie erreur préservée' }); assert.equal(await contactInput(dialog).inputValue(), 'anne'); assert.ok((await chosenContact(dialog).innerText()).includes('Clément Minodier')); assert.equal(await dialog.locator(`[data-task-recipient-id="${people.b.userId}"]`).count(), 1); const saved = await confirmedSave(session, dialog); assert.equal(saved.contactId, contacts[1].id); assert.equal(session.audit.mutations[0].requestId, session.audit.mutations[1].requestId, 'Identical retry keeps request ID');
      await card(session.page, saved.id).getByRole('button', { name: 'Modifier', exact: true }).click(); const edit = session.page.getByRole('dialog', { name: 'Modifier la tâche', exact: true }); await chosenContact(edit).waitFor(); await edit.locator('[name=notes]').fill('Saisie conflit préservée'); await clearContact(edit); await pickContact(edit, 'anne', 'Anne-Marie De La Résidence'); session.state.tasks = session.state.tasks.map(item => item.id === saved.id ? { ...item, title: 'Titre concurrent fictif', revision: item.revision + 1 } : item); await session.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await edit.locator('.taskws-conflict').waitFor(); assert.ok(await edit.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled()); await fields(edit, { notes: 'Saisie conflit préservée' }); assert.ok((await chosenContact(edit).innerText()).includes('Anne-Marie De La Résidence')); await edit.getByRole('button', { name: 'Reprendre sur cette révision avec ma saisie', exact: true }).click(); const updated = await confirmedSave(session, edit, false); assert.equal(updated.contactId, contacts[2].id); clean(session);
    } finally { await session.context.close(); }
  });
  await check('Limited readable projections: company present is searchable, company absent is not reconstructed; no extra request or email is fabricated', async () => {
    const session = await open(browser, 'chromium', 1440), { page, state, audit } = session;
    try {
      state.contacts = [
        { id: 'limited-company-fictional', firstName: 'Julien', name: 'Martin', companyName: 'Azur Services' },
        { id: 'limited-no-company-fictional', firstName: 'Camille', name: 'Laurent' },
      ];
      await page.reload(); await page.locator('[data-fixture-contacts-state=ready]').waitFor(); const dialog = await begin(page, 'Projection limitée fictive'); const requests = audit.fixtureRequests.length;
      const result = await queryOptions(dialog, 'azur', ['Julien Martin']); assert.ok(result[0].includes('Azur Services')); assert.ok(!result[0].includes('@'), 'Missing email is not reconstructed'); await queryOptions(dialog, 'camille azur', []); await queryOptions(dialog, 'camille', ['Camille Laurent']); assert.equal(await contactOptions(dialog).locator('small').count(), 0, 'Missing company is not reconstructed');
      assert.equal(audit.fixtureRequests.length, requests, 'Searching local readable fields makes no fetch'); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click(); clean(session);
    } finally { await session.context.close(); }
  });
  await browser.close(); browser = null;
  const webkitPath = '/private/tmp/monthly-charges-browsers/webkit-2336/pw_run.sh';
  assert.ok(existsSync(webkitPath), 'WebKit emulation runtime required for requested mobile proof');
  browser = await webkit.launch({ headless: true, executablePath: webkitPath });
  await check('WebKit 390 touch emulation: prior contact journey plus company search, dedup, interlocutor selection and no overflow', async () => { await journey(browser, 'webkit', 390); await companyJourney(browser, 'webkit', 390); });
} finally { await browser?.close(); save(); }
assert.equal(results.length, 10); assert.ok(results.every(result => result.passed), 'All UI fixture checks must pass');
