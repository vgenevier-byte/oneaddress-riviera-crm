// Real LOCAL Auth/JWT/RPC boundaries for read-only, no-right and revoked users.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
assert.ok(process.env.CONTACTS_ENTITY_BENCH);
const bench = JSON.parse(readFileSync(process.env.CONTACTS_ENTITY_BENCH, 'utf8'));
const origin = process.env.CONTACTS_ENTITY_ORIGIN || 'http://127.0.0.1:3399';
const backend = new URL(bench.origin).origin;
for (const value of [origin, backend]) assert.ok(new URL(value).protocol === 'http:' && new URL(value).hostname === '127.0.0.1');
const out = process.env.CONTACTS_ENTITY_PERMISSIONS_OUT || join(dirname(process.cwd()), 'evidence/browser-permissions');
mkdirSync(out, { recursive: true });
const results = [];
async function token(page) { return page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token')); return JSON.parse(localStorage.getItem(key)).access_token; }); }
for (const config of [{ engine: 'chromium', mobile: false, viewport: { width: 1440, height: 1000 } }, { engine: 'webkit', mobile: true, viewport: { width: 390, height: 667 } }].filter(config => !process.env.CONTACTS_ENTITY_ENGINE || process.env.CONTACTS_ENTITY_ENGINE === config.engine)) {
  const browser = await (config.engine === 'chromium' ? chromium.launch({ headless: true, channel: 'chrome' }) : webkit.launch({ headless: true }));
  for (const profile of ['reader', 'none', 'revoked']) {
    const record = { name: `${config.engine}-${profile}`, status: 'running', profile, viewport: config.viewport, browserVersion: browser.version(), auth: [], mutations: [], browserMutationRequests: [], browserMutationResponses: [], unexpected: [], screenshots: [], proofBoundary: 'Real password Auth and JWT→PostgREST→RPC in the isolated LOCAL database. Fictional accounts only. Revocation changes only the dedicated local test account through the reviewable bench control helper. No successful response is simulated.' };
    const context = await browser.newContext({ viewport: config.viewport }), page = await context.newPage();
    page.setDefaultTimeout(20000); page.on('dialog', dialog => dialog.accept());
    await context.route('**/*', route => { const url = new URL(route.request().url()); if ([origin, backend].includes(url.origin)) return route.continue(); record.unexpected.push(url.origin + url.pathname); return route.abort(); });
    page.on('response', response => { const url = new URL(response.url()); if (url.origin === backend && url.pathname.startsWith('/auth/')) record.auth.push({ path: url.pathname, status: response.status() }); });
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/rpc/crm_mutate_record') record.browserMutationRequests.push(request.postDataJSON()); });
    page.on('response', response => { if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/rest/v1/rpc/crm_mutate_record') record.browserMutationResponses.push({ status: response.status() }); });
    let restore;
    try {
      if (profile === 'revoked') { const control = await import('./server-control.mjs'); const previous = await control.setContactLevel(profile, 'contribute'); restore = () => control.setContactLevel(profile, previous); }
      await page.goto(origin + '/contacts-entity-demo'); await page.locator(`[data-local-profile="${profile}"]`).click(); await page.waitForURL(url => url.pathname === '/'); await page.locator('.crm-shell').waitFor();
      const headers = { apikey: bench.publishableKey, Authorization: 'Bearer ' + await token(page) };
      const read = await context.request.post(backend + '/rest/v1/rpc/crm_read_module', { headers, data: { p_module: 'contacts' } });
      if (profile === 'none') { assert.equal(read.status(), 403); assert.equal(await page.locator('.contacts-workspace').count(), 0); record.read = { status: read.status(), contactsDelivered: false }; }
      else {
        assert.equal(read.status(), 200); await page.locator('.contacts-workspace').waitFor();
        const projection = await read.json(); record.read = { status: read.status(), contactsDelivered: true, revision: projection.revision };
        const form = page.locator('.contact-create-form');
        if (profile === 'reader') {
          assert.equal(await form.locator('[name="entityType"]').isDisabled(), true); assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
          for (const value of ['fr', 'en', 'fr']) {
            if (config.mobile) await page.locator('#unified-more-trigger').click();
            const nav = page.locator(config.mobile ? '.unified-more-panel' : '.sidebar');
            await nav.locator('[data-language-selector]').getByRole('button', { name: value === 'en' ? 'English — EN' : 'Français — FR', exact: true }).click();
            if (config.mobile) await nav.locator('.unified-more-close').click();
            assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
            if (!record.screenshots.some(item => item.language === value)) { const path = join(out, record.name + '-' + value + '.png'); await form.locator('[name="entityType"]').scrollIntoViewIfNeeded(); await page.screenshot({ path }); record.screenshots.push({ path, language: value, view: 'Contacts read-only', state: 'disabled' }); }
          }
        } else {
          await form.locator('[name="entityType"]').selectOption('company'); await form.locator('[name="companyName"]').fill('Brouillon fictif conservé après révocation');
          const control = await import('./server-control.mjs'); await control.setContactLevel(profile, 'none');
          record.revocation = { before: 'contribute', after: 'none', localAccountOnly: true };
        }
        const response = await context.request.post(backend + '/rest/v1/rpc/crm_mutate_record', { headers, data: { p_module: 'contacts', p_collection: 'contacts', p_id: crypto.randomUUID(), p_patch: { entityType: 'company', companyName: 'Entreprise refusée fictive', kind: 'Client' }, p_revision: projection.revision, p_delete: false } });
        assert.equal(response.status(), 403, 'Real server refuses a valid contact patch without current contribute rights'); record.mutations.push({ status: response.status(), message: (await response.json()).message });
        if (profile === 'revoked') {
          const before = await form.locator('[name="companyName"]').inputValue();
          const beforeCount = record.mutations.length;
          await form.locator('button[type="submit"]').click();
          await form.getByText(/interrompu|droits|interrupted|rights|permission/i).first().waitFor();
          assert.equal(await form.locator('[name="companyName"]').inputValue(), before);
          assert.equal(await form.locator('button[type="submit"]').isDisabled(), false);
          const text = await form.textContent(); assert.ok(/interrompu|droits|interrupted|rights|permission/i.test(text)); assert.equal(record.mutations.length, beforeCount);
          record.browserRevocation = { draftPreserved: true, noSuccessClaim: true };
        }
      }
      if (profile === 'none') {
        const response = await context.request.post(backend + '/rest/v1/rpc/crm_mutate_record', { headers, data: { p_module: 'contacts', p_collection: 'contacts', p_id: crypto.randomUUID(), p_patch: { entityType: 'company', companyName: 'Entreprise interdite fictive' }, p_revision: '', p_delete: false } });
        assert.equal(response.status(), 403); record.mutations.push({ status: response.status(), message: (await response.json()).message });
      }
      assert.ok(record.auth.some(item => item.path === '/auth/v1/token' && item.status === 200), 'Real local password login observed');
      assert.ok(record.browserMutationResponses.every(response => response.status >= 400), 'No browser mutation succeeds after revoked/no-write access');
      assert.deepEqual(record.unexpected, []); record.status = 'passed';
    } catch (error) { record.status = 'failed'; record.error = error.stack; await page.screenshot({ path: join(out, record.name + '-failure.png') }).catch(() => {}); }
    finally { if (restore) await restore(); results.push(record); await context.close(); writeFileSync(join(out, record.name + '.json'), JSON.stringify(record, null, 2) + '\n'); console.log(record.name + ' ' + record.status); if (record.error) console.error(record.error); }
  }
  await browser.close();
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
