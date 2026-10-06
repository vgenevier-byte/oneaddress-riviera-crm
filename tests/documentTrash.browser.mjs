/** Targeted UI fixture: Auth, REST and Drive are all simulated in the browser.
 * No real session, database, Google request or paid provider is used.
 * Run against an isolated app with its public Supabase URL at 127.0.0.1:3997.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.DOCUMENT_TRASH_URL;
assert.ok(origin && ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Isolated loopback app required');
const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'];
const folderOne = { id: 'trash-fixture-folder', title: 'Test 2 fictif', isFolder: true, driveFolderId: 'fixture-folder-one', driveParentFolderId: '', folderId: '', addedAt: '2026-01-01T00:00:00Z', status: 'À jour' };
const folderTwo = { ...folderOne, id: 'other-fixture-folder', title: 'Autre dossier fictif', driveFolderId: 'fixture-folder-two' };
const fileOne = { id: 'trash-fixture-file', title: 'Identique', fileName: 'Identique.pdf', driveFileId: 'fixture-drive-one', driveParentFolderId: folderOne.driveFolderId, folderId: folderOne.id, addedAt: '2026-01-01T00:00:00Z', status: 'À jour' };
const fileTwo = { ...fileOne, id: 'other-fixture-file', driveFileId: 'fixture-drive-two', driveParentFolderId: folderTwo.driveFolderId, folderId: folderTwo.id };
const initial = () => ({ ...Object.fromEntries(['contacts','leads','properties','vehicles','boats','tasks','suppliers','planningEntries','quotes','vendorQuotes','vendorInvoices','houseTrackingHouses','houseTrackingWorkers','houseTimeEntries','housePayments'].map(key => [key, []])), documents: [folderOne, folderTwo, fileOne, fileTwo] });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];

async function open(readonly = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' });
  const state = { payload: initial(), revision: '2026-10-06T00:00:00.000Z', calls: [], blocked: [], globalWrites: [], mode: 'success', release: null, canonicalOperationId: randomUUID() };
  const grants = Object.fromEntries(modules.map(module => [module, { level: readonly ? module === 'documents' ? 'read' : 'none' : 'contribute', sensitive: readonly ? { export: true } : { delete: true, export: true } }]));
  const access = { revision: 1, active: true, generalAdmin: !readonly, fullAccess: !readonly, modules: grants };
  // The existing full-access view has an email allowlist. This synthetic response
  // exercises that UI only; its JWT has no valid signature or real identity.
  const user = { id: readonly ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: readonly ? 'readonly-trash@example.invalid' : 'vg@oneaddressriviera.com', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp: 4102444800 })).toString('base64url'), 'synthetic-ui-fixture-signature'].join('.');
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (url.origin === 'http://127.0.0.1:3997') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (path === '/auth/v1/token') return respond({ access_token: token, refresh_token: 'synthetic-ui-refresh', token_type: 'bearer', expires_in: 31536000, user });
      if (path === '/auth/v1/user') return respond(user);
      if (path === '/auth/v1/logout') return respond({});
      if (path.endsWith('/rpc/crm_access_snapshot')) return respond(access);
      if (path === '/rest/v1/app_memberships') return respond([{ workspace_id: 'oar', role: 'member' }]);
      if (path === '/rest/v1/crm_workspace_state' && request.method() === 'GET') return respond({ payload: state.payload, updated_at: state.revision });
      if (path.endsWith('/rpc/crm_read_module')) return respond({ revision: state.revision, collections: { documents: [{ provider: 'google-drive', resource_id: fileOne.driveFileId, title: fileOne.title, module: 'documents', folder: folderOne.title, readonly: true, deletable: false }] } });
      if (path.endsWith('/rpc/crm_reference_options')) return respond({});
      state.globalWrites.push(request.method() + ' ' + path); return route.abort();
    }
    if (url.origin === origin && path === '/api/drive/delete') {
      const body = request.postDataJSON(); state.calls.push(body);
      if (state.mode === 'failure') { state.mode = 'success'; return respond({ error: 'Panne fictive : résultat non confirmé.' }, 503); }
      if (state.mode === 'pending') await new Promise(resolve => { state.release = resolve; });
      const target = state.payload.documents.find(doc => doc.id === body.documentId);
      assert.ok(target, 'Fixture request names an existing exact CRM row');
      assert.equal(body.fileId, target.driveFileId || target.driveFolderId);
      assert.equal(body.parentFolderId, target.folderId || '');
      assert.equal(body.parentDriveFolderId, target.driveParentFolderId || '');
      if (target.isFolder) assert.equal(state.payload.documents.filter(doc => doc.folderId === target.id).length, 0);
      state.payload = { ...state.payload, documents: state.payload.documents.filter(doc => doc.id !== target.id) };
      state.revision = new Date(Date.parse(state.revision) + 1000).toISOString();
      return respond({ completed: true, status: 'completed', operation_id: state.canonicalOperationId, record_id: body.documentId, resource_id: body.fileId, parent_record_id: body.parentFolderId, parent_resource_id: body.parentDriveFolderId, workspace_revision: state.revision, workspace_payload: state.payload });
    }
    if (url.origin === origin && !path.startsWith('/api/')) return route.continue();
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
    state.blocked.push(request.method() + ' ' + url.origin + path); return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/?module=documents');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('Synthetic-UI-only!');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator(readonly ? '.module-workspace' : '.documents-view').waitFor({ timeout: 90000 });
  if (!readonly) await page.getByRole('heading', { name: '2 dossiers · 2 documents', exact: true }).waitFor({ timeout: 90000 });
  return { context, page, state, errors };
}
async function confirm(page, button, accept = true) {
  const event = page.waitForEvent('dialog');
  const click = button.click();
  const dialog = await event, message = dialog.message();
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await click;
  return message;
}
function clean(fixture) {
  assert.deepEqual(fixture.state.blocked, [], 'No external or provider request');
  assert.deepEqual(fixture.state.globalWrites, [], 'Trash never writes a stale global payload');
  assert.deepEqual(fixture.errors, [], 'No browser runtime error');
}
try {
  const f = await open();
  try {
    const { page, state } = f;
    const folder = page.locator('#document-' + folderOne.id);
    await folder.getByRole('button', { name: 'Mettre à la corbeille', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Ce dossier contient encore des éléments' }).waitFor();
    assert.equal(state.calls.length, 0, 'Nonempty CRM folder has no trash request');
    await folder.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    const file = page.locator('#document-' + fileOne.id), trash = file.getByRole('button', { name: 'Mettre à la corbeille', exact: true });
    const canceled = await confirm(page, trash, false);
    assert.ok(canceled.includes('Identique.pdf') && canceled.includes(folderOne.title) && canceled.includes('30 jours'));
    assert.equal(state.calls.length, 0, 'Cancel sends no request');
    results.push('Empty-folder guard, exact named file/folder confirmation, 30-day warning and cancellation');

    state.mode = 'failure';
    await confirm(page, trash);
    await page.getByRole('status').filter({ hasText: 'Panne fictive' }).waitFor();
    const firstOperation = state.calls[0].operationId;
    assert.equal(await file.count(), 1, 'Failure keeps the CRM file');
    await page.reload();
    await page.getByRole('heading', { name: '2 dossiers · 2 documents', exact: true }).waitFor();
    await page.locator('#document-' + folderOne.id).getByRole('button', { name: 'Ouvrir', exact: true }).click();
    const draft = page.locator('.document-folder-form input');
    await draft.fill('Brouillon fictif conservé');
    state.mode = 'pending';
    await confirm(page, page.locator('#document-' + fileOne.id).getByRole('button', { name: 'Mettre à la corbeille', exact: true }));
    await page.waitForFunction(() => document.querySelector('#document-trash-fixture-file button.danger-link')?.disabled === true);
    assert.equal(state.calls[1].operationId, firstOperation, 'Reload retains the same operation identifier');
    assert.equal(await page.locator('#document-' + fileOne.id).count(), 1, 'No optimistic removal while completion is pending');
    assert.equal(await page.getByText('Fichier mis à la corbeille.', { exact: true }).count(), 0, 'No success before completion');
    await page.locator('#document-' + fileOne.id + ' button.danger-link').evaluate(button => button.click());
    assert.equal(state.calls.length, 2, 'Double click cannot issue another request');
    while (!state.release) await new Promise(resolve => setTimeout(resolve, 10));
    state.release();
    await page.locator('#document-' + fileOne.id).waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '2 dossiers · 1 document', exact: true }).waitFor();
    assert.equal(await draft.inputValue(), 'Brouillon fictif conservé', 'Unrelated form draft survives confirmed trash');
    assert.ok(state.payload.documents.some(doc => doc.id === fileTwo.id), 'The homonym in another folder remains intact');
    await draft.fill('');
    results.push('Failure/reload/retry keeps one operation; pending success gate, double-click guard, exact homonym and draft preservation');

    await page.reload();
    await page.getByRole('heading', { name: '2 dossiers · 1 document', exact: true }).waitFor();
    const emptyFolder = page.locator('#document-' + folderOne.id);
    state.mode = 'success';
    const folderMessage = await confirm(page, emptyFolder.getByRole('button', { name: 'Mettre à la corbeille', exact: true }));
    assert.ok(folderMessage.includes(folderOne.title) && folderMessage.includes('CRM Documents') && folderMessage.includes('sous-dossiers'));
    await emptyFolder.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '1 dossier · 1 document', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '1 dossier · 1 document', exact: true }).waitFor();
    assert.equal(await page.locator('#document-' + folderOne.id).count(), 0);
    await page.locator('#document-' + folderTwo.id).getByRole('button', { name: 'Ouvrir', exact: true }).click();
    assert.equal(await page.locator('#document-' + fileTwo.id).count(), 1);
    results.push('Confirmed file then empty-folder removal persists and recalculates counters after reload');
    clean(f);
  } finally { await f.context.close(); }
  const readonly = await open(true);
  try {
    await readonly.page.getByRole('heading', { name: 'Documents autorisés', exact: true }).waitFor();
    assert.equal(await readonly.page.getByRole('button', { name: /Mettre à la corbeille|Supprimer/ }).count(), 0);
    assert.equal(readonly.state.calls.length, 0);
    clean(readonly);
    results.push('Read-only shared document and missing Suppression show no trash control');
  } finally { await readonly.context.close(); }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed: true, simulatedAuth: true, simulatedREST: true, simulatedDrive: true, realProductionAuthentication: false, realGoogleDriveOperation: false, results }, null, 2));
