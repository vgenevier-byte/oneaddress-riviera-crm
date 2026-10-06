/** Actual disposable local Auth + CRM RPC/store/route; Google is an in-memory fixture. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {assertLocalTarget} from '../izord/local-target.mjs';
import {createDeleteDriveHandler} from '../../app/api/drive/delete/handler.ts';
import {createDriveFileHandler} from '../../app/api/drive/file/handler.ts';

const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
assertLocalTarget({api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159',
  mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK});
const saved = JSON.parse(readFileSync('/private/tmp/oar-targeted-docs-fixture.private.json', 'utf8'));
const origin = new URL(status.API_URL).origin;
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  LOCAL_AUTH_INVITE_KEY: status.SERVICE_ROLE_KEY,
  GOOGLE_DRIVE_SHARED_DRIVE_ID: 'fixture-trash-shared-drive',
  GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: 'fixture-trash-documents-root',
  GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: 'fixture-trash-business-root'
});
const nativeFetch = globalThis.fetch;
const transport = {losePatch: false, failComplete: false, patchCalls: [], googleCalls: [], rpcCalls: [], concurrent: false,
  revokeDeleteBeforeComplete: null, revokeSessionBeforeComplete: null};
// No application fetch can leave the disposable loopback Supabase API.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, origin, 'No external network calls permitted');
  if (url.pathname.startsWith('/rest/v1/rpc/')) transport.rpcCalls.push(url.pathname.split('/').at(-1));
  if (url.pathname === '/rest/v1/rpc/crm_document_trash_complete' && transport.revokeDeleteBeforeComplete) {
    const actor = transport.revokeDeleteBeforeComplete; transport.revokeDeleteBeforeComplete = null;
    await sql.query("update public.crm_module_grants set sensitive=jsonb_set(sensitive,'{delete}','false'::jsonb) where user_id=$1 and module='documents'", [actor]);
  }
  if (url.pathname === '/rest/v1/rpc/crm_document_trash_complete' && transport.revokeSessionBeforeComplete) {
    const session = transport.revokeSessionBeforeComplete; transport.revokeSessionBeforeComplete = null;
    await sql.query('delete from auth.sessions where id=$1', [session]);
  }
  if (url.pathname === '/rest/v1/rpc/crm_document_trash_complete' && transport.failComplete) {
    transport.failComplete = false;
    return Response.json({code: 'XX000', message: 'Fictional one-shot finalization failure'}, {status: 500});
  }
  return nativeFetch(input, init);
};
const sql = new Client({connectionString: status.DB_URL});
const run = randomUUID().slice(0, 8);
const root = process.env.GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID;
const drive = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;
const folderMime = 'application/vnd.google-apps.folder';
const folder = {id: `fixture-api-folder-${run}`, title: 'Dossier API fictif', isFolder: true,
  driveFolderId: `fixture-api-folder-drive-${run}`, driveParentFolderId: root};
const file = {id: `fixture-api-file-${run}`, title: 'Fichier API fictif.pdf', isFolder: false,
  driveFileId: `fixture-api-file-drive-${run}`, folderId: folder.id, driveParentFolderId: folder.driveFolderId,
  addedAt: '2026-10-06T00:00:00.000Z', addedBy: 'Test local fictif', category: 'Documents', status: 'À jour'};
const resources = new Map([
  [root, {id: root, name: 'Documents API fictifs', mimeType: folderMime, parents: [drive], driveId: drive}],
  [folder.driveFolderId, {id: folder.driveFolderId, name: folder.title, mimeType: folderMime, parents: [root], driveId: drive,
    trashed: false, explicitlyTrashed: false, capabilities: {canTrash: true}}],
  [file.driveFileId, {id: file.driveFileId, name: file.title, mimeType: 'application/pdf', parents: [folder.driveFolderId], driveId: drive,
    trashed: false, explicitlyTrashed: false, capabilities: {canTrash: true}}]
]);
const operations = [randomUUID(), randomUUID()];
const payload = async () => (await sql.query("select payload,updated_at::text as revision from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
const revision = async () => (await payload()).revision;
const originals = async () => (await sql.query("select to_jsonb(s) row from public.crm_document_shares s where s.resource_id=any($1::text[]) order by s.provider,s.resource_id,s.user_id", [saved.documents.map(d => d.driveFileId)])).rows.map(r => r.row);
const journals = async () => (await sql.query('select status,record_id,resource_id,snapshot from app_private.document_drive_trash where operation_id=any($1::uuid[]) order by record_id', [operations])).rows;
async function request(path, token, body) {
  const response = await fetch(origin + path, {method: body === undefined ? 'GET' : 'POST',
    headers: {apikey: status.ANON_KEY, ...(token ? {authorization: 'Bearer ' + token} : {}),
      ...(body === undefined ? {} : {'content-type': 'application/json'})},
    body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.ok([200,204].includes(response.status), `Local API failed: ${JSON.stringify(data)}`);
  return data;
}
async function login(user) {
  assert.ok(user.email.endsWith('@example.invalid'));
  const result = await request('/auth/v1/token?grant_type=password', null, {email: user.email, password: user.password});
  assert.equal((await request('/auth/v1/user', result.access_token)).id, user.id);
  return {id: user.id, token: result.access_token};
}
const rpc = (name, user, args) => request('/rest/v1/rpc/' + name, user.token, args);
const createFetchDrive = () => async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'www.googleapis.com');
  const method = init.method || 'GET';
  assert.ok(['GET','PATCH'].includes(method));
  const id = decodeURIComponent(url.pathname.split('/').at(-1));
  transport.googleCalls.push({method, id});
  if (id === 'files') {
    const parent = url.searchParams.get('q').match(/^'([^']+)' in parents/)[1];
    return Response.json({files: Array.from(resources.values()).filter(r => r.parents.includes(parent) && !r.trashed)});
  }
  const row = resources.get(id);
  assert.ok(row, 'Only the fictional API resources may be touched');
  if (method === 'PATCH') {
    assert.deepEqual(JSON.parse(init.body), {trashed: true});
    transport.patchCalls.push(id);
    row.trashed = true; row.explicitlyTrashed = true;
    if (transport.concurrent) {
      transport.concurrent = false;
      await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{fixtureTrashConcurrent}',to_jsonb($1::text),true) where workspace_id='oneaddress-riviera'", ['Concurrent local change preserved']);
    }
    if (transport.losePatch) { transport.losePatch = false; throw new Error('Fictional lost Drive PATCH response'); }
    return Response.json({id, trashed: true, explicitlyTrashed: true});
  }
  if (url.searchParams.get('alt') === 'media') return new Response('Fictional test bytes only');
  return Response.json(row);
};
const trash = createDeleteDriveHandler({createFetchDrive});
const bytes = createDriveFileHandler({createFetchDrive});
const target = (row, operationId, rev) => ({operationId, documentId: row.id, fileId: row.isFolder ? row.driveFolderId : row.driveFileId,
  parentFolderId: row.folderId || '', parentDriveFolderId: row.driveParentFolderId || '', revision: rev});
const trashRequest = (user, input) => new Request('http://localhost/api/drive/delete', {
  method: 'POST', headers: {'authorization': 'Bearer ' + user.token, 'content-type': 'application/json'}, body: JSON.stringify(input)
});
const bytesRequest = user => new Request('http://localhost/api/drive/file?fileId=' + file.driveFileId,
  {headers: {authorization: 'Bearer ' + user.token}});
let before, retainedShares, ownerId, ownerDocumentSensitive;
await sql.connect();
try {
  assert.equal((await sql.query("select count(*)::int n from auth.users where email not like '%@example.invalid'")).rows[0].n, 0);
  assert.ok((await sql.query("select to_regclass('app_private.document_drive_trash') name")).rows[0].name, 'Apply the additive migration to the local stack first');
  let owner = await login(saved.users.owner);
  ownerId = owner.id;
  ownerDocumentSensitive = (await sql.query("select sensitive from public.crm_module_grants where user_id=$1 and module='documents'", [owner.id])).rows[0].sensitive;
  const clement = await login(saved.users.clement);
  before = await payload(); retainedShares = await originals();
  assert.equal(retainedShares.length, 8, 'The retained eight local shares must already exist');
  await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{documents}',coalesce(payload->'documents','[]'::jsonb)||$1::jsonb) where workspace_id='oneaddress-riviera'", [JSON.stringify([folder,file])]);
  await rpc('crm_share_general_document', owner, {p_provider: 'google-drive', p_resource: file.driveFileId, p_record: file.id, p_user: clement.id});
  assert.equal((await bytes(bytesRequest(clement))).status, 200);
  const initialVisible = await rpc('crm_read_module', clement, {p_module: 'documents'});
  assert.equal(initialVisible.collections.documents.length, 9);
  const fileInput = target(file, operations[0], await revision());
  const denied = await trash(trashRequest(clement, fileInput));
  assert.equal(denied.status, 403);
  assert.equal(transport.patchCalls.length, 0);
  const folderRefusal = await trash(trashRequest(owner, target(folder, operations[1], await revision())));
  assert.equal(folderRefusal.status, 409);
  assert.match((await folderRefusal.json()).error, /CRM/);
  assert.deepEqual(await journals(), []);

  transport.losePatch = true; transport.concurrent = true;
  const lost = await trash(trashRequest(owner, fileInput));
  assert.equal(lost.status, 500);
  assert.equal((await lost.json()).ok, false);
  assert.equal((await journals())[0].status, 'pending');
  assert.ok((await payload()).payload.documents.some(d => d.id === file.id));
  assert.equal((await bytes(bytesRequest(owner))).status, 403);
  assert.equal((await bytes(bytesRequest(clement))).status, 403);
  assert.equal((await rpc('crm_read_module', clement, {p_module: 'documents'})).collections.documents.length, 8);

  // A new local tab may propose a new ID; the durable exact operation is canonical.
  transport.revokeDeleteBeforeComplete = owner.id;
  const rightsRevoked = await trash(trashRequest(owner, {...fileInput, operationId: randomUUID()}));
  assert.equal(rightsRevoked.status, 403);
  const deniedResult = await rightsRevoked.json();
  assert.equal(deniedResult.ok, false);
  assert.equal('workspace_payload' in deniedResult, false, 'Rights revoked during Drive operation never expose the global CRM payload');
  assert.equal((await journals())[0].status, 'completed', 'Privileged finalization still preserves the confirmed Drive state');
  await sql.query("update public.crm_module_grants set sensitive=$2 where user_id=$1 and module='documents'", [owner.id, ownerDocumentSensitive]);
  const resumed = await trash(trashRequest(owner, {...fileInput, operationId: randomUUID()}));
  assert.equal(resumed.status, 200);
  const result = await resumed.json();
  assert.equal(result.operation_id, operations[0]);
  assert.equal(result.status, 'completed');
  assert.equal(result.workspace_payload.fixtureTrashConcurrent, 'Concurrent local change preserved');
  assert.ok(!result.workspace_payload.documents.some(d => d.id === file.id));
  assert.deepEqual(transport.patchCalls, [file.driveFileId]);
  assert.equal((await journals())[0].snapshot.driveFileId, file.driveFileId);
  assert.equal((await bytes(bytesRequest(clement))).status, 403);

  const folderInput = target(folder, operations[1], await revision());
  transport.failComplete = true;
  const partial = await trash(trashRequest(owner, folderInput));
  assert.equal(partial.status, 503);
  assert.equal((await partial.json()).ok, false);
  assert.ok((await payload()).payload.documents.some(d => d.id === folder.id));
  transport.revokeSessionBeforeComplete = JSON.parse(Buffer.from(owner.token.split('.')[1], 'base64url')).session_id;
  const sessionRevoked = await trash(trashRequest(owner, folderInput));
  assert.ok([401,403].includes(sessionRevoked.status));
  const expiredResult = await sessionRevoked.json();
  assert.equal(expiredResult.ok, false);
  assert.equal('workspace_payload' in expiredResult, false, 'Revoked Auth session never receives the completed global payload');
  assert.ok((await journals()).every(journal => journal.status === 'completed'));
  owner = await login(saved.users.owner);
  const finalFolder = await trash(trashRequest(owner, folderInput));
  assert.equal(finalFolder.status, 200);
  assert.equal((await finalFolder.json()).status, 'completed');
  assert.deepEqual(transport.patchCalls, [file.driveFileId, folder.driveFolderId]);
  const after = (await payload()).payload;
  assert.ok(!after.documents.some(d => [file.id,folder.id].includes(d.id)));
  assert.deepEqual(after.documents, before.payload.documents, 'Counters and active records persist after reloading actual SQL state');
  assert.deepEqual(await originals(), retainedShares);
  assert.equal((await rpc('crm_read_module', clement, {p_module: 'documents'})).collections.documents.length, 8);
  assert.equal((await trash(trashRequest(owner, fileInput))).status, 200);
  assert.equal(transport.patchCalls.length, 2);
  assert.ok(transport.rpcCalls.includes('crm_document_trash_begin'));
  assert.ok(transport.rpcCalls.includes('crm_document_trash_complete'));
  console.log('PASS actual local Auth + exact CRM RPC/store + Drive fixture: file/folder, read-only refusal, lost PATCH/finalize retries, mid-operation Delete/session revocation, reload counters, concurrency, eight retained shares');
} finally {
  if (ownerId && ownerDocumentSensitive) await sql.query("update public.crm_module_grants set sensitive=$2 where user_id=$1 and module='documents'", [ownerId, ownerDocumentSensitive]);
  if (before) {
    await sql.query('delete from app_private.document_drive_trash where operation_id=any($1::uuid[])', [operations]);
    await sql.query("delete from public.crm_document_shares where provider='google-drive' and resource_id=$1", [file.driveFileId]);
    await sql.query("delete from public.crm_document_scopes where provider='google-drive' and resource_id=$1", [file.driveFileId]);
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [before.payload]);
    assert.deepEqual((await payload()).payload, before.payload);
    if (retainedShares) assert.deepEqual(await originals(), retainedShares);
  }
  await sql.end(); globalThis.fetch = nativeFetch;
}
