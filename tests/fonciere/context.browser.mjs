/** Independent loopback Chrome context: retained data, naming, keyboard and mobile.
 * Uses only the shared fictional Auth/Postgres fixture. Never targets Production.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(readFileSync(process.env.FONCIERE_FIXTURE || '/private/tmp/fonciere-delivery/local-fixture.private.json', 'utf8'));
const out = process.env.FONCIERE_ARTIFACTS || '/private/tmp/fonciere-guided-delivery';
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const url of [fixture.api, fixture.app]) assert.equal(new URL(url).hostname, '127.0.0.1');
const checks = [], errors = [], externalRequests = [], run = String(Date.now());
let phase = 'initialization', token, projectId;
const headers = () => ({ apikey: fixture.publicKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const step = name => { phase = name; console.log(`STEP ${name}`); };
async function authenticate() {
  const response = await fetch(`${fixture.api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: fixture.publicKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.users.writer.email, password: fixture.users.writer.password }) });
  assert(response.ok, 'Real local Auth sign-in must succeed'); token = (await response.json()).access_token;
}
async function savedByName(name) {
  const response = await fetch(`${fixture.api}/rest/v1/fonciere_projects?select=*&title=eq.${encodeURIComponent(name)}&order=created_at.desc`, { headers: headers() });
  assert(response.ok); const rows = await response.json(); assert(rows[0], 'Saved fictional record exists'); return rows[0];
}
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['data:', 'blob:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
  externalRequests.push(url.origin + url.pathname); return route.abort();
});
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const workspace = () => page.locator('[data-fonciere-projects]');
const field = key => page.locator(`#fonciere-${key}`);
async function number(key, value) { await field(key).focus(); await page.evaluate(() => new Promise(requestAnimationFrame)); await field(key).fill(value); await field(key).press('Tab'); }
async function save() {
  const saved = page.waitForResponse(response => response.url().endsWith('/rpc/fonciere_save_project') && response.request().method() === 'POST' && response.ok());
  await workspace().getByRole('button', { name: 'Enregistrer', exact: true }).click(); await saved;
  await page.getByText(/Informations et documents enregistrés/).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-fonciere-projects]')?.textContent?.includes('Opération en cours'));
}
async function openRetained() {
  const retained = page.locator('#fonciere-section-property details[data-retained-fields]');
  await retained.waitFor(); if (!await retained.evaluate(el => el.open)) await retained.locator('summary').first().click(); return retained;
}
async function confirmRetained(key) {
  const retained = await openRetained(); const item = retained.locator(`[data-guided-field="${key}"]`).locator('..');
  await item.getByRole('button', { name: 'Confirmer pour ce type de bien', exact: true }).click();
}
async function noOverflow(label) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`); }
try {
  await authenticate(); await page.goto(`${fixture.app}/fonciere`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(fixture.users.writer.email);
  await page.getByLabel(/Mot de passe|Password/).fill(fixture.users.writer.password);
  await page.getByRole('button', { name: /Se connecter|Sign in/, exact: true }).click(); await workspace().waitFor();
  await workspace().getByRole('button', { name: 'Nouveau projet', exact: true }).click(); await field('name').waitFor();

  step('explicit naming suggestion never overwrites a name');
  await field('propertyType').selectOption('house'); await field('city').fill('Antibes'); await field('agencyReference').fill(`CTX-${run}`);
  assert.equal(await field('name').inputValue(), ''); await workspace().getByRole('button', { name: 'Utiliser ce nom', exact: true }).click();
  assert.match(await field('name').inputValue(), /^Maison — Antibes — CTX-/);
  const name = `Contexte retenu zéro ${run}`; await field('name').fill(name); await field('city').fill('Cannes'); await field('propertyType').selectOption('villa');
  assert.equal(await field('name').inputValue(), name); assert.equal(await workspace().getByRole('button', { name: 'Utiliser ce nom', exact: true }).count(), 0);
  await field('propertyType').selectOption('house');
  pass('Name is proposed only while empty, requires explicit adoption and never overwrites a typed name after context changes');

  step('house facts persist, then become recoverable inactive data on land');
  await number('bedrooms', '0'); await number('rooms', '7');
  await page.locator('[data-guided-field="pool"]').getByRole('button', { name: 'Privée', exact: true }).click(); await field('poolDetails-heating').selectOption('yes');
  await save(); let row = await savedByName(name); projectId = row.id;
  assert.equal(row.payload.data.guided.values.bedrooms, 0); assert.equal(row.payload.data.guided.values.pool, 'private');
  await field('propertyType').selectOption('land');
  assert.equal(await field('bedrooms').count(), 0); assert.equal(await field('pool').count(), 0);
  let retained = await openRetained(); assert.equal(await page.locator('#fonciere-retained-bedrooms').inputValue(), '0');
  assert.equal(await retained.locator('[data-guided-field="pool"]').getByRole('button', { name: 'Privée', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await retained.getByRole('button', { name: 'Confirmer pour ce type de bien', exact: true }).count(), 0);
  await save(); row = await savedByName(name);
  for (const key of ['bedrooms', 'rooms', 'pool', 'poolDetails']) assert(row.payload.data.guided.inactive.includes(key), `${key} is inactive`);
  assert.equal(row.payload.data.guided.values.bedrooms, 0); assert.equal(row.payload.data.guided.values.poolDetails.heating, 'yes');
  await page.reload(); await field('name').waitFor(); assert.equal(await field('propertyType').inputValue(), 'land'); assert.equal(await field('bedrooms').count(), 0);
  retained = await openRetained(); assert.equal(await page.locator('#fonciere-retained-bedrooms').inputValue(), '0');
  pass('House to land removes current bedroom/pool controls, preserves zero, rooms and pool details as inactive, and survives real save/reload');

  step('returning to house requires explicit confirmation of retained facts');
  await field('propertyType').selectOption('house'); assert.equal(await field('bedrooms').count(), 0);
  retained = await openRetained(); assert.equal(await page.locator('#fonciere-retained-bedrooms').inputValue(), '0');
  assert(await retained.getByRole('button', { name: 'Confirmer pour ce type de bien', exact: true }).count() >= 3);
  await confirmRetained('bedrooms'); assert.equal(await field('bedrooms').inputValue(), '0');
  await confirmRetained('rooms'); assert.equal(await field('rooms').inputValue(), '7');
  await confirmRetained('pool'); assert.equal(await page.locator('[data-guided-field="pool"]').getByRole('button', { name: 'Privée', exact: true }).getAttribute('aria-pressed'), 'true');
  await confirmRetained('poolDetails'); assert.equal(await field('poolDetails-heating').inputValue(), 'yes');
  await save(); await page.reload(); await field('name').waitFor();
  assert.equal(await field('bedrooms').inputValue(), '0'); assert.equal(await field('rooms').inputValue(), '7'); assert.equal(await field('poolDetails-heating').inputValue(), 'yes');
  row = await savedByName(name); for (const key of ['bedrooms', 'rooms', 'pool', 'poolDetails']) assert(!row.payload.data.guided.inactive.includes(key));
  pass('Return to house keeps former facts inactive until each explicit confirmation; zero and pool details remain unchanged after another save/reload');

  step('keyboard contact selection does not pick an arbitrary initial person');
  const agent = page.getByRole('combobox', { name: 'Agent immobilier / interlocuteur du CRM', exact: true });
  assert.equal(await field('agentName').inputValue(), ''); await agent.fill('Côte Azur');
  await page.getByRole('option').filter({ hasText: 'Camille' }).first().waitFor();
  assert(await page.getByRole('option').filter({ hasText: 'Alex' }).count() >= 1); assert.equal(await field('agentName').inputValue(), '');
  await agent.press('Enter'); assert.equal(await field('agentName').inputValue(), '');
  await agent.press('ArrowDown');
  const active = await agent.getAttribute('aria-activedescendant'); assert(active); const optionText = await page.locator(`[id="${active}"]`).innerText();
  await agent.press('Enter'); const selectedName = await field('agentName').inputValue(); assert(selectedName); assert(optionText.includes(selectedName));
  await save(); row = await savedByName(name); const linkResponse = await fetch(`${fixture.api}/rest/v1/fonciere_project_contacts?select=contact_id&project_id=eq.${projectId}`, { headers: headers() }); assert(linkResponse.ok); const links = await linkResponse.json(); assert(links[0]?.contact_id);
  pass('Same-company agents stay unselected after typing or Enter alone; ArrowDown plus Enter selects the explicitly highlighted canonical contact');

  step('French mobile layout and keyboard traversal');
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('FR mobile record');
  await page.locator('#fonciere-section-property').scrollIntoViewIfNeeded(); await noOverflow('FR mobile guided controls');
  await page.screenshot({ path: join(out, 'screenshots', 'context-mobile-fr.png') });
  await field('propertyType').focus(); await field('propertyType').press('Tab'); assert(await field('agencyReference').evaluate(el => el === document.activeElement));
  pass('French mobile record and contextual controls fit a 390px viewport with no horizontal overflow; keyboard Tab follows labeled controls');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); pass('No uncaught browser exceptions or external requests in the isolated local context');
} catch (error) {
  console.error(`FAIL ${phase}: ${error.message}`); await page.screenshot({ path: join(out, 'screenshots', 'context-failure.png') }).catch(() => {}); throw error;
} finally {
  writeFileSync(join(out, 'context-browser-results.json'), JSON.stringify({ kind: 'Independent actual Chrome; fictional loopback Auth/PostgreSQL/browser only; no Production writes', phase, run, projectId, checks, errors, externalRequests }, null, 2));
  await context.close(); await browser.close();
}
