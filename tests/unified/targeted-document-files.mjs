/** Read-only checks against real disposable Auth/RPC and an isolated application.
 * Only Google transport is simulated in the app; no production session is used.
 * Run after targeted-document-sharing.mjs restores its eight explicit shares.
 * Required: LOCAL_STATUS_FILE, DOCUMENTS_FIXTURE_FILE, DOCUMENTS_APP_MANIFEST_FILE.
 * Optional: DOCUMENTS_API_RESULTS_FILE, a private local output file.
 */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {assertLocalTarget} from '../izord/local-target.mjs';

for (const name of ['LOCAL_STATUS_FILE', 'DOCUMENTS_FIXTURE_FILE', 'DOCUMENTS_APP_MANIFEST_FILE']) {
  assert.ok(process.env[name], name + ' is required');
}
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.DOCUMENTS_FIXTURE_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(process.env.DOCUMENTS_APP_MANIFEST_FILE, 'utf8'));
assertLocalTarget({api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159',
  mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK});
assert.equal(manifest.app, 'http://127.0.0.1:3160');
assert.equal(manifest.status, 'ready');
assert.equal(new URL(fixture.api).origin, 'http://127.0.0.1:55431');
assert.equal(fixture.documents.length, 8);
assert.ok(Object.values(fixture.users).every(user => user.email.endsWith('@example.invalid')), 'Fictitious local identities only');
const results = [];

async function request(path, user, method = 'GET') {
  return fetch(manifest.app + '/api/drive/' + path, {method,
    headers: user ? {Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json'} : {},
    ...(method === 'POST' ? {body: '{}'} : {}), redirect: 'error'});
}
async function denied(path, user, method = 'GET', expected = 403) {
  const before = readFileSync(manifest.googleTraceFile, 'utf8');
  const response = await request(path, user, method);
  assert.equal(response.status, expected, path + ' ' + await response.text());
  assert.equal(readFileSync(manifest.googleTraceFile, 'utf8'), before, 'No simulated Google request on denial');
}

await denied('file?fileId=fixture-general-drive-1', null, 'GET', 401);
results.push('Anonymous resource request returns 401 before simulated Google');
for (const [index, document] of fixture.documents.entries()) {
  for (const download of [false, true]) {
    const response = await request('file?fileId=' + encodeURIComponent(document.driveFileId) +
      (download ? '&download=1' : ''), fixture.users.clement);
    assert.equal(response.status, 200, 'Explicit shared resource ' + document.driveFileId);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('location'), null);
    assert.match(response.headers.get('content-disposition'), download ? /^attachment;/ : /^inline;/);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (index < 5) {
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } else if (index === 6) {
      assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    } else {
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    }
  }
}
results.push('All eight files: current local Auth, server RPC and simulated Google bytes, inline and attachment');
for (const id of ['fixture-unshared-drive', 'fixture-protected-drive', 'fixture-bank-drive',
  'fixture-marketing-folder', 'fixture-window-folder', 'fixture-future-drive']) {
  for (const download of [false, true]) {
    await denied('file?fileId=' + id + (download ? '&download=1' : ''), fixture.users.clement);
  }
}
for (const document of fixture.documents) await denied('file?fileId=' + document.driveFileId, fixture.users.other);
results.push('Unshared same-title, business, bank, folder, future-file and other-collaborator requests denied before Google');
for (const [path, method] of [['diagnostic', 'GET'], ['folders', 'POST'], ['upload', 'POST'],
  ['delete', 'POST'], ['vendor-bank-accounts/upload', 'POST']]) await denied(path, fixture.users.clement, method);
results.push('Global Drive inventory, upload, folder creation, deletion and banking upload remain denied');
for (const document of fixture.documents) {
  assert.equal((await request('file?fileId=' + document.driveFileId + '&download=1', fixture.users.owner)).status, 200);
}
results.push('Owner retains access to all eight files through the existing global authorization');
for (let reload = 0; reload < 2; reload++) {
  const response = await fetch(new URL('/rest/v1/rpc/crm_read_module', fixture.api), {method: 'POST',
    headers: {apikey: status.ANON_KEY, Authorization: 'Bearer ' + fixture.users.clement.token, 'Content-Type': 'application/json'},
    body: JSON.stringify({p_module: 'documents'}), redirect: 'error'});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.collections.documents.map(document => document.resource_id).sort(),
    fixture.documents.map(document => document.driveFileId).sort());
}
results.push('Eight-document RPC projection persists across fresh requests');
const result = {passed: true, actualAuth: 'disposable local Supabase Auth and RPC',
  googleTransport: 'simulated', realClementVerified: false, realGoogleDownloadVerified: false, results};
if (process.env.DOCUMENTS_API_RESULTS_FILE) {
  writeFileSync(process.env.DOCUMENTS_API_RESULTS_FILE, JSON.stringify(result, null, 2), {mode: 0o600});
}
console.log(JSON.stringify(result, null, 2));
