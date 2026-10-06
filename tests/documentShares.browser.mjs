/** Real fictitious local Auth/RPC/browser checks. Only Google transport is simulated.
 * Requires the disposable fixture from targeted-document-sharing.mjs and its
 * isolated source-identical application. Never accepts a production target.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLocalTarget } from './izord/local-target.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.ok(process.env.LOCAL_STATUS_FILE && process.env.DOCUMENTS_FIXTURE_FILE && process.env.DOCUMENTS_APP_MANIFEST && process.env.DOCUMENTS_TEST_OUTPUT, 'Private local fixture paths are required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.DOCUMENTS_FIXTURE_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(process.env.DOCUMENTS_APP_MANIFEST, 'utf8'));
assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.equal(fixture.app, 'http://127.0.0.1:3160');
assert.equal(manifest.app, fixture.app);
assert.equal(manifest.status, 'ready');
for (const source of manifest.sourceFiles) assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'), source.sha256, 'Isolated app uses the actual source: ' + source.path);
for (const user of Object.values(fixture.users)) assert.ok(user.email.endsWith('@example.invalid'), 'Only fictitious local identities allowed');
assert.equal(fixture.documents.length, 8);
const api = new URL(status.API_URL).origin, origin = fixture.app, directory = process.env.DOCUMENTS_TEST_OUTPUT;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const sql = new Client({ connectionString: status.DB_URL });
await sql.connect();
assert.equal((await sql.query("select count(*)::int n from auth.users where email not like '%@example.invalid'")).rows[0].n, 0);
const clement = fixture.users.clement, owner = fixture.users.owner;
const profileBefore = (await sql.query('select active,revision from crm_access_profiles where user_id=$1', [clement.id])).rows[0];
const grantBefore = (await sql.query("select level,sensitive from crm_module_grants where user_id=$1 and module='documents'", [clement.id])).rows[0];
const payloadBefore = (await sql.query("select payload from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const sharesBefore = (await sql.query('select provider,resource_id,user_id,revoked_at from crm_document_shares where user_id=$1 order by resource_id', [clement.id])).rows;
const first = fixture.documents[0];
const results = [], downloads = [], browser = await chromium.launch({ headless: true, channel: 'chrome' });
let shareRevoked = false;

async function rpc(name, user, args) {
  const response = await fetch(api + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  assert.ok([200, 204].includes(response.status), name + ': ' + await response.text());
}
async function bump() { await sql.query('update crm_access_profiles set revision=revision+1 where user_id=$1', [clement.id]); }
async function open(user) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const audit = { blocked: [], writes: [], reads: [], files: [] }, errors = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const local = [origin, api].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol);
    if (!local) { audit.blocked.push(url.origin + url.pathname); return route.abort(); }
    if (url.pathname.startsWith('/rest/v1/')) {
      audit.reads.push(url.pathname);
      if (request.method() !== 'GET' && !['/rest/v1/rpc/crm_access_snapshot', '/rest/v1/rpc/crm_read_module', '/rest/v1/rpc/crm_reference_options'].includes(url.pathname)) { audit.writes.push(url.pathname); return route.abort(); }
    }
    if (url.pathname === '/api/drive/file') audit.files.push({ id: url.searchParams.get('fileId'), download: url.searchParams.get('download') === '1' });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/?module=documents');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('heading', { name: 'Documents autorisés', exact: true }).waitFor({ timeout: 30000 });
  return { context, page, cards: page.locator('.module-workspace article'), audit, errors };
}
async function checkClean(f) {
  assert.deepEqual(f.audit.writes, [], 'The browser sends no business/metadata mutation');
  assert.deepEqual(f.audit.blocked, [], 'The browser never requests a remote target');
  assert.deepEqual(f.errors, [], 'No browser runtime errors');
  assert.ok(!f.audit.reads.includes('/rest/v1/crm_workspace_state'), 'Restricted account never requests global payload');
}

try {
  const f = await open(clement);
  try {
    await f.cards.last().waitFor();
    assert.equal(await f.cards.count(), 8);
    const nav = f.page.getByRole('navigation', { name: 'Navigation principale', exact: true });
    assert.equal(await nav.getByRole('button', { name: 'Documents', exact: true }).count(), 1);
    assert.equal(await nav.getByRole('button', { name: /Contacts|Factures prestataires|Administration/ }).count(), 0);
    assert.equal(await f.cards.getByRole('button', { name: /Supprimer|Renommer/ }).count(), 0);
    assert.equal(await f.cards.locator('input[type=file]').count(), 0);
    assert.equal(await f.page.locator('a[href*="drive.google.com"],a[href*="office.com"]').count(), 0);
    assert.deepEqual((await f.page.locator('.module-workspace section.card > label').filter({ hasText: /^Dossier/ }).locator('select option').allTextContents()).sort(), ['Tous les dossiers autorisés', 'Marketing fictif', 'Devis vitre fictif'].sort());
    await f.page.locator('.module-workspace section.card > label').filter({ hasText: /^Dossier/ }).locator('select').selectOption('Marketing fictif');
    assert.equal(await f.cards.count(), 7);
    await f.page.locator('.module-workspace section.card > label').filter({ hasText: /^Dossier/ }).locator('select').selectOption('Devis vitre fictif');
    assert.equal(await f.cards.count(), 1);
    await f.page.locator('.module-workspace section.card > label').filter({ hasText: /^Dossier/ }).locator('select').selectOption('');
    await f.page.screenshot({ path: join(directory, 'shared-files.png'), fullPage: true });
    results.push('Eight explicitly shared files and two folders; no foreign module or mutation controls');

    for (const doc of fixture.documents) {
      const card = f.cards.filter({ has: f.page.getByRole('heading', { name: doc.title, exact: true }) });
      await card.getByRole('button', { name: 'Voir', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: doc.title, exact: true });
      await dialog.waitFor();
      assert.deepEqual(f.audit.files.at(-1), { id: doc.driveFileId, download: false });
      if (doc.fileName.endsWith('.docx')) {
        assert.equal(await dialog.locator('iframe').count(), 0);
        assert.ok((await dialog.innerText()).includes('Téléchargez le fichier pour le consulter dans votre application.'));
      } else {
        assert.ok((await dialog.locator('iframe').getAttribute('src')).startsWith('blob:'));
        assert.equal(await dialog.locator('iframe').getAttribute('sandbox'), 'allow-same-origin');
      }
      const event = f.page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Télécharger', exact: true }).click();
      const download = await event, extension = doc.fileName.split('.').at(-1), file = join(directory, 'fictitious-' + doc.id + '.' + extension);
      assert.ok(download.suggestedFilename().endsWith('.' + extension), 'The downloaded file retains a usable extension');
      await download.saveAs(file);
      const bytes = readFileSync(file);
      assert.ok(bytes.length > 20);
      if (extension === 'png') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      else if (extension === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      else assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      const comparison = await fetch(origin + '/api/drive/file?fileId=' + encodeURIComponent(doc.driveFileId) + '&download=1', { headers: { Authorization: 'Bearer ' + clement.token } });
      assert.equal(comparison.status, 200);
      assert.deepEqual(bytes, Buffer.from(await comparison.arrayBuffer()), 'Browser download preserves exact fixture bytes');
      downloads.push({ resource: doc.driveFileId, extension, size: bytes.length });
      await f.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    results.push('All eight download through actual JWT-checked application routes; PNG/PDF preview and explicit DOCX fallback');

    await sql.query("update crm_module_grants set sensitive=sensitive-'export' where user_id=$1 and module='documents'", [clement.id]);
    await bump();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByRole('button', { name: 'Télécharger', exact: true }).first().waitFor({ state: 'hidden' });
    await f.page.getByRole('heading', { name: 'Documents autorisés', exact: true }).waitFor();
    await f.cards.first().getByRole('button', { name: 'Voir', exact: true }).click();
    const preview = f.page.getByRole('dialog');
    await preview.waitFor();
    assert.equal(await preview.getByRole('button', { name: 'Télécharger', exact: true }).count(), 0);
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    const refused = await fetch(origin + '/api/drive/file?fileId=' + first.driveFileId + '&download=1', { headers: { Authorization: 'Bearer ' + clement.token } });
    assert.equal(refused.status, 403);
    await refused.arrayBuffer();
    await sql.query("update crm_module_grants set sensitive=$2 where user_id=$1 and module='documents'", [clement.id, grantBefore.sensitive]);
    await bump();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.cards.getByRole('button', { name: 'Télécharger', exact: true }).first().waitFor();
    results.push('Export removal blocks application download on the existing token and preserves consultation');

    await rpc('crm_revoke_document_share', owner, { p_provider: 'google-drive', p_resource: first.driveFileId, p_user: clement.id });
    shareRevoked = true;
    await f.page.reload();
    await f.page.getByRole('heading', { name: 'Documents autorisés', exact: true }).waitFor();
    await f.cards.last().waitFor();
    assert.equal(await f.cards.count(), 7);
    assert.equal(await f.cards.getByRole('heading', { name: first.title, exact: true }).count(), 0);
    await rpc('crm_share_general_document', owner, { p_provider: 'google-drive', p_resource: first.driveFileId, p_record: first.id, p_user: clement.id });
    shareRevoked = false;
    await sql.query("update crm_module_grants set level='none' where user_id=$1 and module='documents'", [clement.id]);
    await bump();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
    assert.equal(await f.page.locator('.module-workspace article').count(), 0);
    await sql.query("update crm_module_grants set level=$2 where user_id=$1 and module='documents'", [clement.id, grantBefore.level]);
    await bump();
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByRole('heading', { name: 'Documents autorisés', exact: true }).waitFor();
    await f.cards.last().waitFor();
    assert.equal(await f.cards.count(), 8);
    await sql.query('update crm_access_profiles set active=false,revision=revision+1 where user_id=$1', [clement.id]);
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByRole('heading', { name: 'Aucun accès autorisé', exact: true }).waitFor();
    assert.equal(await f.page.locator('.module-workspace article').count(), 0);
    results.push('Share revocation persists after reload; removing Documents or deactivating the profile clears all documents');
    await checkClean(f);
  } finally { await f.context.close(); }

  const other = await open(fixture.users.other);
  try { assert.equal(await other.cards.count(), 0); await checkClean(other); results.push('Another Documents contributor receives zero shared general files'); }
  finally { await other.context.close(); }
  const business = await open(fixture.users.business);
  try {
    await business.cards.last().waitFor();
    const owned = business.cards.filter({ hasText: 'Métier fictif' });
    assert.equal(await owned.getByRole('button', { name: 'Renommer / classer', exact: true }).count(), 1);
    assert.equal(await owned.getByRole('button', { name: 'Télécharger', exact: true }).count(), 1);
    assert.equal(await business.cards.filter({ hasText: 'Document partagé fictif' }).count(), 0);
    await checkClean(business);
    results.push('Existing business document consultation/download/edit controls remain available under their current rights');
  } finally { await business.context.close(); }
} finally {
  await browser.close();
  await sql.query('update crm_access_profiles set active=$2,revision=$3 where user_id=$1', [clement.id, profileBefore.active, profileBefore.revision]);
  await sql.query("update crm_module_grants set level=$2,sensitive=$3 where user_id=$1 and module='documents'", [clement.id, grantBefore.level, grantBefore.sensitive]);
  if (shareRevoked) await rpc('crm_share_general_document', owner, { p_provider: 'google-drive', p_resource: first.driveFileId, p_record: first.id, p_user: clement.id });
  assert.deepEqual((await sql.query('select active,revision from crm_access_profiles where user_id=$1', [clement.id])).rows[0], profileBefore, 'The original active profile and revision are restored');
  assert.deepEqual((await sql.query("select level,sensitive from crm_module_grants where user_id=$1 and module='documents'", [clement.id])).rows[0], grantBefore, 'The original Documents grant is restored');
  assert.deepEqual((await sql.query("select payload from crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload, payloadBefore, 'No business payload changes');
  assert.deepEqual((await sql.query('select provider,resource_id,user_id,revoked_at from crm_document_shares where user_id=$1 order by resource_id', [clement.id])).rows, sharesBefore, 'All eight shares are restored');
  await sql.end();
}
writeFileSync(join(directory, 'browser-results.json'), JSON.stringify({ passed: true, realLocalAuth: true, realLocalRPC: true, realLocalApplicationDownloads: true, googleTransportSimulated: true, realClementVerified: false, realGoogleDownloadVerified: false, businessPayloadPreserved: true, profileAndGrantRestored: true, downloads, results }, null, 2), { mode: 0o600 });
console.log('PASS targeted shared-documents browser: ' + results.length + ' checks, eight actual local fixture downloads');
