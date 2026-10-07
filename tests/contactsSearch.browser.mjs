/** Real AccessPortal -> CRMApp / ModuleWorkspace with intercepted fictional Auth/REST only.
 * Run an isolated, source-identical Next app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3997
 * and a dummy publishable key, then CONTACTS_SEARCH_ACK=CONTACTS_UI_FICTION_ONLY
 * CONTACTS_SEARCH_URL=http://127.0.0.1:<port> CONTACTS_SEARCH_OUTPUT=/private/tmp/<evidence>
 * node tests/contactsSearch.browser.mjs. CONTACTS_SEARCH_BASELINE=1 reproduces the defect.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

assert.equal(process.env.CONTACTS_SEARCH_ACK, 'CONTACTS_UI_FICTION_ONLY');
const origin = process.env.CONTACTS_SEARCH_URL;
assert.ok(origin && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Isolated loopback app required');
const source = resolve(process.env.CONTACTS_SEARCH_SOURCE || process.cwd());
const servedSource = resolve(process.env.CONTACTS_SEARCH_SERVED_SOURCE || source);
const output = resolve(process.env.CONTACTS_SEARCH_OUTPUT || '/private/tmp/oar-contacts-search-browser-evidence');
assert.ok(source.startsWith('/private/tmp/') && servedSource.startsWith('/private/tmp/') && output.startsWith('/private/tmp/'), 'Isolated source and evidence only');
mkdirSync(output, { recursive: true });
const baseline = process.env.CONTACTS_SEARCH_BASELINE === '1';
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceFiles = ['components/AccessPortal.tsx', 'components/CRMApp.tsx', 'components/ModuleWorkspace.tsx', 'components/MobileCRMHeader.tsx', 'lib/contactSearch.ts', 'lib/tasks/contactOptions.ts'].filter(file => existsSync(join(source, file))).map(path => {
  const sha256 = hash(join(source, path));
  assert.equal(hash(join(servedSource, path)), sha256, 'Exact served source: ' + path);
  return { path, sha256 };
});
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const stamp = '2026-10-07T12:00:00.000Z';
const modules = ['dashboard', 'contacts', 'leads', 'tasks', 'quotes', 'bookings', 'vendorQuotes', 'vendorInvoices', 'houseTracking', 'documents', 'planning', 'properties', 'vehicles', 'boats', 'izord', 'publisher', 'monthlyCharges'];
const collections = ['contacts', 'leads', 'properties', 'vehicles', 'boats', 'tasks', 'suppliers', 'planningEntries', 'quotes', 'documents', 'vendorQuotes', 'vendorInvoices', 'houseTrackingHouses', 'houseTrackingWorkers', 'houseTimeEntries', 'housePayments'];
const contact = (id, extras = {}) => ({ id, name: '', kind: 'Client', email: '', phone: '', city: '', postalAddress: '', budget: 0, source: '', notes: '', createdAt: stamp, ...extras });
const contacts = [
  contact('fictional-client', { firstName: 'Clément', name: 'Minodier', companyName: 'Élévation Île', email: 'azur@example.invalid', phone: '+33 6 44 55 66 77', city: 'Menton', postalAddress: '14 rue des Cyprès', organizationFunction: 'GestionUniqueFictive', notes: 'NOTE_NON_SEARCHABLE_FICTION', supplierBankAccounts: [{ id: 'fictional-bank', accountHolder: 'BANK_NON_SEARCHABLE_FICTION', iban: 'FICTIONAL_IBAN_DO_NOT_USE', bic: 'FICTIONAL_BIC', status: 'À vérifier', isPrimary: true, createdAt: stamp }] }),
  contact('fictional-supplier', { firstName: 'Clément', name: 'Fournisseur', kind: 'Prestataire', companyName: 'Élévation Services', supplierCategory: 'Électricien', supplierZone: 'Ouest fictif', supplierReliability: 'Très fiable' }),
  contact('fictional-plumber', { firstName: 'Clément', name: 'Plombier', kind: 'Prestataire', supplierCategory: 'Plombier' }),
  contact('fictional-owner', { firstName: 'Clément', name: 'Patrimoine', kind: 'Propriétaire' }),
  contact('fictional-member', { firstName: 'Clément', name: 'Coordination', kind: 'Membre de l’organisation', organizationFunction: 'Intendance fictive' }),
  contact('fictional-decomposed', { firstName: 'Cle\u0301ment', name: 'Unicode', companyName: 'Cafe\u0301 de la Co\u0302te' }),
  contact('fictional-composed-name', { firstName: 'Anne-Marie', name: 'De La Résidence', companyName: 'Société composée fictive' }),
  contact('fictional-company-only', { companyName: 'Société Riviera fictive' }),
  contact('fictional-missing', { firstName: undefined, companyName: undefined, email: 'missing@example.invalid' }),
  contact('fictional-excluded', { firstName: 'Clément', name: 'NonAutorise', companyName: 'PROJECTION_SECRET_FICTION', email: 'hidden@example.invalid' })
];
const heading = item => [item.civility, item.firstName, item.name].filter(Boolean).join(' ').trim() || item.companyName || item.email || item.phone || 'Contact sans nom';
const selectedContacts = profile => profile === 'owner' ? contacts : contacts.filter(item => item.id !== 'fictional-excluded').map(({ supplierBankAccounts, ...allowed }) => allowed);
const sessions = [], results = [];
const phase = baseline ? 'before' : 'after';
function save() {
  writeFileSync(join(output, phase + '-results.json'), JSON.stringify({ sourceFiles, source, servedSource, origin, results, fictionalFixture: true, integratedCRMPageRendered: true, actualAuth: false, actualRPC: false, actualDatabase: false, actualProduction: false, businessWrites: 0, externalCalls: 0, accountsCreated: 0, physicalDevice: false, sessions: sessions.map(({ profile, engine, width, audit }) => ({ profile, engine, width, audit })) }, null, 2) + '\n');
}
async function open(browser, engine, width, profile) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: engine === 'webkit' && width < 500, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  const owner = profile === 'owner';
  const grants = Object.fromEntries(modules.map(module => [module, { level: owner || module === 'contacts' && profile === 'limited-contribute' ? 'contribute' : module === 'contacts' ? 'read' : 'none', sensitive: owner ? { delete: true, export: true } : {} }]));
  const access = { revision: 1, active: true, generalAdmin: owner, fullAccess: owner, modules: grants };
  const user = { id: owner ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated', email: profile + '@example.invalid', email_confirmed_at: stamp, app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: stamp };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, exp: 4102444800 })).toString('base64url'), 'fictional-local-signature'].join('.');
  const payload = Object.fromEntries(collections.map(key => [key, key === 'contacts' ? selectedContacts(profile) : []]));
  const projection = { revision: stamp, collections: { contacts: selectedContacts(profile) } };
  const audit = { requests: [], blocked: [], errors: [], writes: [], snapshots: [] };
  const session = { context, profile, engine, width, audit }; sessions.push(session);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = data => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (url.origin === 'http://127.0.0.1:3997') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const rpc = path.split('/rest/v1/rpc/')[1];
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      audit.requests.push({ method: request.method(), path, args: body });
      if (path === '/auth/v1/token') return reply({ access_token: token, refresh_token: 'fictional-refresh-token', token_type: 'bearer', expires_in: 31536000, user });
      if (path === '/auth/v1/user') return reply(user);
      if (rpc === 'crm_access_snapshot') return reply(access);
      if (rpc === 'crm_tasks_read' && owner) return reply([]);
      if (rpc === 'crm_contact_documents' && body?.p_contact === 'fictional-client' && audit.explicitDetailsOpened) return reply({ revision: stamp, documents: [], reads: {} });
      if (rpc === 'crm_read_module' && body?.p_module === 'contacts' && !owner) { audit.snapshots.push({ ids: projection.collections.contacts.map(item => item.id), fields: Object.keys(projection.collections.contacts[0]) }); return reply(projection); }
      if (path === '/rest/v1/app_memberships') return reply([{ workspace_id: 'oar', role: 'member' }]);
      if (path === '/rest/v1/crm_workspace_state' && owner && request.method() === 'GET') return reply({ payload, updated_at: stamp });
      if (request.method() !== 'GET') audit.writes.push({ path, body });
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
  await assertRows(session, selectedContacts(profile).map(item => item.id));
  return session;
}
const rows = page => page.locator('.oar-contact-row');
const toolbar = page => page.locator('.contacts-toolbar');
const search = page => page.locator('input[type="search"]:visible');
async function assertRows(session, ids) {
  const expected = contacts.filter(item => ids.includes(item.id)).map(heading).sort();
  await session.page.waitForFunction(count => document.querySelectorAll('.oar-contact-row').length === count, expected.length, { timeout: 5000 }).catch(async error => { throw new Error(error.message + ' query=' + await search(session.page).inputValue() + ' rows=' + JSON.stringify(await rows(session.page).locator('h3').allTextContents())); });
  assert.deepEqual((await rows(session.page).locator('h3').allTextContents()).sort(), expected, 'Exact authorized filtered list');
  assert.equal(Number(await toolbar(session.page).locator('.contacts-toolbar-stable-count strong').innerText()), expected.length, 'Result count matches displayed list');
}
async function query(session, value, ids) {
  const { page } = session;
  if (await search(page).count() === 0) await page.getByRole('button', { name: 'Ouvrir la recherche', exact: true }).click();
  assert.equal(await search(page).count(), 1, 'One visible band search');
  await search(page).fill(value); await assertRows(session, ids);
  const bounds = await search(page).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= session.width + 1, 'Band search fits viewport');
  session.audit.searchBounds = bounds;
  if (await page.locator('.mobile-search-sheet').count()) {
    if (value === 'Minodier') await page.screenshot({ path: join(output, `${phase}-${session.engine}-${session.width}-${session.profile}-search.png`) });
    await page.getByRole('button', { name: 'Afficher les résultats', exact: true }).click();
  }
}
async function category(session, name, ids) { await toolbar(session.page).getByRole('button', { name, exact: true }).click(); await assertRows(session, ids); }
function assertBoundaries(session) {
  assert.deepEqual(session.audit.blocked, [], 'No external or forbidden request');
  assert.deepEqual(session.audit.writes, [], 'No business write');
  assert.deepEqual(session.audit.errors, [], 'No runtime or hydration error');
  if (session.profile !== 'owner') {
    assert.ok(!session.audit.requests.some(item => item.path.includes('crm_workspace_state')), 'Limited account never reads global workspace');
    assert.ok(!session.audit.requests.some(item => item.path.includes('crm_reference_options')), 'Contacts-only rights request no linked global catalog');
    assert.ok(session.audit.requests.filter(item => item.path.includes('/rpc/')).every(item => ['crm_access_snapshot', 'crm_read_module', 'crm_contact_documents'].some(name => item.path.endsWith('/' + name))), 'Only existing access check, module projection, and explicitly opened fiche document read');
    assert.ok(session.audit.snapshots.length > 0, 'Actual ModuleWorkspace loaded authorized projection');
    assert.ok(session.audit.snapshots.every(item => !item.ids.includes('fictional-excluded') && !item.fields.includes('supplierBankAccounts')), 'Projection excludes forbidden contact and banking');
  }
}
async function preserveDraft(session) {
  if (session.profile === 'limited-read') return;
  const { page } = session;
  const form = page.locator('.contact-create-form');
  await form.locator('[name=firstName]').fill('Ébauche fictive');
  await form.locator('[name=name]').fill('À préserver');
  const draftNotesVisible = await form.locator('[name=notes]').count() === 1;
  if (draftNotesVisible) await form.locator('[name=notes]').fill('Brouillon ligne 1\nBrouillon ligne 2');
  await form.locator('[name=email]').fill('draft@example.invalid');
  await query(session, 'minodier clement', ['fictional-client']);
  session.audit.explicitDetailsOpened = true;
  await rows(page).getByRole('button', { name: 'Détails', exact: true }).click();
  const detail = page.locator('#contact-detail-panel'); await detail.waitFor();
  const modalCanSearch = session.width >= 500 || session.profile !== 'owner';
  if (modalCanSearch) await query(session, 'absent-search-fiction', []);
  assert.ok((await detail.innerText()).includes('Clément Minodier'), 'Selected fiche retained while search excludes it');
  await detail.getByRole('button', { name: 'Fermer', exact: true }).click();
  await query(session, 'minodier', ['fictional-client']);
  await rows(page).getByRole('button', { name: 'Modifier', exact: true }).click();
  const edit = page.locator('.contact-edit-form'); await edit.waitFor();
  await edit.locator('[name=name]').fill('Brouillon édition fictif');
  if (modalCanSearch) await query(session, 'company-query-that-does-not-exist', []);
  assert.equal(await edit.locator('[name=name]').inputValue(), 'Brouillon édition fictif', 'Edit draft retained');
  assert.equal(await edit.locator('[name=firstName]').inputValue(), 'Clément', 'Stored accents retained');
  await edit.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await form.locator('[name=firstName]').inputValue(), 'Ébauche fictive');
  assert.equal(await form.locator('[name=name]').inputValue(), 'À préserver');
  if (draftNotesVisible) assert.equal(await form.locator('[name=notes]').inputValue(), 'Brouillon ligne 1\nBrouillon ligne 2');
  assert.equal(await form.locator('[name=email]').inputValue(), 'draft@example.invalid');
  await query(session, '', selectedContacts(session.profile).map(item => item.id));
}
async function journey(session) {
  const { page, profile } = session;
  const all = selectedContacts(profile).map(item => item.id);
  const clements = all.filter(id => !['fictional-composed-name', 'fictional-company-only', 'fictional-missing'].includes(id));
  const readCount = () => session.audit.requests.filter(item => item.path.endsWith('/crm_read_module') || item.path.endsWith('/crm_workspace_state')).length;
  const readsBeforeSearch = readCount();
  for (const value of ['clement', 'CLÉMENT', 'clem', 'Cle\u0301ment', '  clement  ', 'ＣＬÉＭＥＮＴ']) await query(session, value, clements);
  for (const value of ['minodier', 'clement minodier', 'minodier clement', '  clement   minodier  ', 'minodier\tclem', 'île mino elev']) await query(session, value, ['fictional-client']);
  for (const value of ['élévation île', 'ILE ELEVATION', 'ÎLE\t  ÉLÉVA']) await query(session, value, ['fictional-client']);
  for (const value of ['anne marie residence', 'resid de anne', '  la marie de  ', 'SOCIETE COMPOSEE']) await query(session, value, ['fictional-composed-name']);
  await query(session, 'cote cafe', ['fictional-decomposed']);
  await query(session, 'riviera societe', ['fictional-company-only']);
  await query(session, 'missing@example.invalid', ['fictional-missing']);
  for (const value of ['azur@example.invalid', '44 55 66', 'MENTON', 'cypres', 'gestionuniquefictive']) await query(session, value, ['fictional-client']);
  for (const value of ['electricien', 'ouest fictif', 'tres fiable']) await query(session, value, ['fictional-supplier']);
  await query(session, 'Prestataire', ['fictional-supplier', 'fictional-plumber']);
  for (const value of ['no-match-fictional', 'NOTE_NON_SEARCHABLE_FICTION', 'BANK_NON_SEARCHABLE_FICTION', 'FICTIONAL_IBAN_DO_NOT_USE', 'DOCUMENT_NON_SEARCHABLE_FICTION']) await query(session, value, []);
  if (profile !== 'owner') {
    await query(session, 'PROJECTION_SECRET_FICTION', []);
    await query(session, 'NonAutorise', []);
  }
  await query(session, 'clement', clements);
  for (const [label, ids] of [['Clients', clements.filter(id => ['fictional-client', 'fictional-decomposed', 'fictional-excluded'].includes(id))], ['Prestataires', ['fictional-supplier', 'fictional-plumber']], ['Propriétaires', ['fictional-owner']], ['Membres de l’organisation', ['fictional-member']], ['Tous', clements]]) await category(session, label, ids);
  await category(session, 'Prestataires', ['fictional-supplier', 'fictional-plumber']);
  const profession = toolbar(page).locator('.contacts-toolbar-stable-supplier-filter select');
  await profession.selectOption('Électricien'); await assertRows(session, ['fictional-supplier']);
  await query(session, 'Minodier', []);
  assert.equal(await profession.inputValue(), 'Électricien', 'Profession visibly retained while query has no matches');
  await query(session, '', ['fictional-supplier']);
  assert.equal(await profession.inputValue(), 'Électricien', 'Clearing query preserves profession');
  assert.equal(await toolbar(page).getByRole('button', { name: 'Prestataires', exact: true }).getAttribute('class').then(value => value.includes('primary-button')), true, 'Category preserved');
  await profession.selectOption('Toutes'); await assertRows(session, ['fictional-supplier', 'fictional-plumber']);
  await category(session, 'Tous', all);
  await query(session, 'clement', clements);
  const metrics = await toolbar(page).locator('.contacts-toolbar-stable-metrics > div').evaluateAll(nodes => nodes.map(node => ({ label: node.querySelector('span')?.textContent, count: Number(node.querySelector('strong')?.textContent) })));
  assert.deepEqual(metrics, [{ label: 'Clients', count: profile === 'owner' ? 3 : 2 }, { label: 'Prestataires', count: 2 }, { label: 'Propriétaires', count: 1 }, { label: 'Membres de l’organisation', count: 1 }], 'Category metrics reflect searched authorized rows');
  await query(session, '', all);
  assert.equal(readCount(), readsBeforeSearch, 'Typing/filtering/clearing does not trigger additional data reads');
  assert.equal(session.audit.requests.filter(item => /crm_contact_documents|bank/i.test(item.path)).length, 0, 'Search never requests personal documents or banking');
  await preserveDraft(session);
  await query(session, 'Minodier', ['fictional-client']);
  const geometry = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
  session.audit.geometry = geometry;
  assert.ok(geometry.contentWidth <= geometry.width + 1, 'No horizontal overflow');
  assert.ok(session.audit.searchBounds, 'Actual band search geometry recorded');
  await page.screenshot({ path: join(output, `${phase}-${session.engine}-${session.width}-${profile}.png`), fullPage: true });
  assertBoundaries(session);
  assert.deepEqual(contacts[0].firstName, 'Clément', 'Fixture stored value untouched');
}
async function run(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error; }
  finally { save(); }
}
try {
  for (const engine of process.env.CONTACTS_SEARCH_ENGINE ? [process.env.CONTACTS_SEARCH_ENGINE] : baseline ? ['chromium'] : ['chromium', 'webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking', '--disable-component-update', '--disable-default-apps'] }) : webkit.launch({ headless: true }));
    try {
      for (const width of process.env.CONTACTS_SEARCH_WIDTH ? [Number(process.env.CONTACTS_SEARCH_WIDTH)] : baseline ? [1440] : [1440, 390]) for (const profile of process.env.CONTACTS_SEARCH_PROFILE ? [process.env.CONTACTS_SEARCH_PROFILE] : baseline ? ['owner', 'limited-read'] : ['owner', 'limited-read', 'limited-contribute']) {
        await run(`${phase}: ${engine} ${width}px ${profile}, actual Contacts band and authorized module route`, async () => {
          const session = await open(browser, engine, width, profile);
          try {
            if (baseline) {
              if (profile === 'owner') {
                await query(session, 'Clément', ['fictional-client', 'fictional-supplier', 'fictional-plumber', 'fictional-owner', 'fictional-member', 'fictional-excluded']);
                await query(session, 'clement', []);
                await query(session, 'minodier clement', []);
                await pageScreenshot(session);
              } else { assert.equal(await search(session.page).count(), 0, 'Published limited route has no Contacts band search'); await pageScreenshot(session); }
              assertBoundaries(session);
            } else await journey(session);
          } catch (error) { await session.page.screenshot({ path: join(output, `${phase}-${engine}-${width}-${profile}-failure.png`), fullPage: true }); throw error; }
          finally { await session.context.close(); }
        });
      }
    } finally { await browser.close(); }
  }
} finally { save(); }
async function pageScreenshot(session) { await session.page.screenshot({ path: join(output, `${phase}-${session.engine}-${session.width}-${session.profile}.png`), fullPage: true }); }
