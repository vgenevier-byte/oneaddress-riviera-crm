/** Actual AccessPortal -> CRMApp / ModuleWorkspace; fictional intercepted Auth/REST only.
 * Serve an isolated source-identical Next app using dummy Supabase env pointing to
 * http://127.0.0.1:3997, then run with CONTACT_SUGGESTIONS_ACK=CONTACTS_UI_FICTION_ONLY,
 * CONTACT_SUGGESTIONS_URL=http://127.0.0.1:<port>, CONTACT_SUGGESTIONS_SOURCE and
 * CONTACT_SUGGESTIONS_SERVED_SOURCE pointing to isolated /private/tmp source directories.
 * CONTACT_SUGGESTIONS_BASELINE=1 reproduces the prior direct-only behavior.
 * Optional PLAYWRIGHT_MODULE / PLAYWRIGHT_BROWSERS_PATH select installed browsers.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.env.CONTACT_SUGGESTIONS_ACK, 'CONTACTS_UI_FICTION_ONLY');
const origin = process.env.CONTACT_SUGGESTIONS_URL;
assert.ok(origin && ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Isolated loopback app only');
const source = resolve(process.env.CONTACT_SUGGESTIONS_SOURCE || process.cwd());
const servedSource = resolve(process.env.CONTACT_SUGGESTIONS_SERVED_SOURCE || source);
const output = resolve(process.env.CONTACT_SUGGESTIONS_OUTPUT || '/private/tmp/oar-contacts-suggestions-browser-evidence');
assert.ok([source, servedSource, output].every(path => path.startsWith('/private/tmp/')), 'Isolated source and evidence only');
mkdirSync(output, { recursive: true });
const baseline = process.env.CONTACT_SUGGESTIONS_BASELINE === '1', phase = baseline ? 'before' : 'after';
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceFiles = ['components/AccessPortal.tsx', 'components/CRMApp.tsx', 'components/ModuleWorkspace.tsx', 'components/MobileCRMHeader.tsx', 'lib/contactSearch.ts', 'lib/contactSuggestions.ts', 'lib/tasks/contactOptions.ts', 'app/globals.css'].filter(path => existsSync(join(source, path))).map(path => {
  const sha256 = hash(join(source, path));
  assert.equal(hash(join(servedSource, path)), sha256, 'Exact served source: ' + path);
  return { path, sha256 };
});
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const modules = ['dashboard', 'contacts', 'leads', 'tasks', 'quotes', 'bookings', 'vendorQuotes', 'vendorInvoices', 'houseTracking', 'documents', 'planning', 'properties', 'vehicles', 'boats', 'izord', 'publisher', 'monthlyCharges'];
const collections = ['contacts', 'leads', 'properties', 'vehicles', 'boats', 'tasks', 'suppliers', 'planningEntries', 'quotes', 'documents', 'vendorQuotes', 'vendorInvoices', 'houseTrackingHouses', 'houseTrackingWorkers', 'houseTimeEntries', 'housePayments'];
const stamp = '2026-10-08T12:00:00.000Z';
const contact = (id, extras = {}) => ({ id, name: '', kind: 'Client', email: '', phone: '', city: '', postalAddress: '', budget: 0, source: '', notes: '', createdAt: stamp, ...extras });
const professionName = 'Nettoyage fictif sur mesure';
const contacts = [
  contact('fictional-supplier', { firstName: 'Dylan', name: 'Charmillon', companyName: 'Nettoyage Dylan Charmillon', kind: 'Prestataire', supplierCategory: professionName, email: 'dy-contact@example.invalid', phone: '+33 6 44 55 66 77', city: 'Menton', postalAddress: '14 rue des Cyprès', supplierZone: 'Ouest fictif', supplierReliability: 'Très fiable', notes: 'NOTE_NON_SEARCHABLE_FICTION', supplierBankAccounts: [{ id: 'fictional-bank', accountHolder: 'BANK_NON_SEARCHABLE_FICTION', iban: 'FICTIONAL_IBAN_DO_NOT_USE', bic: 'FICTIONAL_BIC', status: 'À vérifier', isPrimary: true, createdAt: stamp }] }),
  contact('fictional-homonym', { firstName: 'Dylan', name: 'Charmillon', companyName: 'Atelier Charmillon', kind: 'Prestataire', supplierCategory: 'Plombier', email: 'homonym@example.invalid' }),
  contact('fictional-client', { firstName: 'Dylan', name: 'Charmillon', companyName: 'Client fictif indépendant' }),
  contact('fictional-owner', { firstName: 'Dylan', name: 'Charmillon', companyName: 'Patrimoine fictif', kind: 'Propriétaire' }),
  contact('fictional-member', { firstName: 'Dylan', name: 'Charmillon', kind: 'Membre de l’organisation', organizationFunction: 'Intendance fictive' }),
  contact('fictional-clement', { firstName: 'Clément', name: 'Minodier', companyName: 'Élévation Île' }),
  contact('fictional-decomposed', { firstName: 'Cle\u0301ment', name: 'Unicode', companyName: 'Cafe\u0301 de la Co\u0302te' }),
  contact('fictional-composed', { firstName: 'Anne-Marie', name: 'De La Résidence', companyName: 'Société composée fictive' }),
  contact('fictional-company-only', { firstName: undefined, companyName: 'Société Riviera fictive' }),
  contact('fictional-firstname-only', { firstName: 'Élodie' }),
  contact('fictional-missing', { firstName: undefined, companyName: undefined, email: 'missing@example.invalid' }),
  contact('z-fictional-excluded', { firstName: 'Dylan', name: 'Charmillon', companyName: 'PROJECTION_SECRET_FICTION', email: 'hidden@example.invalid' })
];
const fixtureFingerprint = JSON.stringify(contacts);
const heading = item => [item.civility, item.firstName, item.name].filter(Boolean).join(' ').trim() || item.companyName || item.email || item.phone || 'Contact sans nom';
const projectionContacts = (profile, collection = contacts) => profile === 'owner' ? collection : collection.filter(item => item.id !== 'z-fictional-excluded').map(({ supplierBankAccounts, ...allowed }) => allowed);
const sessions = [], results = [];
function save() {
  writeFileSync(join(output, phase + '-results.json'), JSON.stringify({ source, servedSource, origin, sourceFiles, results, fictionalFixture: true, actualComponents: ['AccessPortal', 'CRMApp', 'ModuleWorkspace', 'ContactsView', 'MobileCRMHeader'], actualAuth: false, actualRPC: false, actualDatabase: false, actualProduction: false, accountsCreated: 0, businessWrites: 0, remoteCalls: 0, physicalDevice: false, sessions: sessions.map(({ profile, engine, width, audit, size }) => ({ profile, engine, width, size, audit })) }, null, 2) + '\n');
}
async function open(browser, engine, width, profile, collection = contacts) {
  const owner = profile === 'owner';
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: engine === 'webkit' && width < 500, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  const grants = Object.fromEntries(modules.map(module => [module, { level: owner || module === 'contacts' && profile === 'limited-contribute' ? 'contribute' : module === 'contacts' ? 'read' : 'none', sensitive: owner ? { delete: true, export: true } : {} }]));
  const access = { revision: 1, active: true, generalAdmin: owner, fullAccess: owner, modules: grants };
  const user = { id: owner ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated', email: profile + '@example.invalid', email_confirmed_at: stamp, app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: stamp };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, exp: 4102444800 })).toString('base64url'), 'fictional-local-signature'].join('.');
  const available = projectionContacts(profile, collection);
  const payload = Object.fromEntries(collections.map(key => [key, key === 'contacts' ? available : []]));
  const projection = { revision: stamp, collections: { contacts: available } };
  const audit = { requests: [], blocked: [], errors: [], writes: [], snapshots: [], explicitDetailsIds: [], queryChecks: [] };
  const session = { context, profile, engine, width, audit, available, size: available.length, query: '' }; sessions.push(session);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = value => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });
    if (url.origin === 'http://127.0.0.1:3997') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const rpc = path.split('/rest/v1/rpc/')[1], args = request.method() === 'POST' ? request.postDataJSON() : null;
      audit.requests.push({ method: request.method(), path, args });
      if (path === '/auth/v1/token') return reply({ access_token: token, refresh_token: 'fictional-refresh-token', token_type: 'bearer', expires_in: 31536000, user });
      if (path === '/auth/v1/user') return reply(user);
      if (path === '/rest/v1/app_memberships') return reply([{ workspace_id: 'oar', role: 'member' }]);
      if (rpc === 'crm_access_snapshot') return reply(access);
      if (rpc === 'crm_tasks_read' && owner) return reply([]);
      if (rpc === 'crm_read_module' && args?.p_module === 'contacts' && !owner) { audit.snapshots.push({ count: available.length, ids: available.slice(0, contacts.length).map(item => item.id), fields: Object.keys(available[0]) }); return reply(projection); }
      if (path === '/rest/v1/crm_workspace_state' && owner && request.method() === 'GET') return reply({ payload, updated_at: stamp });
      if (rpc === 'crm_contact_documents' && audit.explicitDetailsIds.includes(args?.p_contact) && available.some(item => item.id === args?.p_contact)) return reply({ revision: stamp, documents: [], reads: {} });
      if (request.method() !== 'GET') audit.writes.push({ path, args });
      audit.blocked.push(request.method() + ' ' + url.origin + path); return route.abort();
    }
    if (url.origin === origin && !path.startsWith('/api/')) return route.continue();
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
    audit.blocked.push(request.method() + ' ' + url.origin + path); return route.abort();
  });
  const page = await context.newPage(); session.page = page; page.setDefaultTimeout(10000);
  page.on('pageerror', error => audit.errors.push(error.message));
  await page.goto(origin + '/?module=contacts');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('Fictional-UI-Only-Password!');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.oar-contacts-workspace').waitFor({ timeout: 90000 });
  await assertDirect(session, available.map(item => item.id));
  return session;
}
const rows = page => page.locator('.oar-contact-row');
const toolbar = page => page.locator('.contacts-toolbar');
const search = page => page.locator('input[type="search"]:visible');
const closeItems = page => page.locator('[data-contact-suggestion-id]');
async function assertDirect(session, ids) {
  const expected = session.available.filter(item => ids.includes(item.id)).map(heading).sort();
  const { page } = session;
  await page.waitForFunction(count => document.querySelectorAll('.oar-contact-row').length === count, expected.length, { timeout: session.size > 1000 ? 20000 : 5000 }).catch(async error => { throw new Error(error.message + ' actual direct=' + JSON.stringify(await rows(page).locator('h3').allTextContents())); });
  assert.deepEqual((await rows(page).locator('h3').allTextContents()).sort(), expected, 'Exact authorized direct list');
  const count = baseline ? toolbar(page).locator('.contacts-toolbar-stable-count strong') : page.locator('[data-contact-direct-count]');
  assert.equal(Number(await count.innerText()), expected.length, 'Direct result counter equals direct rows');
}
async function assertClose(session, expected = null) {
  const { page } = session;
  if (expected) await page.waitForFunction(length => document.querySelectorAll('[data-contact-suggestion-id]').length === length, expected.length, { timeout: 5000 });
  const ids = await closeItems(page).evaluateAll(items => items.map(item => item.getAttribute('data-contact-suggestion-id')));
  assert.ok(ids.length <= 5, 'Suggestions bounded to five');
  assert.equal(new Set(ids).size, ids.length, 'Suggestion IDs unique');
  for (const id of ids) {
    const saved = session.available.find(item => item.id === id); assert.ok(saved, 'Suggestion belongs to authorized projection');
    const item = page.locator(`[data-contact-suggestion-id="${id}"]`);
    assert.ok((await item.innerText()).includes(heading(saved)), 'Suggestion displays unchanged stored name');
    if (saved.companyName) assert.ok((await item.innerText()).includes(saved.companyName), 'Suggestion displays stored company');
    assert.equal(await item.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).count(), 1, 'Only explicit opening control');
  }
  if (expected) assert.deepEqual([...ids].sort(), [...expected].sort(), 'Exact expected nearby suggestions');
  if (!baseline) {
    const count = page.locator('[data-contact-suggestion-count]');
    if (session.query.trim()) assert.equal(Number(await count.innerText()), ids.length, 'Separate suggestion count matches close list');
    else { assert.equal(await count.count(), 0, 'Empty search has no extra result counter'); assert.equal(ids.length, 0, 'Empty search has no nearby group'); }
    if (ids.length) assert.equal(await page.locator('[data-contact-suggestions]').getByRole('heading', { name: 'Correspondances proches', exact: true }).count(), 1, 'Visible separate nearby group');
  }
  return ids;
}
async function query(session, value, direct = [], nearby = null) {
  const { page } = session;
  if (await search(page).count() === 0) await page.getByRole('button', { name: 'Ouvrir la recherche', exact: true }).click();
  assert.equal(await search(page).count(), 1, 'One visible existing band search');
  session.query = value; await search(page).fill(value); await assertDirect(session, direct); const ids = await assertClose(session, nearby);
  assert.equal(await search(page).inputValue(), value, 'Query is never silently corrected');
  const bounds = await search(page).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= session.width + 1, 'Band search fits viewport');
  session.audit.searchBounds = bounds;
  session.audit.queryChecks.push({ query: value, direct: direct.length, close: ids });
  if (await page.locator('.mobile-search-sheet').count()) {
    if (value === 'Chamillon') await page.screenshot({ path: join(output, `${phase}-${session.engine}-${session.width}-${session.profile}-search.png`) });
    await page.getByRole('button', { name: 'Afficher les résultats', exact: true }).click();
  }
  return ids;
}
async function category(session, label) { await toolbar(session.page).getByRole('button', { name: label, exact: true }).click(); }
const businessReads = session => session.audit.requests.filter(item => /crm_read_module|crm_workspace_state|crm_reference_options|crm_contact_documents|bank/i.test(item.path)).map(item => ({ path: item.path, args: item.args }));
function boundaries(session) {
  assert.deepEqual(session.audit.blocked, [], 'No external or forbidden request');
  assert.deepEqual(session.audit.writes, [], 'No business write');
  assert.deepEqual(session.audit.errors, [], 'No runtime/hydration error');
  if (session.profile !== 'owner') {
    assert.ok(!session.audit.requests.some(item => /crm_workspace_state|crm_reference_options|bank/i.test(item.path)), 'Limited account never reads global catalog or banking');
    assert.ok(session.audit.requests.filter(item => item.path.includes('/rpc/')).every(item => ['crm_access_snapshot', 'crm_read_module', 'crm_contact_documents'].some(name => item.path.endsWith('/' + name))), 'Only existing authorized projection and explicit exact-ID Details read');
    assert.ok(session.audit.snapshots.length > 0);
    assert.ok(session.audit.snapshots.every(item => !item.ids.includes('z-fictional-excluded') && !item.fields.includes('supplierBankAccounts')), 'Forbidden contact and banking absent from projection');
  }
  assert.equal(JSON.stringify(contacts), fixtureFingerprint, 'Original stored fixture values unchanged');
}
async function explicitOpen(session, id) {
  const { page } = session, item = page.locator(`[data-contact-suggestion-id="${id}"]`);
  session.audit.explicitDetailsIds.push(id);
  await item.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  const detail = page.locator('#contact-detail-panel'); await detail.waitFor();
  const saved = session.available.find(item => item.id === id);
  assert.ok((await detail.innerText()).includes(heading(saved)));
  if (saved.companyName) assert.ok((await detail.innerText()).includes(saved.companyName), 'Explicit homonym ID opens its own company');
  await detail.getByRole('button', { name: 'Fermer', exact: true }).click();
  return saved;
}
async function preserveDraft(session) {
  if (session.profile === 'limited-read') return;
  const { page } = session, form = page.locator('.contact-create-form');
  await form.locator('[name=firstName]').fill('Ébauche fictive'); await form.locator('[name=name]').fill('À préserver'); await form.locator('[name=email]').fill('draft@example.invalid');
  const notes = await form.locator('[name=notes]').count() === 1;
  if (notes) await form.locator('[name=notes]').fill('Brouillon ligne 1\nBrouillon ligne 2');
  await query(session, 'nettoyge', [], ['fictional-supplier']);
  session.audit.explicitDetailsIds.push('fictional-supplier');
  await closeItems(page).getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
  const detail = page.locator('#contact-detail-panel'); await detail.waitFor();
  const modalCanSearch = session.width >= 500 || session.profile !== 'owner';
  if (modalCanSearch) await query(session, 'zxqv-absent-fiction', [], []);
  assert.ok((await detail.innerText()).includes('Dylan Charmillon'), 'Selected stored fiche retained after filtering');
  await detail.getByRole('button', { name: 'Modifier', exact: true }).click();
  const edit = page.locator('.contact-edit-form'); await edit.waitFor();
  await edit.locator('[name=name]').fill('Brouillon édition fictif');
  if (modalCanSearch) await query(session, 'clement', ['fictional-clement', 'fictional-decomposed'], []);
  assert.equal(await edit.locator('[name=name]').inputValue(), 'Brouillon édition fictif');
  assert.equal(await edit.locator('[name=firstName]').inputValue(), 'Dylan');
  await edit.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await form.locator('[name=firstName]').inputValue(), 'Ébauche fictive'); assert.equal(await form.locator('[name=name]').inputValue(), 'À préserver'); assert.equal(await form.locator('[name=email]').inputValue(), 'draft@example.invalid');
  if (notes) assert.equal(await form.locator('[name=notes]').inputValue(), 'Brouillon ligne 1\nBrouillon ligne 2');
}
async function journey(session) {
  const { page, profile } = session;
  const all = session.available.map(item => item.id);
  const family = all.filter(id => ['fictional-supplier', 'fictional-homonym', 'fictional-client', 'fictional-owner', 'fictional-member', 'z-fictional-excluded'].includes(id));
  const readsBefore = businessReads(session);
  for (const value of ['char', 'charmillon', 'Dylan Charmillon', 'Charmillon Dylan', '  DYLAN   CHARMILLON  ', 'dylan']) await query(session, value, family, []);
  await query(session, 'nettoyage dylan charmillon', ['fictional-supplier'], []);
  await query(session, 'clement', ['fictional-clement', 'fictional-decomposed'], []);
  await query(session, 'île minodier elev', ['fictional-clement'], []);
  await query(session, 'residence anne marie', ['fictional-composed'], []);
  for (const value of ['dy-contact@example.invalid', '44 55 66', 'Menton', 'cypres', 'ouest fictif', 'tres fiable', professionName]) await query(session, value, ['fictional-supplier'], []);
  await query(session, 'Intendance fictive', ['fictional-member'], []);
  await query(session, 'missing@example.invalid', ['fictional-missing'], []);
  const stable = await query(session, 'Chamillon', [], null);
  assert.equal(stable.length, 5, 'Top-five cap applies after active filters');
  assert.ok(stable.includes('fictional-supplier') && stable.includes('fictional-homonym'), 'Homonyms remain separate exact IDs');
  for (const value of ['charmilon', 'chramillon', 'cham', 'dylan chamillon', 'Chamillon Dylan', '  DYLAN   CHÁMILLON  ', 'CHA\u0301MILLON', 'Dlyan']) {
    const ids = await query(session, value, [], null); assert.ok(ids.includes('fictional-supplier'), 'Mechanical nearby target: ' + value); assert.ok(ids.every(id => family.includes(id)), 'No unrelated contact suggestion');
  }
  assert.deepEqual(await query(session, 'Chamillon', [], null), stable, 'Suggestion rank/order stable across repeated search');
  await query(session, 'nettoyge', [], ['fictional-supplier']);
  await query(session, 'riveira', [], ['fictional-company-only']);
  await query(session, 'elodoe', [], ['fictional-firstname-only']);
  await query(session, 'residance anne', [], ['fictional-composed']);
  for (const value of ['ch', 'cha', 'd']) await query(session, value, value === 'd' ? all.filter(id => id !== 'fictional-company-only') : family, []);
  for (const value of ['zxqv trtt', 'Dlyna Chamllon', 'dy-contat@example.invalid', '44556678', 'NOTE_NON_SEARCHABLE_FICTION', 'BANK_NON_SEARCHABLE_FICTION', 'FICTIONAL_IBAN_DO_NOT_USE', 'DOCUMENT_NON_SEARCHABLE_FICTION']) await query(session, value, [], []);
  if (profile !== 'owner') { await query(session, 'PROJECTION_SECRET_FICTION', [], []); await query(session, 'hidden@example.invalid', [], []); }
  assert.equal(await page.locator('#contact-detail-panel, .contact-edit-form').count(), 0, 'Typing never implicitly selects or opens a contact');
  for (const [label, ids] of [['Clients', ['fictional-client', ...(profile === 'owner' ? ['z-fictional-excluded'] : [])]], ['Prestataires', ['fictional-supplier', 'fictional-homonym']], ['Propriétaires', ['fictional-owner']], ['Membres de l’organisation', ['fictional-member']]]) {
    await category(session, label); await query(session, 'Charmillon', ids, []); await query(session, 'Chamillon', [], ids);
    const categoryAll = session.available.filter(item => label === 'Clients' ? item.kind === 'Client' : label === 'Prestataires' ? item.kind === 'Prestataire' : label === 'Propriétaires' ? item.kind === 'Propriétaire' : item.kind === 'Membre de l’organisation').map(item => item.id);
    await query(session, '', categoryAll, []);
    assert.ok((await toolbar(page).getByRole('button', { name: label, exact: true }).getAttribute('class')).includes('primary-button'), 'Clearing preserves category');
  }
  await category(session, 'Prestataires'); await query(session, 'Charmillon', ['fictional-supplier', 'fictional-homonym'], []);
  const profession = toolbar(page).locator('.contacts-toolbar-stable-supplier-filter select'); await profession.selectOption(professionName);
  await assertDirect(session, ['fictional-supplier']); await assertClose(session, []);
  await query(session, 'Chamillon', [], ['fictional-supplier']);
  await query(session, 'zxqv-absent-fiction', [], []);
  assert.equal(await profession.inputValue(), professionName, 'Custom profession visibly retained with no results');
  await query(session, '', ['fictional-supplier'], []); assert.equal(await profession.inputValue(), professionName);
  await profession.selectOption('Toutes'); await category(session, 'Tous'); await query(session, '', all, []);
  assert.deepEqual(businessReads(session), readsBefore, 'Typing/direct/fuzzy/filter/clear trigger no extra module, catalog, document or bank reads');
  await query(session, 'Chamillon', [], null);
  await explicitOpen(session, 'fictional-supplier'); await explicitOpen(session, 'fictional-homonym');
  await query(session, 'Chamillon', [], null); assert.deepEqual(await assertClose(session), stable, 'Explicit close/open does not reorder suggestions');
  await preserveDraft(session);
  await query(session, 'Chamillon', [], null);
  const geometry = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth })); session.audit.geometry = geometry;
  assert.ok(geometry.contentWidth <= geometry.width + 1, 'No page horizontal overflow');
  await page.screenshot({ path: join(output, `${phase}-${session.engine}-${session.width}-${profile}.png`), fullPage: true });
  boundaries(session);
}
async function mixedResults(browser) {
  const exact = contact('fictional-direct-spelling', { firstName: 'Inès', name: 'Chamillon', companyName: 'Orthographe enregistrée fictive' });
  const session = await open(browser, 'chromium', 1440, 'limited-read', [...contacts, exact]);
  try {
    const reads = businessReads(session);
    const nearby = await query(session, 'Chamillon', [exact.id], null);
    assert.equal(nearby.length, 5, 'Nearby group has its own bounded count beside direct result');
    assert.ok(!nearby.includes(exact.id), 'Direct contact never duplicated in suggestions');
    assert.ok(nearby.includes('fictional-supplier') && nearby.includes('fictional-homonym'));
    await query(session, 'no-match-fictional-zyxq', [], []);
    assert.deepEqual(await query(session, 'Chamillon', [exact.id], null), nearby, 'Suggestion ranking stays stable around a direct result');
    assert.deepEqual(businessReads(session), reads); boundaries(session);
  } finally { await session.context.close(); }
}
async function representative(browser, size) {
  const visibleFixture = contacts.filter(item => item.id !== 'z-fictional-excluded');
  const collection = [...visibleFixture, ...Array.from({ length: size - visibleFixture.length }, (_, index) => contact('synthetic-unrelated-' + index, { firstName: 'Quorum' + index, name: 'Zyxw' + index, companyName: 'Synthétique ' + index }))];
  const session = await open(browser, 'chromium', 1440, 'limited-read', collection);
  try {
    const reads = businessReads(session), timings = [];
    for (const value of ['Chamillon', 'chramillon', 'nettoyge', 'Charmillon']) {
      const start = performance.now(); await query(session, value, value === 'Charmillon' ? ['fictional-supplier', 'fictional-homonym', 'fictional-client', 'fictional-owner', 'fictional-member'] : [], value === 'nettoyge' ? ['fictional-supplier'] : value === 'Charmillon' ? [] : null);
      timings.push({ query: value, milliseconds: Math.round(performance.now() - start) });
    }
    assert.ok(timings.every(item => item.milliseconds < 5000), 'Representative browser responses within bounded five-second fixture budget');
    assert.deepEqual(businessReads(session), reads, 'Representative search stays within initial authorized projection');
    session.audit.responseTimings = timings; boundaries(session);
  } finally { await session.context.close(); }
}
async function run(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error; }
  finally { save(); }
}
try {
  for (const engine of process.env.CONTACT_SUGGESTIONS_ENGINE ? [process.env.CONTACT_SUGGESTIONS_ENGINE] : baseline ? ['chromium'] : ['chromium', 'webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps'] }) : webkit.launch({ headless: true }));
    try {
      for (const width of process.env.CONTACT_SUGGESTIONS_WIDTH ? [Number(process.env.CONTACT_SUGGESTIONS_WIDTH)] : baseline ? [1440] : [1440, 390]) for (const profile of process.env.CONTACT_SUGGESTIONS_PROFILE ? [process.env.CONTACT_SUGGESTIONS_PROFILE] : baseline ? ['owner', 'limited-read'] : ['owner', 'limited-read', 'limited-contribute']) {
        await run(`${phase}: ${engine} ${width}px ${profile}, actual direct and nearby Contacts journey`, async () => {
          const session = await open(browser, engine, width, profile);
          try {
            if (baseline) {
              const family = session.available.filter(item => item.name === 'Charmillon').map(item => item.id);
              await query(session, 'Charmillon', family, []); await query(session, 'Chamillon', [], []);
              assert.equal(await session.page.locator('[data-contact-suggestions]').count(), 0, 'Published direct-only search offers no nearby contacts');
              await session.page.screenshot({ path: join(output, `${phase}-${engine}-${width}-${profile}.png`), fullPage: true }); boundaries(session);
            } else await journey(session);
          } catch (error) { await session.page.screenshot({ path: join(output, `${phase}-${engine}-${width}-${profile}-failure.png`), fullPage: true }); throw error; }
          finally { await session.context.close(); }
        });
      }
      if (!baseline && engine === 'chromium' && process.env.CONTACT_SUGGESTIONS_STRESS !== '0') await run('after: mixed direct and nearby lists, no duplicate and stable ranking', () => mixedResults(browser));
      if (!baseline && engine === 'chromium' && process.env.CONTACT_SUGGESTIONS_STRESS !== '0') for (const size of [1000, 5000]) await run(`after: actual Contacts reactivity with ${size} synthetic contacts`, () => representative(browser, size));
    } finally { await browser.close(); }
  }
} finally { save(); }
