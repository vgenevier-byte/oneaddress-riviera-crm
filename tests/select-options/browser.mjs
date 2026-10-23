/** Integrated candidate CRM and Foncière UI; intercepted fictional HTTP only.
 * SELECT_OPTIONS_ACK=SELECT_OPTIONS_FICTION_ONLY node tests/select-options/browser.mjs
 * Local app must use NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4097 and a dummy public key.
 * Persistence is a Playwright route closure across reloads, never actual Auth/RPC/SQL.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFixture } from '../i18n/fixture.mjs';

assert.equal(process.env.SELECT_OPTIONS_ACK, 'SELECT_OPTIONS_FICTION_ONLY');
const origin = process.env.SELECT_OPTIONS_ORIGIN || 'http://127.0.0.1:3217';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const source = resolve(process.cwd());
assert.ok(source.startsWith('/private/tmp/'), 'Isolated candidate source only');
const output = resolve(process.env.SELECT_OPTIONS_OUTPUT || '/private/tmp/oar-select-options-evidence');
mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const stamp = '2026-10-23T12:00:00.000Z';
const clone = value => structuredClone(value);
const contact = (id, extra = {}) => ({ id, entityType: 'person', firstName: '', name: '', companyName: '', kind: 'Prestataire', email: '', phone: '', city: '', postalAddress: '', budget: 0, source: '', notes: '', createdAt: stamp, ...extra });
const initialContacts = [
  contact('fiction-zulu', { firstName: 'Zoé', name: 'Zulu', companyName: 'Zèbre commun', supplierCategory: 'Zingueur' }),
  contact('fiction-elec', { firstName: 'Élodie', name: 'Éclair', companyName: 'Élévation commun', supplierCategory: 'Électricien indépendant' }),
  contact('fiction-alpha', { firstName: 'Anne', name: 'Alpha', companyName: 'Azur commun', supplierCategory: 'Àide technique' }),
  contact('fiction-company-z', { entityType: 'company', companyName: 'Zèbre Agence commun', supplierCategory: 'Agence immobilière' }),
  contact('fiction-company-a', { entityType: 'company', companyName: 'Àzur Agence commun', supplierCategory: 'Agence immobilière' }),
  contact('fiction-company-e', { entityType: 'company', companyName: 'Élévation Agence commun', supplierCategory: 'Agence immobilière' }),
  contact('fiction-secret', { name: 'SECRET PROJECTION INTERDITE', companyName: 'Secret commun', supplierCategory: 'SECRET MÉTIER INTERDIT' }),
];
const results = [], sessions = [];
const sourceFiles = ['components/CRMApp.tsx', 'components/ModuleWorkspace.tsx', 'components/SearchableBusinessContactPicker.tsx', 'components/TaskContactPicker.tsx', 'lib/selectOptions.ts'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(source, path))).digest('hex') }));
function save() {
  writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ source, origin, sourceFiles, results, fictionalFixture: true, integratedCRMAndFonciereRendered: true, actualAuth: false, actualRPC: false, actualDatabase: false, actualProduction: false, productionWrites: 0, externalCalls: 0, accountsCreated: 0, physicalDevice: false, persistence: 'In-memory intercepted HTTP across reloads', sessions: sessions.map(({ profile, width, audit }) => ({ profile, width, audit })) }, null, 2) + '\n');
}
async function check(name, fn) {
  if (process.env.SELECT_OPTIONS_SCENARIO && !name.includes(process.env.SELECT_OPTIONS_SCENARIO)) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); process.exitCode = 1; }
  finally { save(); }
}
async function open(browser, profile = 'full', width = 1440, module = 'contacts') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 500, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  const fixture = createFixture(profile === 'full' ? 'full' : 'limited');
  if (profile !== 'full') fixture.setAccess({ allowed: ['contacts', 'tasks', 'izord'], admin: false, full: false });
  fixture.payload.contacts = clone(initialContacts.filter(row => profile === 'full' || row.id !== 'fiction-secret'));
  let revision = stamp;
  const projects = [], links = new Map();
  const audit = { blocked: [], errors: [], reads: [], mutations: [], projections: [], globalReads: 0, simulatedProjectSaves: 0 };
  const session = { context, profile, width, fixture, audit }; sessions.push(session);
  const projection = () => ({ revision, collections: { contacts: clone(fixture.payload.contacts) } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === 'http://127.0.0.1:4097') {
      let body = {}; try { body = request.postDataJSON() || {}; } catch {}
      const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: value === null ? '' : JSON.stringify(value) });
      if (request.method() === 'OPTIONS') return reply(null, 204);
      const rpc = path.split('/rest/v1/rpc/')[1];
      audit.reads.push({ method: request.method(), path, module: body.p_module });
      if (path === '/rest/v1/app_memberships') return reply([{ workspace_id: 'oar', role: 'member' }, { workspace_id: 'izord', role: 'contributor' }]);
      if (rpc === 'crm_read_module' && body.p_module === 'contacts') { audit.projections.push(fixture.payload.contacts.map(row => row.id)); return reply(projection()); }
      if (rpc === 'crm_mutate_record' && body.p_collection === 'contacts') {
        assert.equal(body.p_revision, revision, 'Confirmed fixture revision required');
        audit.mutations.push(clone(body));
        const previous = fixture.payload.contacts.find(row => row.id === body.p_id);
        fixture.payload.contacts = fixture.payload.contacts.filter(row => row.id !== body.p_id);
        if (!body.p_delete) fixture.payload.contacts.push({ ...contact(body.p_id), ...previous, ...body.p_patch });
        revision = new Date(Date.parse(revision) + 1000).toISOString();
        return reply(projection());
      }
      if (path === '/rest/v1/crm_workspace_state') {
        assert.equal(profile, 'full', 'Limited fixture must never read global workspace');
        assert.equal(request.method(), 'GET', 'Only targeted contact mutation allowed'); audit.globalReads++;
        return reply({ payload: fixture.payload, updated_at: revision });
      }
      if (path === '/rest/v1/fonciere_projects') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        return reply(id ? projects.find(row => row.id === id) : projects);
      }
      if (path === '/rest/v1/fonciere_project_contacts') {
        const id = url.searchParams.get('project_id')?.replace(/^eq\./, ''); return reply(links.get(id) || null);
      }
      if (path === '/rest/v1/fonciere_assets') return reply([]);
      if (rpc === 'fonciere_save_project') {
        audit.simulatedProjectSaves++;
        const id = body.p_id || crypto.randomUUID(), existing = projects.find(row => row.id === id);
        const record = { id, owner_id: fixture.user.id, title: body.p_payload.data.name, revision: (existing?.revision || 0) + 1, status: 'active', payload: clone(body.p_payload), created_at: stamp, updated_at: stamp };
        projects.splice(0, projects.length, ...projects.filter(row => row.id !== id), record);
        links.set(id, { contact_id: body.p_contact || null, agency_contact_id: body.p_agency_contact || null }); return reply(id);
      }
      if (rpc === 'fonciere_access_options') return reply([]);
      if (rpc === 'crm_contact_documents') return reply({ revision, documents: [], reads: {} });
      const response = fixture.respond(request.method(), url, body);
      if (response.status >= 400) audit.blocked.push(request.method() + ' ' + path);
      return reply(response.body, response.status);
    }
    if (url.origin === origin && !path.startsWith('/api/')) return route.continue();
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
    audit.blocked.push(request.method() + ' ' + url.origin + path); return route.abort();
  });
  const page = await context.newPage(); session.page = page; page.setDefaultTimeout(20000);
  page.on('pageerror', error => audit.errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(origin + (module === 'fonciere' ? '/fonciere' : '/?module=' + module));
  await page.getByLabel('Email', { exact: true }).fill(fixture.user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('Fictional-UI-Only!');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.crm-shell:visible').first().waitFor({ timeout: 90000 });
  if (module === 'contacts') await page.locator('.oar-contact-row').filter({ hasText: 'Élodie Éclair' }).waitFor();
  if (module === 'fonciere') await navigate(page, 'fonciere');
  return session;
}
async function lang(page, language) {
  const mobile = page.viewportSize().width < 1024;
  if (mobile) await page.locator('#unified-more-trigger:visible').first().click();
  await page.locator('[data-language-selector]:visible').first().locator(`button[lang="${language === 'en' ? 'en-GB' : 'fr'}"]`).click();
  await page.waitForFunction(expected => document.documentElement.lang === expected, language === 'en' ? 'en-GB' : 'fr');
  if (mobile) await page.locator('.unified-more-close:visible').first().click();
}
async function navigate(page, module) {
  const mobile = page.viewportSize().width < 1024;
  if (mobile) await page.locator('#unified-more-trigger:visible').first().click();
  const menu = page.locator(mobile ? '#unified-more-panel:visible' : '.sidebar:visible').first();
  let item = menu.locator(`[data-navigation-module="${module}"]`);
  if (!await item.isVisible()) { await menu.locator(`[data-navigation-group="${module === 'fonciere' ? 'fonciere' : 'operations'}"]`).click(); item = menu.locator(`[data-navigation-module="${module}"]`); }
  await item.click();
}
const form = page => page.locator('.contact-create-form:visible');
async function assertAlphabetical(select, language, { first = [''], last = [] } = {}) {
  const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent.trim() })));
  const ordinary = options.filter(option => !first.includes(option.value) && !last.includes(option.value));
  const sorted = [...ordinary].sort((a, b) => new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare(a.label, b.label));
  assert.deepEqual(ordinary, sorted, 'Options follow displayed labels in ' + language);
  if (first.length) assert.ok(first.includes(options[0].value), 'Prompt remains first');
  if (last.length) assert.ok(last.includes(options.at(-1).value), 'Complement remains last');
  return options;
}
function boundaries(session) {
  assert.deepEqual(session.audit.blocked, []); assert.deepEqual(session.audit.errors, []);
  if (session.profile !== 'full') {
    assert.equal(session.audit.globalReads, 0);
    assert.ok(session.audit.projections.every(ids => !ids.includes('fiction-secret')));
  }
}
async function suppliers(browser, width, profile = 'full') {
  const session = await open(browser, profile, width), { page, fixture, audit } = session;
  try {
    await form(page).waitFor();
    await form(page).locator('[name=kind]').selectOption('Prestataire');
    const select = form(page).locator('select[name=supplierCategory]');
    const before = await assertAlphabetical(select, 'fr', { first: [''], last: ['Autre'] });
    assert.ok(before.some(option => option.value === 'Électricien indépendant'));
    await form(page).locator('[name=name]').fill('Essai Liste Fictive');
    await select.selectOption('Électricité');
    await lang(page, 'en');
    assert.equal(await select.inputValue(), 'Électricité');
    await assertAlphabetical(select, 'en', { first: [''], last: ['Autre'] });
    await lang(page, 'fr');
    assert.equal(await select.inputValue(), 'Électricité');
    await assertAlphabetical(select, 'fr', { first: [''], last: ['Autre'] });
    assert.equal(audit.mutations.length, 0, 'Reordering/language switching never saves');
    await select.selectOption('Autre');
    await form(page).locator('[name=supplierCategoryCustom]').fill('Ébéniste très spécial');
    await form(page).locator('button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('.contact-create-form [name=name]')?.value === '');
    const saved = fixture.payload.contacts.find(row => row.name === 'Essai Liste Fictive'); assert.ok(saved);
    assert.equal(saved.supplierCategory, 'Ébéniste très spécial'); assert.equal(audit.mutations.length, 1);
    await form(page).locator('[name=kind]').selectOption('Prestataire');
    const after = await assertAlphabetical(select, 'fr', { first: [''], last: ['Autre'] });
    assert.ok(after.some(option => option.value === saved.supplierCategory), 'New custom profession appears in creation options');
    await page.locator('.contacts-toolbar:visible').getByRole('button', { name: 'Prestataires', exact: true }).click();
    const filter = page.locator('.contacts-toolbar-stable-supplier-filter select');
    await assertAlphabetical(filter, 'fr', { first: ['Toutes'], last: ['Autre'] });
    await filter.selectOption(saved.supplierCategory); assert.equal(await page.locator('.oar-contact-row:visible').count(), 1);
    await page.locator('.oar-contact-row:visible').getByRole('button', { name: 'Modifier', exact: true }).click();
    const edit = page.locator('.contact-edit-form:visible'), editSelect = edit.locator('[name=supplierCategory]');
    assert.equal(await editSelect.inputValue(), saved.supplierCategory);
    await assertAlphabetical(editSelect, 'fr', { first: [''], last: ['Autre'] });
    await edit.locator('[name=supplierCategory]').selectOption('Électricité');
    await edit.locator('button[type=submit]').click(); await edit.waitFor({ state: 'hidden' });
    assert.equal(fixture.payload.contacts.find(row => row.id === saved.id).supplierCategory, 'Électricité');
    assert.equal(audit.mutations.length, 2);
    await page.reload(); await form(page).waitFor();
    const row = page.locator('.oar-contact-row').filter({ hasText: 'Essai Liste Fictive' }); await row.waitFor();
    await row.getByRole('button', { name: 'Modifier', exact: true }).click();
    assert.equal(await page.locator('.contact-edit-form [name=supplierCategory]').inputValue(), 'Électricité');
    await page.screenshot({ path: join(output, `suppliers-${profile}-${width}.png`), fullPage: true });
    boundaries(session);
  } finally { await session.context.close(); }
}
async function fonciere(browser, profile, width) {
  const session = await open(browser, profile, width, 'fonciere'), { page, audit, fixture } = session;
  try {
    audit.phase = 'open project workspace';
    const workspace = page.locator('[data-fonciere-projects]:visible'); await workspace.waitFor();
    await workspace.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
    await workspace.locator('#fonciere-name').fill('Projet tri fictif ' + profile);
    const agency = workspace.getByRole('combobox', { name: 'Agence / entreprise du CRM', exact: true });
    await agency.fill('commun');
    const picker = workspace.locator('.business-contact-picker-field').filter({ hasText: 'Agence / entreprise du CRM' });
    await picker.getByRole('option').first().waitFor();
    const names = await picker.getByRole('option').locator('strong').allTextContents();
    assert.deepEqual(names, [...names].sort(new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare));
    if (profile !== 'full') assert.equal(names.some(name => name.includes('SECRET')), false);
    await agency.press('ArrowDown'); await agency.press('Enter');
    const chosenId = await workspace.locator('input[name=agencyContactId]').inputValue();
    assert.equal(chosenId, 'fiction-company-a', 'Keyboard picks alphabetically first company exact ID');
    assert.equal(audit.mutations.length, 0);
    const name = await workspace.locator('#fonciere-name').inputValue();
    audit.phase = 'contact creation';
    await workspace.getByRole('button', { name: 'Créer un contact', exact: true }).click();
    await form(page).waitFor();
    if (profile === 'full') await page.locator('.oar-contact-row:visible').filter({ hasText: 'Élodie Éclair' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('module'), 'contacts');
    await form(page).locator('[name=kind]').selectOption('Prestataire');
    await assertAlphabetical(form(page).locator('[name=supplierCategory]'), 'fr', { first: [''], last: ['Autre'] });
    await form(page).locator('[name=name]').fill('Création Retour Fictive ' + profile);
    await form(page).locator('[name=supplierCategory]').selectOption('Électricité');
    await lang(page, 'en');
    assert.equal(await form(page).locator('[name=supplierCategory]').inputValue(), 'Électricité');
    await assertAlphabetical(form(page).locator('[name=supplierCategory]'), 'en', { first: [''], last: ['Autre'] });
    await lang(page, 'fr');
    audit.phase = 'save contact and return';
    await form(page).locator('button[type=submit]').click();
    await workspace.waitFor();
    assert.equal(await workspace.locator('#fonciere-name').inputValue(), name);
    assert.equal(await workspace.locator('input[name=agencyContactId]').inputValue(), chosenId);
    const savedContact = fixture.payload.contacts.find(row => row.name === 'Création Retour Fictive ' + profile); assert.ok(savedContact);
    assert.equal(await workspace.locator('input[name=agentContactId]').inputValue(), savedContact.id);
    assert.equal(audit.mutations.length, 1, 'One explicit fixture save creates the contact');
    audit.phase = 'save project';
    await workspace.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
    await workspace.getByText(/Informations et documents enregistrés/).waitFor();
    assert.ok(audit.simulatedProjectSaves > 0);
    audit.phase = 'reload project workspace';
    await page.reload(); await workspace.waitFor();
    const openProject = workspace.getByRole('button').filter({ hasText: 'Projet tri fictif ' + profile }).first();
    if (await openProject.count()) await openProject.click();
    await workspace.locator('#fonciere-name').waitFor();
    assert.equal(await workspace.locator('input[name=agentContactId]').inputValue(), savedContact.id);
    assert.equal(await workspace.locator('input[name=agencyContactId]').inputValue(), chosenId);
    await page.screenshot({ path: join(output, `fonciere-${profile}-${width}.png`), fullPage: true });
    boundaries(session);
  } catch (error) {
    audit.failure = { phase: audit.phase, url: page.url(), text: (await page.locator('body').innerText()).slice(-18000) };
    await page.screenshot({ path: join(output, `failure-fonciere-${profile}-${width}.png`), fullPage: true });
    throw new Error(audit.phase + ': ' + error.message);
  } finally { await session.context.close(); }
}
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking', '--disable-component-update'] });
  await check('Contacts full desktop: professions creation/edit/filter, accents, Other last, FR→EN→FR retains canonical value, explicit save/reload', () => suppliers(browser, 1440));
  await check('Contacts full touch viewport: same profession journey and canonical save/reload', () => suppliers(browser, 390));
  await check('Contacts limited touch viewport: authorized profession creation/edit/filter, FR→EN→FR retains value and simulated save/reload, no global read', () => suppliers(browser, 390, 'limited'));
  await check('Foncière full: authorized company order, keyboard exact ID, contact creation/return keeps draft, bilingual options, simulated save/reload', () => fonciere(browser, 'full', 1440));
  await check('Foncière limited touch viewport: projected options, no global workspace read, contact creation/return, simulated save/reload', () => fonciere(browser, 'limited', 390));
} finally { await browser?.close(); save(); }
assert.ok(results.every(result => result.passed), 'All browser fixture checks pass');
