/** Integrated targeted Leads/contactName proof. Real LOCAL Auth/reads/writes.
 * Before-mode reproduces the missing historical option without a server write.
 * No successful Auth/database response is ever simulated by this harness.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.CONTACTS_ENTITY_BENCH && process.env.LEADS_BROWSER_SEEDS, 'Explicit local accounts and fictional seed manifest required');
const bench = JSON.parse(readFileSync(process.env.CONTACTS_ENTITY_BENCH, 'utf8'));
const seeds = JSON.parse(readFileSync(process.env.LEADS_BROWSER_SEEDS, 'utf8'));
const destination = process.env.CONTACTS_ENTITY_DEST || dirname(process.cwd());
const mode = process.env.LEADS_BROWSER_MODE || 'before';
assert.ok(['before', 'after'].includes(mode));
const manifestPath = process.env.CONTACTS_ENTITY_DEMO_MANIFEST || join(destination, 'evidence/demo-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const origin = manifest.app, backend = new URL(bench.origin).origin;
for (const value of [origin, backend]) assert.ok(new URL(value).protocol === 'http:' && new URL(value).hostname === '127.0.0.1');
assert.equal(manifest.backend, backend); assert.equal(manifest.status, 'ready'); assert.equal(manifest.mode, 'production');
const out = join(destination, 'evidence/leads-correction/browser', mode), captures = join(out, 'captures');
mkdirSync(captures, { recursive: true });
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const testSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
function sourceMatch(requireCurrent) {
  const mismatch = [];
  for (const entry of manifest.sourceFiles) for (const [type, root] of [['servedCopy', manifest.directory], ...(requireCurrent ? [['source', manifest.sourceRoot]] : [])]) {
    const actual = createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex');
    if (actual !== entry.sha256) mismatch.push({ type, path: entry.path, expected: entry.sha256, actual });
  }
  assert.deepEqual(mismatch, []);
  return { files: manifest.sourceFiles.length, servedCopyExact: true, currentSourceChecked: requireCurrent, mismatches: mismatch };
}
const sourceBefore = sourceMatch(mode === 'after');
const results = [];
function isWrite(request) { const url = new URL(request.url()); return url.origin === backend && ((request.method() === 'PATCH' && url.pathname === '/rest/v1/crm_workspace_state') || (request.method() === 'POST' && url.pathname === '/rest/v1/rpc/crm_mutate_record')); }
async function language(page, value, record) {
  const button = page.locator('.sidebar [data-language-selector]').getByRole('button', { name: value === 'en' ? 'English — EN' : 'Français — FR', exact: true });
  if (await page.getByRole('dialog').count()) { await button.evaluate(element => element.click()); record.programmaticModalLanguageChanges++; } else await button.click();
  await page.waitForFunction(expected => document.documentElement.lang === expected, value === 'en' ? 'en-GB' : 'fr');
}
async function login(page, profile) {
  await page.goto(origin + '/contacts-entity-demo'); await page.locator(`[data-local-profile="${profile}"]`).click(); await page.waitForURL(url => url.pathname === '/');
  await page.locator('.crm-shell').waitFor();
  await page.goto(origin + '/?module=leads'); await page.locator('.crm-shell').waitFor();
  if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
}
async function token(page) { return page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.endsWith('-auth-token')) { const session = JSON.parse(localStorage.getItem(key)); if (session.access_token) return session.access_token; } throw new Error('No actual local Auth session'); }); }
async function localHeaders(page) { return { apikey: bench.publishableKey, Authorization: 'Bearer ' + await token(page) }; }
async function readLeads(context, page, record) {
  const response = await context.request.post(backend + '/rest/v1/rpc/crm_read_module', { headers: await localHeaders(page), data: { p_module: 'leads' } });
  assert.equal(response.status(), 200); const data = await response.json();
  record.realReads.push({ status: response.status(), revision: data.revision }); return data;
}
function leadCard(page, id) { return page.locator(`[data-notification-target="lead-${id}"]`); }
async function edit(page, id) { await leadCard(page, id).locator('.lead-edit-button').click(); const form = page.locator('#lead-edit-panel form'); await form.waitFor(); return form; }
async function frame(page, field, record, name, value) {
  await field.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(650);
  const path = join(captures, `${record.name}-${name}-${value}.png`); await page.screenshot({ path }); record.screenshots.push({ path, language: value, view: name, state: mode });
}
for (const engine of (process.env.LEADS_BROWSER_ENGINES || 'chromium').split(',')) {
  assert.ok(['chromium', 'webkit'].includes(engine));
  const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome' }) : webkit.launch({ headless: true }));
  for (const profile of (process.env.LEADS_BROWSER_PROFILES || 'owner').split(',')) {
    const record = { name: `${engine}-${profile}`, profile, mode, status: 'running', auth: [], writes: [], requests: [], dialogs: [], realReads: [], realSaves: [], cases: [], screenshots: [], unexpected: [], errors: [], programmaticModalLanguageChanges: 0, proofBoundary: 'Actual integrated candidate, fictional LOCAL password Auth/JWT/PostgREST. Successes are never fulfilled. Before mode uses the previous immutable production-mode copy; after mode verifies final source and served copy hashes.' };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    page.setDefaultTimeout(20000); page.on('dialog', async dialog => { record.dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); }); page.on('pageerror', error => record.errors.push(error.message));
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([origin, backend].includes(url.origin)) return route.continue(); record.unexpected.push(url.origin + url.pathname); return route.abort(); });
    page.on('request', request => { const url = new URL(request.url()); if (url.origin === backend) record.requests.push({ method: request.method(), path: url.pathname }); });
    page.on('response', async response => { const url = new URL(response.url()); if (url.origin === backend && url.pathname.startsWith('/auth/')) record.auth.push({ method: response.request().method(), path: url.pathname, status: response.status() }); if (isWrite(response.request())) { let body; try { body = await response.json(); } catch { body = null; } record.writes.push({ method: response.request().method(), path: url.pathname, status: response.status(), response: body }); } });
    try {
      await login(page, profile);
      if (mode === 'before') {
        const data = await readLeads(context, page, record);
        const lead = data.collections.leads.find(lead => lead.nextAction === 'leads-browser-case-surname'); assert.ok(lead); assert.equal(lead.contactName, 'Dupont');
        const form = await edit(page, lead.id), select = form.locator('[name="contactName"]');
        const handle = await select.elementHandle();
        for (const value of ['fr', 'en']) {
          await language(page, value, record);
          const selected = await select.inputValue(), options = await select.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
          assert.equal(selected, ''); assert.ok(!options.some(option => option.value === 'Dupont')); assert.ok(options.some(option => option.value === 'Alice Dupont'));
          assert.equal(await select.evaluate(element => element.validity.valueMissing), true); assert.equal(await handle.evaluate(element => element.isConnected), true);
          await form.locator('[name="value"]').fill('123'); await form.locator('button[type="submit"]').click();
          assert.equal(await select.inputValue(), ''); assert.equal(await form.isVisible(), true); assert.equal(record.writes.length, 0);
          await frame(page, select, record, 'historic-surname-missing-option', value);
          record.cases.push({ language: value, storedContactName: lead.contactName, selected, optionValues: options.map(option => option.value), valueMissing: true, ordinaryOtherFieldEditBlocked: true, successfulWriteSimulated: false });
        }
        const after = await readLeads(context, page, record); assert.equal(after.collections.leads.find(row => row.id === lead.id).contactName, 'Dupont'); assert.equal(record.writes.length, 0);
        record.status = 'reproduced';
      } else {
        async function noOperations(operation) {
          await page.waitForLoadState('networkidle'); const before = record.requests.length;
          await operation(); await page.waitForTimeout(100);
          assert.equal(record.requests.length, before, 'Opening, draft and language changes must not read more contacts, reauthenticate or write');
        }
        async function saveConfirmed(form, id, expectedName, expectedValue) {
          const responsePromise = page.waitForResponse(response => isWrite(response.request()));
          await form.locator('button[type="submit"]').click();
          const response = await responsePromise; assert.equal(response.status(), 200);
          const data = await response.json();
          if (profile === 'owner') assert.ok(Array.isArray(data) && data.length === 1 && data[0].updated_at, 'Owner CAS must actually acknowledge one row');
          else assert.ok(data.collections.leads.some(lead => lead.id === id), 'Limited RPC confirms the exact lead');
          await page.waitForLoadState('networkidle');
          const reread = await readLeads(context, page, record), saved = reread.collections.leads.find(lead => lead.id === id);
          assert.equal(saved.contactName, expectedName); if (expectedValue !== undefined) assert.equal(saved.value, expectedValue);
          record.realSaves.push({ id, path: new URL(response.url()).pathname, status: response.status(), contactName: saved.contactName, value: saved.value, rereadRevision: reread.revision, successSimulated: false });
          await page.locator('#lead-edit-panel').waitFor({ state: 'hidden' });
          return saved;
        }
        const cases = engine === 'webkit' ? seeds.leads.filter(lead => lead.key === 'surname') : seeds.leads;
        for (const seed of cases) for (const value of ['fr', 'en']) {
          await language(page, value, record);
          const before = await readLeads(context, page, record), stored = before.collections.leads.find(lead => lead.id === seed.id); assert.ok(stored);
          assert.equal(stored.contactName, seed.contactName);
          let form; await noOperations(async () => { form = await edit(page, seed.id); });
          const select = form.locator('[name="contactName"]'), handle = await select.elementHandle();
          assert.equal(await select.inputValue(), seed.contactName); assert.equal(await select.evaluate(element => element.validity.valid), true);
          const options = await select.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
          const retained = ['surname', 'civility', 'missing', 'homonym'].includes(seed.key);
          const selectedText = await select.locator('option:checked').textContent();
          if (retained) assert.equal(selectedText, (value === 'fr' ? 'Contact historique conservé : ' : 'Historical contact retained: ') + seed.contactName);
          if (seed.key === 'homonym') { assert.ok(options.filter(option => option.value === 'Camille Martin' && option.text === 'Camille Martin').length >= 2, 'All separate readable homonym options remain present; prior fictional fixtures may add more'); assert.ok(selectedText.startsWith(value === 'fr' ? 'Contact historique' : 'Historical contact')); }
          assert.ok(options.some(option => option.value === 'Société Seule')); assert.ok(options.some(option => option.value === 'Société Guillaume')); assert.ok(!options.some(option => option.value === 'Guillaume'));
          const nextValue = Number(stored.value) + 1;
          await form.locator('[name="value"]').fill(String(nextValue));
          await noOperations(async () => { await language(page, value === 'fr' ? 'en' : 'fr', record); await language(page, value, record); });
          assert.equal(await handle.evaluate(element => element.isConnected), true); assert.equal(await select.inputValue(), seed.contactName); assert.equal(await form.locator('[name="value"]').inputValue(), String(nextValue));
          const saved = await saveConfirmed(form, seed.id, seed.contactName, nextValue);
          assert.equal(saved.nextAction, stored.nextAction); assert.equal(saved.dueDate, stored.dueDate); assert.equal(saved.status, stored.status);
          if (seed.key === 'surname') {
            await page.reload(); if (profile === 'owner') await page.locator('.shared-db-status-panel.connected').waitFor({ state: 'attached' }); await page.waitForLoadState('networkidle');
            form = await edit(page, seed.id); assert.equal(await form.locator('[name="contactName"]').inputValue(), seed.contactName); assert.equal(await form.locator('[name="value"]').inputValue(), String(nextValue));
            await frame(page, form.locator('[name="contactName"]'), record, 'historic-surname-preserved-real-reload', value);
            await form.locator('[data-crm-dismiss="true"]').click();
          }
          record.cases.push({ key: seed.key, language: value, historicalOption: retained, sameDOMAndDraftAcrossLanguage: true, noAdditionalDirectoryReadOnOpenOrLanguage: true, savedContactName: saved.contactName, unchangedAfterOtherFieldEdit: true, realServerSaveAndJWTRead: true });
        }
        // Explicit choices use a normal, unambiguous existing contact and are
        // restored explicitly; historical fixtures are never backfilled.
        if (engine === 'chromium') {
          const seed = seeds.leads.find(lead => lead.key === 'full');
          for (const [value, name] of [['fr', 'Société Guillaume'], ['en', 'Alice Dupont']]) {
            await language(page, value, record); const form = await edit(page, seed.id);
            await form.locator('[name="contactName"]').selectOption(name);
            await saveConfirmed(form, seed.id, name);
            record.cases.push({ key: 'explicit-change', language: value, contactName: name, realServerSaveAndJWTRead: true });
          }
        }
        // Validation runs before the existing synchronous Leads submit. The
        // parent is not redesigned into the Contacts confirmed-form workflow.
        const historic = seeds.leads.find(lead => lead.key === 'surname');
        for (const value of ['fr', 'en']) {
          await language(page, value, record); let form = await edit(page, historic.id);
          const select = form.locator('[name="contactName"]'), handle = await form.elementHandle(), originalAction = await form.locator('[name="nextAction"]').inputValue();
          const writes = record.writes.length, alerts = record.dialogs.length;
          await form.locator('[name="nextAction"]').fill(''); await form.locator('button[type="submit"]').click();
          assert.equal(record.dialogs.length, alerts + 1); assert.equal(record.dialogs.at(-1).type, 'alert'); assert.equal(await handle.evaluate(element => element.isConnected), true); assert.equal(await select.inputValue(), historic.contactName); assert.equal(record.writes.length, writes);
          await language(page, value === 'fr' ? 'en' : 'fr', record); await language(page, value, record); assert.equal(await select.inputValue(), historic.contactName); assert.equal(await form.locator('[name="nextAction"]').inputValue(), '');
          await form.locator('[name="nextAction"]').fill(originalAction + '-cancelled-draft'); await form.locator('[data-crm-dismiss="true"]').click();
          assert.equal(record.writes.length, writes); const reread = await readLeads(context, page, record), stored = reread.collections.leads.find(lead => lead.id === historic.id); assert.equal(stored.contactName, historic.contactName); assert.equal(stored.nextAction, originalAction);
          record.cases.push({ key: 'validation-and-cancel', language: value, preSubmitValidationRetainsFormAndHistoricalLink: true, cancelDoesNotWriteOrReplaceLink: true, cancelledDraftIntentionallyDiscarded: true });
        }
        if (engine === 'chromium') {
          // Actual concurrent local write, not a fabricated revision error.
          const form = await edit(page, historic.id), before = await readLeads(context, page, record), stored = before.collections.leads.find(lead => lead.id === historic.id);
          const draftValue = Number(stored.value) + 100, competingValue = Number(stored.value) + 50;
          await form.locator('[name="value"]').fill(String(draftValue));
          const concurrent = await context.request.post(backend + '/rest/v1/rpc/crm_mutate_record', { headers: await localHeaders(page), data: { p_module: 'leads', p_collection: 'leads', p_id: historic.id, p_patch: { value: competingValue }, p_revision: before.revision, p_delete: false } });
          assert.equal(concurrent.status(), 200);
          const responsePromise = page.waitForResponse(response => isWrite(response.request()));
          await form.locator('button[type="submit"]').click(); const response = await responsePromise, data = await response.json();
          if (profile === 'owner') { assert.equal(response.status(), 200); assert.ok(data === null || Array.isArray(data) && data.length === 0, 'Actual owner global CAS refuses an obsolete revision'); await page.locator('.shared-db-status-panel.error').waitFor({ state: 'attached' }); }
          else { assert.equal(response.status(), 500); assert.ok(data.code === '40001' || /revision_conflict/.test(data.message)); }
          const after = await readLeads(context, page, record), server = after.collections.leads.find(lead => lead.id === historic.id); assert.equal(server.contactName, historic.contactName); assert.equal(server.value, competingValue);
          let reopened;
          if (profile === 'owner') { await page.locator('#lead-edit-panel').waitFor({ state: 'hidden' }); reopened = await edit(page, historic.id); }
          else { reopened = form; await reopened.waitFor({ state: 'visible' }); }
          assert.equal(await reopened.locator('[name="contactName"]').inputValue(), historic.contactName);
          const recoveredValue = await reopened.locator('[name="value"]').inputValue(); assert.equal(recoveredValue, String(draftValue));
          const handle = await reopened.elementHandle();
          await language(page, 'en', record); assert.equal(await reopened.locator('[name="contactName"]').inputValue(), historic.contactName); assert.equal(await reopened.locator('[name="value"]').inputValue(), String(draftValue)); await language(page, 'fr', record); assert.equal(await handle.evaluate(element => element.isConnected), true);
          let retryStatus = null;
          if (profile !== 'owner') {
            await page.waitForFunction(element => !element.disabled, await reopened.locator('button[type="submit"]').elementHandle());
            const retryPromise = page.waitForResponse(response => isWrite(response.request())); await reopened.locator('button[type="submit"]').click(); const retry = await retryPromise; retryStatus = retry.status(); assert.equal(retryStatus, 500); const error = await retry.json(); assert.ok(error.code === '40001' || /revision_conflict/.test(error.message));
            assert.equal(await handle.evaluate(element => element.isConnected), true); assert.equal(await reopened.locator('[name="contactName"]').inputValue(), historic.contactName); assert.equal(await reopened.locator('[name="value"]').inputValue(), String(draftValue));
          }
          record.conflict = { realConcurrentMutationStatus: concurrent.status(), browserStatus: response.status(), SQLState: data?.code || null, retryStatus, historicalLinkRetained: true, serverValue: competingValue, attemptedValue: draftValue, recoveredFormValue: recoveredValue, ownerUnsyncedLocalRecordRetained: profile === 'owner', limitedPreSubmitDraftRetainedAfterFailure: profile !== 'owner', modalRetainedAfterServerRefusal: profile !== 'owner', ownerExistingModalClosesBeforeGlobalPersistenceConfirmation: profile === 'owner', successfulResponseSimulated: false };
        }
        record.status = 'passed';
      }
      assert.deepEqual(record.errors, []); assert.deepEqual(record.unexpected, []);
    } catch (error) { record.status = 'failed'; record.error = error.stack; await page.screenshot({ path: join(captures, record.name + '-failure.png') }).catch(() => {}); }
    finally { await context.close(); results.push(record); writeFileSync(join(out, record.name + '.json'), JSON.stringify(record, null, 2) + '\n'); console.log(record.name + ' ' + record.status); if (record.error) console.error(record.error); }
  }
  await browser.close();
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ mode, origin, backend, runId, testSha256, seedManifest: process.env.LEADS_BROWSER_SEEDS, sourceBefore, sourceAfter: sourceMatch(mode === 'after'), results }, null, 2) + '\n');
if (results.some(record => record.status === 'failed')) process.exitCode = 1;
