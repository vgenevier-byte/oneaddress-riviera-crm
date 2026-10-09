/** Clearly separate injected failures and an actual LOCAL committed/lost reply.
 * No successful response is fabricated. The ambiguous case calls route.fetch()
 * against real LOCAL RPC, verifies its 200, then aborts only the browser reply.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.CONTACTS_ENTITY_BENCH);
const bench = JSON.parse(readFileSync(process.env.CONTACTS_ENTITY_BENCH, 'utf8'));
const origin = process.env.CONTACTS_ENTITY_ORIGIN || 'http://127.0.0.1:3399', backend = new URL(bench.origin).origin;
for (const value of [origin, backend]) assert.ok(new URL(value).protocol === 'http:' && new URL(value).hostname === '127.0.0.1');
const out = process.env.CONTACTS_ENTITY_FAULTS_OUT || join(dirname(process.cwd()), 'evidence/browser-faults');
mkdirSync(out, { recursive: true });
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const results = process.env.CONTACTS_ENTITY_APPEND ? JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) : [];
function isMutation(request) { return request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/crm_mutate_record'; }
async function language(page, config, value, record) {
  if (config.mobile) await page.locator('#unified-more-trigger').click();
  const nav = page.locator(config.mobile ? '.unified-more-panel' : '.sidebar');
  await nav.locator('[data-language-selector]').getByRole('button', { name: value === 'en' ? 'English — EN' : 'Français — FR', exact: true }).click();
  if (config.mobile) await nav.locator('.unified-more-close').click();
  await page.waitForFunction(expected => document.documentElement.lang === expected, value === 'en' ? 'en-GB' : 'fr');
  record.languageChanges++;
}
async function realRead(context, page, record) {
  const accessToken = await page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token')); return JSON.parse(localStorage.getItem(key)).access_token; });
  const response = await context.request.post(backend + '/rest/v1/rpc/crm_read_module', { headers: { apikey: bench.publishableKey, Authorization: 'Bearer ' + accessToken }, data: { p_module: 'contacts' } });
  assert.equal(response.status(), 200); const data = await response.json(); record.realReads.push({ status: response.status(), revision: data.revision }); return data.collections.contacts;
}
for (const config of [{ engine: 'chromium', mobile: false, viewport: { width: 1440, height: 1000 } }, { engine: 'webkit', mobile: true, viewport: { width: 390, height: 667 } }].filter(config => !process.env.CONTACTS_ENTITY_ENGINE || process.env.CONTACTS_ENTITY_ENGINE === config.engine)) {
  const browser = await (config.engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome' }) : webkit.launch({ headless: true }));
  for (const profile of ['owner', 'contributor'].filter(profile => !process.env.CONTACTS_ENTITY_PROFILE || profile === process.env.CONTACTS_ENTITY_PROFILE)) {
    const record = { name: `${config.engine}-${profile}`, profile, viewport: config.viewport, status: 'running', cases: [], mutations: [], screenshots: [], realReads: [], languageChanges: 0, unexpected: [], proofBoundary: 'Failure-only HTTP injections are explicitly simulated; they never reach PostgreSQL. The committed/lost-reply case forwards the actual request to LOCAL Auth/JWT/PostgREST/RPC and aborts only its browser response. No simulated success or Production account.' };
    const context = await browser.newContext({ viewport: config.viewport }), page = await context.newPage();
    let dismissNavigation = false, navigationDialog;
    page.setDefaultTimeout(20000);
    page.on('dialog', async dialog => { if (dismissNavigation && dialog.type() === 'confirm') { dismissNavigation = false; navigationDialog = { type: dialog.type(), message: dialog.message(), dismissed: true }; await dialog.dismiss(); } else await dialog.accept(); });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([origin, backend].includes(url.origin)) return route.continue(); record.unexpected.push(url.origin + url.pathname); return route.abort(); });
    page.on('request', request => { if (isMutation(request)) record.mutations.push({ body: request.postDataJSON() }); });
    let handler;
    try {
      await page.goto(origin + '/contacts-entity-demo'); await page.locator(`[data-local-profile="${profile}"]`).click(); await page.waitForURL(url => url.pathname === '/');
      let form = page.locator('.contact-create-form');
      const company = `Société Faute locale ${runId}-${record.name}`;
      let handle;
      async function prepareFreshDraft() {
        form = page.locator('.contact-create-form'); await form.waitFor();
        if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' });
        await page.waitForLoadState('networkidle'); await language(page, config, 'fr', record);
        await form.locator('[name="entityType"]').selectOption('company');
        await form.locator('[name="companyName"]').fill(company); await form.locator('[name="firstName"]').fill('Guillaume');
        handle = await form.elementHandle();
      }
      await prepareFreshDraft();
      for (const failure of [{ name: 'known-company-validation', status: 400, message: 'contact_company_name_required', expectFR: 'Veuillez renseigner le nom de l’entreprise.', expectEN: 'Please enter the company name.' }, { name: 'revision-conflict', status: 500, message: 'revision_conflict', expectFR: 'Conflit', expectEN: 'Conflict' }, { name: 'unknown-safe-error', status: 500, message: 'FICTIONAL_INTERNAL_SECRET_MUST_NEVER_BE_RENDERED', expectFR: 'Enregistrement', expectEN: 'Save' }]) {
        handler = async route => { if (!isMutation(route.request())) return route.continue(); return route.fulfill({ status: failure.status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*' }, body: JSON.stringify({ code: failure.name === 'revision-conflict' ? '40001' : 'P0001', message: failure.message }) }); };
        await context.route('**/rest/v1/rpc/crm_mutate_record', handler);
        const count = record.mutations.length;
        await form.locator('button[type="submit"]').click();
        await form.getByText(failure.expectFR, { exact: false }).first().waitFor();
        assert.equal(record.mutations.length, count + 1);
        if (failure.name === 'known-company-validation') { assert.equal(await form.locator('[name="companyName"]').getAttribute('aria-invalid'), 'true'); assert.equal(await form.locator('[name="companyName"]').evaluate(element => element === document.activeElement), true); }
        for (const value of ['fr', 'en', 'fr']) {
          await language(page, config, value, record); await form.getByText(value === 'fr' ? failure.expectFR : failure.expectEN, { exact: false }).first().waitFor();
          assert.equal(await handle.evaluate(element => element.isConnected), true); assert.equal(await form.locator('[name="companyName"]').inputValue(), company); assert.equal(await form.locator('[name="firstName"]').inputValue(), 'Guillaume');
          assert.ok(!(await form.textContent()).includes('FICTIONAL_INTERNAL_SECRET'));
          assert.equal(record.mutations.length, count + 1);
          if (failure.name === 'known-company-validation' && !record.screenshots.some(item => item.view === failure.name && item.language === value)) { const path = join(out, record.name + '-' + failure.name + '-' + value + '.png'); await form.locator('[name="companyName"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path }); record.screenshots.push({ path, language: value, view: failure.name, state: 'injected-error' }); }
        }
        record.cases.push({ name: failure.name, injectedFailureOnly: true, reachedDatabase: false, successfulResponseSimulated: false, draftPreserved: true });
        if (failure.name === 'known-company-validation') {
          const writes = record.mutations.length, url = page.url();
          if (config.mobile) await page.locator('#unified-more-trigger').click();
          const nav = page.locator(config.mobile ? '.unified-more-panel' : '.sidebar');
          dismissNavigation = true;
          await nav.getByRole('button', { name: /^(Déconnexion|Se déconnecter|Sign out)$/ }).click();
          assert.ok(navigationDialog, 'An unsuccessful async Contacts draft warns before leaving');
          if (config.mobile && await nav.isVisible()) await nav.locator('.unified-more-close').click();
          assert.equal(page.url(), url); assert.equal(await handle.evaluate(element => element.isConnected), true); assert.equal(await form.locator('[name="companyName"]').inputValue(), company); assert.equal(record.mutations.length, writes);
          record.navigationProtection = { ...navigationDialog, draftPreserved: true, actualClick: true, noAdditionalMutation: true };
        }
        await context.unroute('**/rest/v1/rpc/crm_mutate_record', handler); handler = null;
        // The draft was proven intact above. A deliberate reload isolates the
        // next independent failure from the owner's legitimate conflict lock.
        await page.reload(); await prepareFreshDraft();
      }
      let committed;
      handler = async route => {
        if (!isMutation(route.request())) return route.continue();
        const body = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal(response.status(), 200, 'Actual LOCAL RPC commits the fictional Contact');
        const data = await response.json(); committed = { id: body.p_id, status: response.status(), revision: data.revision, responseForwardedToBrowser: false };
        await route.abort('failed');
      };
      await context.route('**/rest/v1/rpc/crm_mutate_record', handler);
      const count = record.mutations.length;
      await form.locator('button[type="submit"]').click();
      await form.getByText(/non confirm|not confirmed|unconfirmed/i).first().waitFor();
      assert.ok(committed); assert.equal(await form.locator('[name="companyName"]').inputValue(), company); assert.equal(await handle.evaluate(element => element.isConnected), true);
      let contacts = await realRead(context, page, record);
      assert.equal(contacts.filter(contact => contact.companyName === company).length, 1); assert.ok(contacts.some(contact => contact.id === committed.id));
      await context.unroute('**/rest/v1/rpc/crm_mutate_record', handler); handler = null;
      for (const value of ['en', 'fr']) { await language(page, config, value, record); assert.equal(record.mutations.length, count + 1); }
      const retryCount = record.mutations.length;
      const retryResponse = page.waitForResponse(response => isMutation(response.request()), { timeout: 5000 }).catch(() => null);
      await form.locator('button[type="submit"]').click();
      await page.waitForFunction(element => !element.disabled, await form.locator('button[type="submit"]').elementHandle());
      // A fresh JWT/workspace revision read precedes the RPC or local guard.
      // Wait for that async result rather than sampling an initially enabled button.
      const retried = await retryResponse;
      await page.waitForLoadState('networkidle');
      let retryStatus = null, retryOutcome;
      if (record.mutations.length > retryCount) {
        assert.equal(record.mutations.length, retryCount + 1);
        assert.ok(retried); retryStatus = retried.status();
        assert.ok([200, 409, 500].includes(retryStatus), 'Retry is confirmed or safely conflicts');
        if (retryStatus === 500) { const error = await retried.json(); assert.ok(error.code === '40001' || /revision_conflict/.test(error.message)); }
        assert.equal(record.mutations.at(-1).body.p_id, committed.id, 'A retry reuses the draft Contact ID');
        retryOutcome = retryStatus === 200 ? 'real RPC confirmed the same ID' : 'real server revision conflict';
      } else {
        const text = await form.textContent(), reset = await form.locator('[name="companyName"]').inputValue() === '';
        assert.ok(reset || /conflit|conflict/i.test(text), 'Retry without another mutation must reconcile the committed record or show the local version guard');
        retryOutcome = reset ? 'confirmed by real server reread without another mutation' : 'local version guard; no second mutation';
      }
      contacts = await realRead(context, page, record); assert.equal(contacts.filter(contact => contact.companyName === company).length, 1);
      record.cases.push({ name: 'real-local-commit-lost-browser-reply-retry', injectedNetworkFailure: true, actualServerCommit: committed, retryStatus, retryOutcome, stableDraftId: true, finalMatchingContacts: 1, successfulResponseSimulated: false });
      assert.deepEqual(record.unexpected, []); record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = error.stack; await page.screenshot({ path: join(out, record.name + '-failure.png') }).catch(() => {}); }
    finally { if (handler) await context.unroute('**/rest/v1/rpc/crm_mutate_record', handler).catch(() => {}); await context.close(); const index = results.findIndex(item => item.name === record.name); if (index < 0) results.push(record); else results[index] = record; writeFileSync(join(out, record.name + '.json'), JSON.stringify(record, null, 2) + '\n'); console.log(record.name + ' ' + record.status); if (record.error) console.error(record.error); }
  }
  await browser.close();
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(record => record.status !== 'passed')) process.exitCode = 1;
