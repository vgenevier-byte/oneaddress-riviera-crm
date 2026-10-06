/** Targeted contact category UI against real fictitious local Auth/RPC.
 * All contacts and identities are fictional. Mutations are confined to the
 * disposable local bench; no real account, credential or document is copied.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLocalTarget } from '../izord/local-target.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.LOCAL_STATUS_FILE && process.env.CONTACT_EVOLUTION_MANIFEST, 'Explicit disposable fixture required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_FIXTURE || '/private/tmp/oar-contact-evolution-fixture.private.json', 'utf8'));
const manifest = JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_MANIFEST, 'utf8'));
assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
const app = 'http://127.0.0.1:3190', api = new URL(status.API_URL).origin;
assert.equal(manifest.app, app); assert.equal(manifest.status, 'ready');
for (const entry of manifest.sourceFiles) assert.equal(createHash('sha256').update(readFileSync(entry.path)).digest('hex'), entry.sha256, 'Exact isolated source: ' + entry.path);
for (const user of Object.values(fixture.users)) assert.ok(user.email.endsWith('@example.invalid'));
const output = process.env.CONTACT_EVOLUTION_OUTPUT || join(manifest.directory, 'category-results');
mkdirSync(output, { recursive: true, mode: 0o700 });
const filter = process.env.CONTACT_EVOLUTION_CATEGORY_FILTER;
const previous = filter && existsSync(join(output, 'category-browser-results.json')) ? JSON.parse(readFileSync(join(output, 'category-browser-results.json'), 'utf8')) : null;
const sql = new Client({ connectionString: status.DB_URL }); await sql.connect();
assert.equal((await sql.query("select count(*)::int n from auth.users where email is null or email not like '%@example.invalid'")).rows[0].n, 0);
const memberKind = 'Membre de l’organisation', results = previous?.results.filter(result => result.passed && !result.name.includes(filter)) || [], createdIds = previous?.createdIds || [], runId = Date.now().toString(36);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function payload() { return (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload; }
async function charges() { return (await sql.query('select config,revision from app_private.monthly_charges_config')).rows; }
async function persisted(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) { const p = await payload(), found = predicate(p); if (found) return found; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Server did not confirm: ' + label);
}
async function open(user, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1050 : 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', isMobile: width < 700, hasTouch: width < 700, acceptDownloads: true });
  const audit = { blocked: [], paths: [], errors: [], refused: [] };
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([app, api].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    audit.blocked.push(url.origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  page.on('response', async response => { const url = new URL(response.url()); if (url.pathname.startsWith('/rest/v1/') && !response.ok()) audit.refused.push({ path: url.pathname, status: response.status(), message: (await response.text()).slice(0, 1500) }); });
  page.on('request', request => audit.paths.push(new URL(request.url()).pathname));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(app + '/?module=contacts');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.contact-create-form').waitFor({ timeout: 45000 });
  await page.locator('.oar-contact-row').first().waitFor({ timeout: 45000 });
  return { page, context, audit };
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.width + 1, 'No page overflow: ' + JSON.stringify(size));
}
function contactRow(page, name) { return page.locator('.oar-contact-row').filter({ has: page.getByRole('heading', { name, exact: true }) }); }
async function clean(session, restricted = false) {
  assert.deepEqual(session.audit.blocked, [], 'Only local requests'); assert.deepEqual(session.audit.errors, [], 'No runtime or hydration error');
  if (restricted) assert.ok(!session.audit.paths.includes('/rest/v1/crm_workspace_state'), 'Contributor never requests global workspace');
}
async function check(name, run) {
  if(filter && !name.includes(filter))return;
  try { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); throw error; }
  finally { writeFileSync(join(output, 'category-browser-results.json'), JSON.stringify({ results, createdIds, auth: 'real local Auth', writes: 'fictitious disposable bench only', remoteAccess: false }, null, 2), { mode: 0o600 }); }
}

try {
  for (const role of ['owner', 'depositor']) for (const width of [1440, 390]) await check(`${role} ${width}px: create, edit, filter, details, reload and optional Function`, async () => {
    const user = fixture.users[role]; assert.ok(user, role);
    const session = await open(user, width), { page, context } = session;
    const name = `Membre fictif ${role} ${width} ${runId}`, fn = `Coordination fictive ${width}`;
    try {
      const form = page.locator('.contact-create-form');
      await form.locator('[name=kind]').selectOption(memberKind);
      await form.locator('[name=name]').fill(name);
      await form.locator('[name=organizationFunction]').fill(fn);
      assert.equal(await form.locator('[name=budget], [name=supplierCategory], [name=relationshipStatus], [name=clientLevel]').count(), 0, 'Member has no irrelevant commercial/vendor controls');
      await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
      let saved;
      try { saved = await persisted(p => p.contacts.find(c => c.name === name && c.kind === memberKind), 'member creation'); }
      catch(error) { await page.screenshot({ path: join(output, 'category-creation-failure.png'), fullPage: true }); writeFileSync(join(output, 'category-creation-failure.private.json'), JSON.stringify({ refused: session.audit.refused, body: await page.locator('body').innerText() }, null, 2), { mode: 0o600 }); throw error; }
      createdIds.push(saved.id); assert.equal(saved.organizationFunction, fn);
      await contactRow(page, name).waitFor();
      await page.getByRole('button', { name: 'Membres de l’organisation', exact: true }).click();
      assert.equal(await contactRow(page, name).count(), 1);
      assert.ok((await contactRow(page, name).innerText()).includes(`Fonction : ${fn}`));
      await contactRow(page, name).getByRole('button', { name: 'Détails', exact: true }).click();
      const details = page.locator('#contact-detail-panel'); await details.waitFor();
      assert.equal((await details.locator('.contact-detail-grid > div').filter({ hasText: /^Fonction/ }).locator('strong').innerText()).trim(), fn);
      await noOverflow(page);
      await page.screenshot({ path: join(output, `category-${role}-${width}.png`), fullPage: true });
      await details.getByRole('button', { name: 'Modifier', exact: true }).click();
      const edit = page.locator('.contact-edit-form'); await edit.waitFor();
      await edit.locator('[name=organizationFunction]').fill('');
      await edit.getByRole('button', { name: /Enregistrer/ }).click();
      await persisted(p => p.contacts.find(c => c.id === saved.id && c.organizationFunction === ''), 'optional function clear');
      await page.reload(); await page.locator('.contact-create-form').waitFor();
      await contactRow(page, name).getByRole('button', { name: 'Modifier', exact: true }).click();
      assert.equal(await page.locator('.contact-edit-form [name=kind]').inputValue(), memberKind);
      assert.equal(await page.locator('.contact-edit-form [name=organizationFunction]').inputValue(), '');
      await page.locator('.contact-edit-form [name=organizationFunction]').fill(fn + ' modifiée');
      await page.locator('.contact-edit-form').getByRole('button', { name: /Enregistrer/ }).click();
      await persisted(p => p.contacts.find(c => c.id === saved.id && c.organizationFunction === fn + ' modifiée'), 'function update');
      await noOverflow(page); await clean(session, role !== 'owner');
    } finally { await context.close(); }
  });

  await check('Prestataire → member: same ID, historical links/banks/amounts/Charges and vendor historical selection', async () => {
    const before = await payload(), beforeCharges = await charges();
    const supplier = before.contacts.find(c => c.id === 'contact-evolution-supplier'); assert.ok(supplier, 'Dedicated fictional supplier');
    assert.equal(supplier.kind, 'Prestataire'); assert.ok(supplier.supplierBankAccounts?.length, 'Synthetic historical bank fixture');
    const session = await open(fixture.users.owner, 1440), { page, context } = session;
    try {
      await contactRow(page, supplier.name).getByRole('button', { name: 'Modifier', exact: true }).click();
      const edit = page.locator('.contact-edit-form');
      await edit.locator('[name=kind]').selectOption(memberKind);
      await edit.locator('[name=organizationFunction]').fill('Coordination historique fictive');
      await edit.getByRole('button', { name: /Enregistrer/ }).click();
      const updated = await persisted(p => p.contacts.find(c => c.id === supplier.id && c.kind === memberKind), 'historical supplier transition');
      for (const [key, value] of Object.entries(supplier)) if (!['kind', 'organizationFunction', 'updatedAt', 'updatedBy'].includes(key)) assert.deepEqual(updated[key], value, 'Preserved historical field ' + key);
      const after = await payload(); assert.deepEqual({ ...after, contacts: [] }, { ...before, contacts: [] }, 'Every linked business collection is unchanged');
      assert.deepEqual(await charges(), beforeCharges, 'Charges selection/attachments/revision unchanged');
      await page.locator('#contact-detail-panel').getByRole('button', { name: 'Fermer', exact: true }).click();
      await page.getByRole('button', { name: 'Prestataires', exact: true }).click(); assert.equal(await contactRow(page, supplier.name).count(), 0);
      await page.getByRole('button', { name: 'Membres de l’organisation', exact: true }).click(); assert.equal(await contactRow(page, supplier.name).count(), 1);
      await contactRow(page, supplier.name).getByRole('button', { name: 'Détails', exact: true }).click();
      assert.equal(await page.locator('#contact-detail-panel').getByRole('region', { name: 'Coordonnées bancaires', exact: true }).count(), 1, 'Existing banking remains available');
      await page.goto(app + '/?module=houseTracking');
      await page.getByRole('button', { name: 'Réglages', exact: true }).first().click();
      await page.waitForFunction(name => [...document.querySelectorAll('#house-contact-options option')].some(option => option.value.includes(name)), supplier.name);
      const options = await page.locator('#house-contact-options option').evaluateAll(nodes => nodes.map(node => node.value));
      assert.ok(options.some(value => value.includes(supplier.name) && value.includes(memberKind)), 'Member can be selected for house work');
      const newMember = after.contacts.find(contact => contact.id === createdIds[0]); assert.ok(newMember);
      let newWorker = after.houseTrackingWorkers.find(worker => worker.contactId === newMember.id);
      if (!newWorker) {
        const workerForm = page.locator('form').filter({ has: page.locator('[name=contactSearch]') });
        await workerForm.locator('[name=contactSearch]').fill(options.find(value => value.includes(newMember.name)));
        await workerForm.locator('[name=hourlyRate]').fill('20,50');
        await workerForm.getByRole('button', { name: 'Ajouter l’intervenant', exact: true }).click();
        newWorker = await persisted(p => p.houseTrackingWorkers.find(worker => worker.contactId === newMember.id), 'member selected as a new house worker');
      }
      assert.equal(newWorker.role, newMember.organizationFunction); assert.equal(newWorker.hourlyRate, 20.5);
      const afterWorker = await payload();
      assert.deepEqual(afterWorker.houseTimeEntries, before.houseTimeEntries); assert.deepEqual(afterWorker.housePayments, before.housePayments);
      assert.deepEqual(await charges(), beforeCharges, 'Adding a new worker does not recalculate historical Charges');
      await page.goto(app + '/?module=vendorInvoices');
      await page.locator('.vendor-invoices-list-card').waitFor();
      const invoice = after.vendorInvoices.find(row => row.contactId === supplier.id); assert.ok(invoice);
      await page.locator(`#vendor-invoice-${invoice.id}`).waitFor();
      const newPicker = page.locator('input[role=combobox]').first(); await newPicker.fill(supplier.companyName || supplier.name);
      assert.equal(await page.getByRole('option').filter({ hasText: supplier.companyName || supplier.name }).count(), 0, 'New invoices do not propose organization member');
      await page.locator(`#vendor-invoice-${invoice.id}`).getByRole('button', { name: 'Modifier', exact: true }).click();
      assert.equal(await page.locator('[name=contactId]').last().inputValue(), supplier.id, 'Existing invoice keeps its selected contact ID');
      assert.equal(await page.locator('.business-contact-picker-selection').count(), 1, 'Historical member is rendered as selected contact');
      assert.equal(await page.locator('[name=amount]').last().inputValue(), Number(invoice.amount).toFixed(2).replace('.', ','));
      await clean(session);
    } finally { await context.close(); }
  });
} finally {
  await browser.close(); await sql.end();
  writeFileSync(join(output, 'category-browser-results.json'), JSON.stringify({ results, createdIds, auth: 'real local Auth', writes: 'fictitious disposable bench only', remoteAccess: false }, null, 2), { mode: 0o600 });
}
