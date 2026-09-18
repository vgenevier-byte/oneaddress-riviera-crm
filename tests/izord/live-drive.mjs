/** Real HTTP requests to six actual Next API handlers; only Google is simulated. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { assertLocalTarget } from './local-target.mjs';

if (!process.env.LOCAL_STATUS_FILE || !process.env.LOCAL_FIXTURE_FILE) throw new Error('Private local status and fixture files required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const fixture = JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE, 'utf8'));
const app = 'http://127.0.0.1:3159';
assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app, mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.equal(fixture.api, status.API_URL); assert.equal(fixture.app, app);
const manifestFile = resolve(process.env.IZORD_APP_MANIFEST_FILE || join(dirname(process.env.LOCAL_STATUS_FILE), 'live-app.json'));
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
assert.equal(manifest.app, app); assert.equal(manifest.simulation, 'Google transport only');
const users = fixture.users, passed = [];
const trace = () => readFileSync(manifest.googleTraceFile, 'utf8').trim().split('\n').filter(Boolean).length;
const pass = name => { passed.push(name); console.log(`PASS ${name}`); };
const endpoints = ['diagnostic', 'folders', 'upload', 'file', 'delete', 'vendor-bank-accounts/upload'];
function requestSpec(endpoint, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let method = 'POST', path = endpoint, body;
  if (endpoint === 'diagnostic') method = 'GET';
  if (endpoint === 'file') { method = 'GET'; path += '?fileId=fixture-document'; }
  if (endpoint === 'folders' || endpoint === 'delete') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(endpoint === 'folders' ? { name: 'Dossier fictif API' } : { fileId: 'fixture-document' });
  }
  if (endpoint === 'upload' || endpoint === 'vendor-bank-accounts/upload') {
    body = new FormData();
    body.set('file', new Blob(['%PDF-1.4\nFICTIONAL LOCAL TEST DOCUMENT\n'], { type: 'application/pdf' }), 'fictional.pdf');
    if (endpoint === 'vendor-bank-accounts/upload') body.set('contactId', fixture.vendorContactId || 'fixture-vendor-api');
  }
  return { url: `${app}/api/drive/${path}`, options: { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20000) } };
}
async function run(endpoint, token, expected, name) {
  const before = trace(), spec = requestSpec(endpoint, token);
  const response = await fetch(spec.url, spec.options);
  assert.equal(response.status, expected, `${name}: ${endpoint} status ${response.status}, expected ${expected}`);
  if (expected === 401 || expected === 403) {
    const result = await response.json(); assert.equal(result.ok, false);
    assert.equal(trace(), before, `${name}: denied ${endpoint} must not reach Google fixture`);
  } else {
    assert.ok(trace() > before, `${name}: authorized ${endpoint} must reach simulated Google`);
    if (endpoint === 'file') {
      assert.equal(await response.text(), '%PDF-1.4\nFICTIONAL DRIVE DOCUMENT\n');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    } else {
      const result = await response.json();
      if (endpoint === 'vendor-bank-accounts/upload') {
        assert.equal(result.documentProvider, 'google-drive');
        assert.ok(result.driveFileId.startsWith('fixture-file-'));
        assert.ok(result.driveFolderId.startsWith('fixture-generated-'));
      } else if (endpoint === 'delete') {
        assert.equal(result.ok, false); assert.match(result.error, /Suppression Drive désactivée/);
      } else assert.equal(result.ok, true);
    }
  }
  pass(`${name}: ${endpoint} ${expected}`);
}
for (const endpoint of endpoints) await run(endpoint, null, 401, 'anonymous');
assert.ok(users.oar?.token && users.both?.token, 'OAR and double membership fixtures required');
const tokenParts = users.oar.token.split('.');
const originalPayload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
tokenParts[1] = Buffer.from(JSON.stringify({ ...originalPayload, sub: users.both.id })).toString('base64url');
for (const endpoint of endpoints) await run(endpoint, tokenParts.join('.'), 401, 'forged JWT');
for (const name of ['none', 'pending', 'invitee', 'admin', 'partner', 'a', 'b', 'reader', 'revoked', 'revoke_oar', 'revoke_admin']) {
  assert.ok(users[name]?.token, `${name} fixture required`);
  for (const endpoint of endpoints) await run(endpoint, users[name].token, 403, name);
}
for (const name of ['oar', 'both']) for (const endpoint of endpoints) await run(endpoint, users[name].token, endpoint === 'delete' ? 409 : 200, name);

// Revocation is an administrative write confined to the disposable local stack.
assert.ok(users.drive_revoke?.token, 'Dedicated OAR revocation fixture required');
await run('diagnostic', users.drive_revoke.token, 200, 'OAR before revocation');
const unchangedToken = users.drive_revoke.token;
const revoke = await fetch(`${status.API_URL}/rest/v1/app_memberships?user_id=eq.${encodeURIComponent(users.drive_revoke.id)}&workspace_id=eq.oar`, {
  method: 'PATCH', redirect: 'error',
  headers: { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
  body: JSON.stringify({ status: 'revoked' })
});
assert.ok(revoke.ok, 'Local OAR revocation must succeed');
const revoked = await revoke.json(); assert.equal(revoked.length, 1); assert.equal(revoked[0].status, 'revoked');
const stillValid = await fetch(`${status.API_URL}/auth/v1/user`, { headers: { apikey: status.ANON_KEY, authorization: `Bearer ${unchangedToken}` }, redirect: 'error' });
assert.equal(stillValid.status, 200, 'JWT must remain cryptographically valid after membership revocation');
for (const endpoint of endpoints) await run(endpoint, unchangedToken, 403, 'OAR revoked with unchanged valid JWT');
const result = { passed: passed.length, tests: passed, actualNextHTTP: true, actualLocalAuthAndMembership: true, actualGoogleCalls: false, googleTransportSimulated: true, authGuardSHA256: manifest.actualJWTAuthGuardSHA256 };
const output = resolve(process.env.IZORD_DRIVE_RESULTS_FILE || join(dirname(process.env.LOCAL_STATUS_FILE), 'drive-results.json'));
writeFileSync(output, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ passed: passed.length, actualNextHTTP: true, actualGoogleCalls: false }));
