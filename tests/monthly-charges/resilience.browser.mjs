/** Transport-loss and delayed-response checks using real fictitious local Auth/RPC.
 * Run sequentially after server-tests.mjs and browser.mjs; never against a remote target.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, read, login as tokenLogin, directory } from './server-local.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { buildMonthlyCharges } = require(process.env.MONTHLY_CALCULATIONS_MODULE || '/private/tmp/oar-monthly-charges-unit/lib/monthlyCharges/calculations.js');
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const app = 'http://127.0.0.1:3183';
assert.equal(fixture.app, app);
const onlyCase = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const casePrefixes = { lost: 'lost confirmed', late: 'late export', account: 'deferred export', revocation: 'revocation after' };
assert.ok(!onlyCase || onlyCase in casePrefixes, 'Known resilience case required');
const results = [], failures = [];
await connect();
const baselineSource = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const baselineSettings = (await sql.query('select * from app_private.monthly_charges_config')).rows[0];
const contributorGrant = (await sql.query("select level,sensitive from public.crm_module_grants where user_id=$1 and module='monthlyCharges'", [fixture.users.contributor.id])).rows[0];
const ownerToken = await tokenLogin(fixture.users.owner);
const contributorToken = await tokenLogin(fixture.users.contributor);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

function gate() {
  let open;
  const waiting = new Promise(resolve => { open = resolve; });
  return { waiting, open };
}
async function waitForGate(event) {
  let timer;
  try { await Promise.race([event.waiting, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for the guarded local transport event.')), 30000); })]); }
  finally { clearTimeout(timer); }
}
function localRpc(route) { assert.equal(new URL(route.request().url()).origin, 'http://127.0.0.1:55631'); }
async function restore() {
  await sql.query('update app_private.monthly_charges_config set config=$1,revision=gen_random_uuid(),updated_by=$2,updated_at=$3', [baselineSettings.config, baselineSettings.updated_by, baselineSettings.updated_at]);
  await sql.query("update public.crm_module_grants set level=$2,sensitive=$3 where user_id=$1 and module='monthlyCharges'", [fixture.users.contributor.id, contributorGrant.level, contributorGrant.sensitive]);
}
async function signIn(page, role) {
  await page.getByLabel('Email', { exact: true }).fill(fixture.users[role].email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(fixture.users[role].password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('region', { name: 'Tableau annuel des charges, défilement horizontal' }).waitFor({ timeout: 45000 });
}
async function session(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', acceptDownloads: true });
  const blocked = [], requests = [], errors = [], downloads = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['data:', 'blob:'].includes(url.protocol) || ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && ['3183', '55631'].includes(url.port)) return route.continue();
    blocked.push(url.origin); return route.abort();
  });
  const page = await context.newPage();
  page.on('request', request => requests.push(request.url()));
  if (process.argv.includes('--debug')) {
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('FRAME ' + new URL(frame.url()).pathname); });
    page.on('requestfailed', request => console.log('ABORT ' + new URL(request.url()).pathname));
  }
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.goto(app + '/charges');
  await signIn(page, role);
  return { context, page, blocked, requests, errors, downloads };
}
function audit(state) {
  assert.deepEqual(state.blocked, [], 'No nonlocal request');
  assert.deepEqual(state.errors, [], 'No runtime/hydration exception');
  assert.ok(!state.requests.some(url => /\/rest\/v1\/crm_workspace_state(?:\?|$)/.test(url)), 'Charges never requests the global source payload');
}
async function selection(page) {
  await page.getByRole('button', { name: 'Sélectionner mes charges', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sélectionner mes charges' });
  await dialog.getByLabel('Sélection Entretien septembre', { exact: true }).selectOption('exclude');
  return dialog;
}
async function assertTotal(page, token) {
  const response = await read(token);
  assert.equal(response.status, 200);
  const expected = buildMonthlyCharges(response.data, 2026).totalCents / 100;
  const actual = await page.locator('table tbody tr').filter({ has: page.getByRole('rowheader', { name: 'Total des charges sélectionnées', exact: true }) }).locator('td').last().innerText();
  assert.equal(actual.replace(/[\s\u00a0\u202f]/g, ''), expected.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }).replace(/[\s\u00a0\u202f]/g, ''));
}
async function check(name, operation) {
  if (onlyCase && !name.startsWith(casePrefixes[onlyCase])) return;
  await restore();
  try { await operation(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { failures.push({ name, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  finally { await restore(); }
}

try {
  await check('lost confirmed-save response and double click retain draft, retry same request without duplicate', async () => {
    const state = await session('owner'), { page, context } = state;
    const admitted = gate(), release = gate(), sent = [];
    let first = true;
    await page.route('**/rest/v1/rpc/crm_patch_monthly_charges', async route => {
      localRpc(route);
      sent.push(route.request().postDataJSON());
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200, 'Real RPC committed before its response is lost');
      admitted.open(); await release.waiting; await route.abort('failed');
    });
    try {
      const dialog = await selection(page);
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).evaluate(button => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await waitForGate(admitted);
      assert.equal(sent.length, 1, 'A synchronous second click admits no second RPC');
      const committed = (await read(ownerToken)).data;
      assert.ok(committed.config.exceptions.some(row => row.sourceId === 'invoice-september' && row.included === false));
      release.open();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /Enregistrement non confirmé/);
      assert.equal(await dialog.getByLabel('Sélection Entretien septembre', { exact: true }).inputValue(), 'exclude');
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(sent.length, 2);
      assert.equal(sent[0].p_request_id, sent[1].p_request_id, 'Lost-response retry uses the identical idempotency request');
      const retried = (await read(ownerToken)).data;
      assert.equal(retried.revision, committed.revision);
      assert.equal(retried.config.exceptions.filter(row => row.sourceId === 'invoice-september').length, 1);
      assert.equal(Number((await sql.query('select count(*) from app_private.monthly_charges_requests where actor_id=$1 and request_id=$2', [fixture.users.owner.id, sent[0].p_request_id])).rows[0].count), 1);
      await assertTotal(page, ownerToken); audit(state);
    } finally { release.open(); await context.close(); }
  });

  await check('late export response cannot regress a subsequently confirmed selection', async () => {
    const state = await session('owner'), { page, context } = state;
    const admitted = gate(), release = gate();
    await page.route('**/rest/v1/rpc/crm_read_monthly_charges', async route => {
      localRpc(route);
      if (!route.request().postDataJSON().p_export) return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200); admitted.open(); await release.waiting;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: 'CSV annuel', exact: true }).click();
      await waitForGate(admitted);
      const dialog = await selection(page);
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await assertTotal(page, ownerToken);
      const downloaded = page.waitForEvent('download'); release.open(); await downloaded;
      await page.getByText('Export du périmètre autorisé créé', { exact: false }).waitFor();
      await assertTotal(page, ownerToken);
      audit(state);
    } finally { release.open(); await context.close(); }
  });

  await check('deferred export cancelled on logout/account switch yields no file or old-source data', async () => {
    const state = await session('owner'), { page, context } = state;
    const admitted = gate(), release = gate(), finished = gate();
    await page.route('**/rest/v1/rpc/crm_read_monthly_charges', async route => {
      localRpc(route);
      if (!route.request().postDataJSON().p_export) return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200); admitted.open(); await release.waiting;
      try { await route.fulfill({ response }); } catch { /* The previous document cancelled its captured operation. */ }
      finished.open();
    });
    try {
      await page.getByRole('button', { name: 'CSV annuel', exact: true }).click(); await waitForGate(admitted);
      await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
      // The common portal clears the previous identity by reloading immediately.
      // That reload can supersede logout's /spaces assignment; the signed-out
      // login state is the stable invariant, independent of the winning URL.
      await page.getByLabel('Email', { exact: true }).waitFor();
      await page.goto(app + '/charges');
      await signIn(page, 'house');
      release.open(); await waitForGate(finished);
      assert.deepEqual(state.downloads, []);
      const body = await page.locator('body').innerText();
      assert.ok(!/Jardin Riviera fictif|Entretien septembre|Facture trimestrielle|PRIVATE_/.test(body));
      await page.getByRole('button', { name: 'Sélectionner mes charges', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Sélectionner mes charges' });
      assert.ok(!(await dialog.innerText()).includes('Fournisseur ·'));
      await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
      audit(state);
    } finally { release.open(); await context.close(); }
  });

  await check('revocation after an admitted save hides response, conserves same-account draft, and permits explicit recovery', async () => {
    const state = await session('contributor'), { page, context } = state;
    const admitted = gate(), release = gate();
    let intercepted = false;
    await page.route('**/rest/v1/rpc/crm_patch_monthly_charges', async route => {
      localRpc(route);
      if (intercepted) return route.continue();
      intercepted = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200); admitted.open(); await release.waiting;
      await route.fulfill({ response });
    });
    try {
      let dialog = await selection(page);
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await waitForGate(admitted);
      await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='monthlyCharges'", [fixture.users.contributor.id]);
      release.open();
      await page.getByText('Votre brouillon reste conservé pour ce compte.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('region', { name: 'Tableau annuel des charges, défilement horizontal' }).count(), 0);
      assert.equal((await read(contributorToken)).status, 403);
      await sql.query("update public.crm_module_grants set level=$2 where user_id=$1 and module='monthlyCharges'", [fixture.users.contributor.id, contributorGrant.level]);
      await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Sélectionner mes charges' });
      await dialog.waitFor();
      assert.equal(await dialog.getByLabel('Sélection Entretien septembre', { exact: true }).inputValue(), 'exclude');
      await dialog.getByRole('button', { name: 'Reprendre ma saisie sur la version actualisée' }).click();
      await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      await assertTotal(page, contributorToken); audit(state);
    } finally { release.open(); await context.close(); }
  });
} finally {
  await restore();
  const after = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
  assert.deepEqual(after, baselineSource, 'Every original fictitious invoice/hour/payment/source unchanged');
  await sql.end(); await browser.close();
  writeFileSync(join(directory, 'resilience-browser-results.json'), JSON.stringify({ results, failures, realLocalJWT: true, realRPC: true, simulatedTransportFaultsOnly: true, productionAccess: false, sourcePreserved: true }, null, 2), { mode: 0o600 });
}
assert.deepEqual(failures, [], 'All response-loss and identity-bound browser cases must pass');
