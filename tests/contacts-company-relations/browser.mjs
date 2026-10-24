/** Actual candidate UI -> real local Auth/PostgREST -> persistent fictional data.
 * Only a deliberately failed request is aborted; successful calls are forwarded.
 * Desktop/mobile are browser viewports, not proof on physical devices.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const benchPath = process.env.CONTACTS_RELATIONS_BENCH || process.env.CONTACTS_ENTITY_BENCH;
assert.ok(benchPath, 'Explicit real local fixture required');
const bench = JSON.parse(readFileSync(benchPath, 'utf8'));
const backend = bench.origin, app = process.env.CONTACTS_RELATIONS_APP || 'http://127.0.0.1:3399';
for (const target of [backend, app]) assert.ok(new URL(target).protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(new URL(target).hostname));
const out = process.env.CONTACTS_RELATIONS_BROWSER_OUT || '/private/tmp/oar-relations-evidence/browser';
mkdirSync(out, { recursive: true });
const results = [], errors = [], run = Date.now().toString();
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
let phase = 'startup';
function pass(name) { results.push(name); console.log('PASS ' + name); }
async function rpc(profile, name, body) {
  const account = bench.accounts[profile];
  const login = await fetch(backend + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: bench.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.ok(login.ok); const token = (await login.json()).access_token;
  const reply = await fetch(backend + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: bench.publishableKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(reply.ok, name + ': ' + reply.status + ' ' + (reply.ok ? '' : await reply.text()));
  return reply.json();
}
const rows = async profile => (await rpc(profile, 'crm_read_module', { p_module: 'contacts' })).collections.contacts;
const createForm = page => page.locator('.contact-create-form:visible');
const input = (form, name) => form.locator(`[name="${name}"]`);
const bundleReply = page => page.waitForResponse(reply => reply.url().endsWith('/rpc/crm_save_contact_bundle') && reply.ok());
async function settled(page, profile) {
  await createForm(page).waitFor();
  if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
}
async function person(page, profile, suffix) {
  const form = createForm(page); const name = `Personne ${suffix}`;
  await input(form, 'entityType').selectOption('person'); await input(form, 'name').fill(name);
  await input(form, 'firstName').fill('Camille'); await input(form, 'organizationFunction').fill('Négociateur'); await input(form, 'email').fill(`person-${suffix}@example.invalid`);
  const saved = bundleReply(page); await form.locator('[type="submit"]').click(); await saved;
  await page.waitForFunction(() => document.querySelector('.contact-create-form [name="name"]')?.value === '');
  const contact = (await rows(profile)).find(row => row.email === `person-${suffix}@example.invalid`);
  assert.ok(contact && !contact.companyId); assert.equal(contact.organizationFunction, 'Négociateur'); return contact;
}
try {
  for (const scenario of [{ profile: 'owner', width: 1440, language: 'fr' }, { profile: 'contributor', width: 390, language: 'en' }]) {
    const suffix = `${scenario.profile}-${run}`, context = await browser.newContext({ viewport: { width: scenario.width, height: 950 } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return ['blob:', 'data:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(45000); page.on('response', async response => { if (response.url().includes('/rpc/') && !response.ok()) console.log('RPC REFUSED ' + response.status() + ' ' + response.url().split('/').pop() + ' ' + await response.text()); }); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.text().includes('Encountered two children with the same key')) errors.push(message.text()); }); page.on('dialog', dialog => dialog.accept());
    phase = suffix + ' login';
    await page.goto(app + '/contacts-entity-demo'); await page.locator(`[data-local-profile="${scenario.profile}"]`).click(); await settled(page, scenario.profile);
    if (scenario.language === 'en') {
      await page.locator('#unified-more-trigger:visible').click(); await page.locator('[data-language-selector] button[lang="en-GB"]:visible').click(); await page.locator('.unified-more-close:visible').click();
    }
    phase = suffix + ' independent person';
    const independent = await person(page, scenario.profile, suffix);
    pass(`${suffix}: independent person persists without company`);
    phase = suffix + ' required first person';
    let form = createForm(page);
    const availableCompany = await input(form, 'companyId').locator('option').evaluateAll(options => options.find(option => option.value)?.value);
    if (availableCompany) await input(form, 'companyId').selectOption(availableCompany);
    await input(form, 'entityType').selectOption('company');
    assert.equal(await form.evaluate(node => new FormData(node).has('companyId')), false, 'Hidden person affiliation is excluded for a company');
    const companyName = `Agence Relation ${suffix}`, companyEmail = `company-${suffix}@example.invalid`;
    await input(form, 'companyName').fill(companyName); await input(form, 'email').fill(companyEmail);
    let bundleCalls = 0; const observe = request => { if (request.url().endsWith('/rpc/crm_save_contact_bundle')) bundleCalls++; }; page.on('request', observe);
    await form.locator('[type="submit"]').click(); assert.equal(await input(form, 'companyExistingPersonId').evaluate(node => node.validity.valueMissing), true); assert.equal(bundleCalls, 0);
    pass(`${suffix}: company without first person blocked in UI`);
    await input(form, 'companyPersonMode').selectOption('new');
    await input(form, 'companyPersonName').fill('   '); await form.locator('[type="submit"]').click();
    assert.equal(await input(form, 'companyPersonName').evaluate(node => node.validity.customError), true); assert.ok(await input(form, 'companyPersonName').evaluate(node => node.validationMessage)); assert.equal(bundleCalls, 0);
    pass(`${suffix}: whitespace-only first-person surname visibly rejected before RPC`);
    await input(form, 'companyPersonFirstName').fill('Alex'); await input(form, 'companyPersonName').fill(`Interlocuteur ${suffix}`); await input(form, 'companyPersonEmail').fill(`first-${suffix}@example.invalid`);
    phase = suffix + ' atomic failure';
    await page.route('**/rest/v1/rpc/crm_save_contact_bundle', route => route.abort('failed'));
    await form.locator('[type="submit"]').click(); await form.getByRole('alert').waitFor(); await page.unroute('**/rest/v1/rpc/crm_save_contact_bundle');
    assert.equal(await input(form, 'companyName').inputValue(), companyName); assert.equal(await input(form, 'companyPersonName').inputValue(), `Interlocuteur ${suffix}`);
    const unchanged = await rows(scenario.profile); assert.equal(unchanged.some(row => row.email === companyEmail || row.email === `first-${suffix}@example.invalid`), false);
    if (scenario.profile === 'owner') {
      // Owner refuses an ambiguous network response until a fresh authoritative reread.
      await page.reload(); await settled(page, scenario.profile);
      form = createForm(page); await input(form, 'entityType').selectOption('company'); await input(form, 'companyName').fill(companyName); await input(form, 'email').fill(companyEmail); await input(form, 'companyPersonMode').selectOption('new'); await input(form, 'companyPersonFirstName').fill('Alex'); await input(form, 'companyPersonName').fill(`Interlocuteur ${suffix}`); await input(form, 'companyPersonEmail').fill(`first-${suffix}@example.invalid`);
    }
    pass(`${suffix}: failed atomic save retains draft and leaves no company/person`);
    phase = suffix + ' atomic success';
    bundleCalls = 0; const saved = bundleReply(page); await form.evaluate(node => { node.requestSubmit(); node.requestSubmit(); }); await saved;
    await page.waitForFunction(() => document.querySelector('.contact-create-form [name="companyName"]')?.value === '');
    assert.equal(bundleCalls, 1); page.off('request', observe);
    let contacts = await rows(scenario.profile), company = contacts.find(row => row.email === companyEmail), first = contacts.find(row => row.email === `first-${suffix}@example.invalid`);
    assert.ok(company && first); assert.equal(first.entityType, 'person'); assert.equal(first.companyId, company.id); assert.equal(company.primaryContactId, first.id);
    await page.reload(); await settled(page, scenario.profile);
    const search = page.locator('.topbar .search-input:visible'); await search.fill(companyName);
    assert.equal(await page.locator('.contact-row').count(), 2);
    pass(`${suffix}: company/person save is atomic, double-submit safe and searchable after reload`);
    phase = suffix + ' existing person attachment';
    await search.fill('');
    const companyRow = page.locator('.contact-row').filter({ has: page.getByRole('heading', { name: companyName, exact: true }) }); await companyRow.locator('[data-crm-action="details"]').click();
    let manager = page.locator('[data-company-people]'); await manager.getByRole('button', { name: /^(Rattacher une personne existante|Attach an existing person)$/ }).click();
    await manager.locator('[name="companyExistingPersonId"]').selectOption(independent.id);
    assert.equal(await manager.locator('[name="companyExistingPersonId"]').inputValue(), independent.id, 'Selected canonical person survives parent dirty-state render');
    assert.equal(await manager.locator('form').evaluate(form => form.checkValidity()), true);
    const attached = bundleReply(page); await manager.locator('button[type="submit"]').click(); await attached;
    await page.waitForFunction(() => document.querySelectorAll('[data-company-people] article').length === 2);
    contacts = await rows(scenario.profile); assert.equal(contacts.filter(row => row.id === independent.id).length, 1); assert.equal(contacts.find(row => row.id === independent.id).companyId, company.id);
    pass(`${suffix}: existing person attached without duplication`);
    phase = suffix + ' primary and detach';
    const secondRow = manager.locator('article').filter({ has: page.getByText(`Camille ${independent.name}`, { exact: true }) });
    const primary = page.waitForResponse(reply => reply.url().endsWith('/rpc/crm_mutate_record') && reply.ok()); await secondRow.getByRole('button', { name: /^(Désigner comme principal|Make primary contact)$/ }).click(); await primary;
    await page.waitForFunction(id => [...document.querySelectorAll('[data-company-people] article')].some(node => node.textContent.includes(id) && /Interlocuteur principal|Primary contact/.test(node.textContent)), independent.name);
    const firstRow = manager.locator('article').filter({ has: page.getByText(`Alex ${first.name}`, { exact: true }) });
    const detached = page.waitForResponse(reply => reply.url().endsWith('/rpc/crm_mutate_record') && reply.ok()); await firstRow.getByRole('button', { name: /^(Détacher|Detach)$/ }).click(); await detached;
    await page.waitForFunction(() => document.querySelectorAll('[data-company-people] article').length === 1);
    assert.equal(await manager.getByRole('button', { name: /^(Détacher|Detach)$/ }).isDisabled(), true);
    contacts = await rows(scenario.profile); assert.equal(contacts.find(row => row.id === company.id).primaryContactId, independent.id); assert.equal(contacts.find(row => row.id === first.id).companyId || '', '');
    pass(`${suffix}: primary contact changes, detach preserves person, last contact protected`);
    const metrics = await manager.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth })); assert.ok(metrics.scroll <= metrics.client + 2);
    await page.screenshot({ path: join(out, `${suffix}-${scenario.language}-${scenario.width}.png`), fullPage: false });
    pass(`${suffix}: ${scenario.language} relation controls fit ${scenario.width}px viewport`);
    phase = suffix + ' person affiliation editor';
    await page.locator('#contact-detail-panel [data-crm-dismiss="true"]').click(); await search.fill(first.name);
    const detachedPersonRow = page.locator('.contact-row').filter({ has: page.getByRole('heading', { name: `Alex ${first.name}`, exact: true }) });
    await detachedPersonRow.getByRole('button', { name: /^(Modifier|Edit)$/ }).click();
    const edit = page.locator('.contact-edit-form:visible'); await input(edit, 'companyId').selectOption(company.id); await input(edit, 'organizationFunction').fill('Directeur commercial');
    const edited = page.waitForResponse(reply => reply.url().endsWith('/rpc/crm_mutate_record') && reply.ok()); await edit.locator('button[type="submit"]').click(); await edited;
    await page.locator('.contact-edit-form').waitFor({ state: 'detached' });
    contacts = await rows(scenario.profile); assert.equal(contacts.find(row => row.id === first.id).companyId, company.id); assert.equal(contacts.find(row => row.id === first.id).organizationFunction, 'Directeur commercial');
    await page.locator('#contact-detail-panel [data-crm-dismiss="true"]').click(); await page.reload(); await settled(page, scenario.profile);
    const reloadedSearch = page.locator('.topbar .search-input:visible'); await reloadedSearch.fill(companyName);
    assert.equal(await page.locator('.contact-row').count(), 3);
    const personAfterReload = page.locator('.contact-row').filter({ has: page.getByRole('heading', { name: `Alex ${first.name}`, exact: true }) });
    await personAfterReload.locator('[data-crm-action="details"]').click();
    await page.getByRole('button', { name: /^(Ouvrir la fiche entreprise|Open company record)/ }).click(); await page.locator('[data-company-people]').waitFor();
    assert.equal(await page.locator('[data-company-people] article').count(), 2);
    pass(`${suffix}: person company selector, own function and open-company link persist after reload`);
    if (scenario.profile === 'owner') {
      phase = suffix + ' create from message';
      await page.locator('#contact-detail-panel [data-crm-dismiss="true"]').click();
      await page.locator('.crm-shell .sidebar [data-navigation-module="dashboard"]:visible').first().click();
      page.removeAllListeners('dialog'); let prompt = 0;
      page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept(++prompt === 1 ? '5' : `Client : Martin Message ${run}\nEmail : message-${run}@example.invalid\nRecherche villa à Nice\nBudget : 5000\nBesoin : maison avec piscine`) : dialog.accept());
      const messageSaved = page.waitForResponse(reply => reply.url().endsWith('/rpc/crm_create_from_message') && reply.ok());
      await page.getByRole('button', { name: /^(Créer depuis message|Create from message)$/ }).click(); await messageSaved;
      await page.waitForLoadState('networkidle');
      const messageContact = (await rows('owner')).find(row => row.email === `message-${run}@example.invalid`);
      assert.ok(messageContact); assert.equal(messageContact.entityType, 'person'); assert.equal(messageContact.companyId || '', '');
      const leads = (await rpc('owner', 'crm_read_module', { p_module: 'leads' })).collections.leads;
      assert.equal(leads.filter(lead => lead.contactName === messageContact.name).length, 1);
      pass(`${suffix}: message creation confirms one real person and lead atomically`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []); writeFileSync(join(out, 'results.json'), JSON.stringify({ passed: true, results, errors, boundary: 'Real LOCAL password Auth and PostgREST with persistent fictional data. Failed save request aborted before admission. Mobile viewports emulated. No Production session or physical device.' }, null, 2));
} catch (error) { for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: join(out, 'failure.png'), fullPage: false }).catch(() => {}); console.log('ALERTS ' + JSON.stringify(await page.getByRole('alert').allTextContents())); } writeFileSync(join(out, 'results.json'), JSON.stringify({ passed: false, phase, error: error.message, results, errors }, null, 2)); throw error; }
finally { await browser.close(); }
