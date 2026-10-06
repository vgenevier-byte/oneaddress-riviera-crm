/** Real disposable local Auth/RPC/Storage checks; Google transport is simulated separately. */
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {Client} from 'pg';
import {assertLocalTarget} from '../izord/local-target.mjs';

const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
assertLocalTarget({api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159',
  mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK});
const migrationNames = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('_targeted_document_sharing.sql'));
assert.equal(migrationNames.length, 1, 'Exactly one targeted sharing migration required');
const migrationURL = new URL('../../supabase/migrations/' + migrationNames[0], import.meta.url);
const sql = new Client({connectionString: status.DB_URL});
const fixturePath = '/private/tmp/oar-targeted-docs-fixture.private.json';
const reuseFixture = process.argv.includes('--reuse-fixture') ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
const run = reuseFixture?.run ?? reuseFixture?.users.clement.email.match(/targeted-docs-clement-(.+)@example.invalid/)[1] ?? randomUUID();
const api = new URL(status.API_URL).origin;
const results = [];
const modules = ['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices',
  'houseTracking','documents','planning','properties','vehicles','boats','izord'];
const ownerGrants = Object.fromEntries(modules.map(module => [module, {level: 'contribute', sensitive: {
  delete: true, export: true, ...(module === 'contacts' ? {bank_read: true, bank_write: true} : {}),
  ...(module === 'vendorInvoices' ? {payment: true} : {})}}]));
const documentGrants = {documents: {level: 'contribute', sensitive: {export: true}}};
const users = reuseFixture?.users ?? {};

async function request(path, token, body, method) {
  const response = await fetch(api + path, {method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {apikey: status.ANON_KEY, ...(token ? {Authorization: 'Bearer ' + token} : {}),
      ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {status: response.status, data};
}
const rpc = (name, user, args = {}) => request('/rest/v1/rpc/' + name, user?.token, args);
function ok(response) { assert.ok([200,204].includes(response.status), JSON.stringify(response)); return response.data; }
function denied(response) { assert.ok(response.status >= 400, JSON.stringify(response)); }
async function createUser(name) {
  const email = `targeted-docs-${name}-${run}@example.invalid`, password = randomBytes(24).toString('hex');
  const created = ok(await request('/auth/v1/admin/users', status.SERVICE_ROLE_KEY, {email, password, email_confirm: true}));
  const session = ok(await request('/auth/v1/token?grant_type=password', null, {email, password}));
  const user = {id: created.id, email, password, token: session.access_token};
  assert.equal(ok(await request('/auth/v1/user', user.token)).id, user.id);
  return user;
}
async function grant(user, grants, owner = false) {
  await sql.query('insert into public.crm_access_profiles(user_id,general_admin) values($1,$2) on conflict(user_id) do update set active=true,general_admin=$2', [user.id, owner]);
  await sql.query('delete from public.crm_module_grants where user_id=$1', [user.id]);
  for (const [module, entry] of Object.entries(grants)) {
    await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)', [user.id,module,entry.level,entry.sensitive ?? {}]);
  }
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member') on conflict(user_id,workspace_id) do update set status='active'", [user.id]);
  if (owner) await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'izord','admin') on conflict(user_id,workspace_id) do update set status='active'", [user.id]);
}
const payload = async () => (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const list = async user => ok(await rpc('crm_read_module', user, {p_module: 'documents'})).collections.documents;
const appFile = (user, resource, download = false) => fetch('http://127.0.0.1:3160/api/drive/file?fileId=' + encodeURIComponent(resource) + (download ? '&download=1' : ''), {headers: {Authorization: 'Bearer ' + user.token}});
async function appDenied(user, resource, download = false) { const response = await appFile(user, resource, download); assert.ok(response.status >= 400, 'Application route must deny'); await response.arrayBuffer(); }
const authorize = async (user, resource, write = false, download = false) => ok(await rpc('crm_authorize_drive', user, {p_resource: resource, p_write: write, p_download: download}));
const share = (user, document, recipient = users.clement) => rpc('crm_share_general_document', user,
  {p_provider: 'google-drive', p_resource: document.driveFileId, p_record: document.id, p_user: recipient.id});
async function test(name, fn) { await fn(); results.push({name, passed: true}); console.log('PASS ' + name); }
function saveFixture(documents) {
  writeFileSync(fixturePath, JSON.stringify({run, api, app: 'http://127.0.0.1:3160', users, documents}, null, 2), {mode: 0o600});
}

await sql.connect();
try {
  assert.equal((await sql.query("select count(*)::int n from auth.users where email not like '%@example.invalid'")).rows[0].n, 0, 'Only fictitious local identities allowed');
  const beforeMigration = await payload();
  if (process.argv.includes('--apply')) {
    assert.equal((await sql.query("select to_regclass('public.crm_document_shares') name")).rows[0].name, null, 'Apply exactly once to the disposable local schema');
    await sql.query(readFileSync(migrationURL, 'utf8'));
  }
  assert.deepEqual(await payload(), beforeMigration, 'Migration preserves every historical payload value');
  if (!reuseFixture) for (const name of ['owner','clement','other','business']) users[name] = await createUser(name);
  await grant(users.owner, ownerGrants, true);
  await grant(users.clement, documentGrants);
  await grant(users.other, documentGrants);
  await grant(users.business, {documents: {level: 'contribute', sensitive: {export: true, delete: true}}, tasks: {level: 'contribute', sensitive: {export: true, delete: true}}});

  const documents = Array.from({length: 8}, (_, index) => ({id: `fixture-shared-doc-${index + 1}`,
    title: `Document partagé fictif ${index + 1}`, fileName: `document-fictif-${index + 1}.${index < 5 ? 'png' : index === 6 ? 'docx' : 'pdf'}`,
    driveFileId: `fixture-general-drive-${index + 1}`, folderId: index < 7 ? 'fixture-marketing-crm-folder' : 'fixture-window-crm-folder',
    driveParentFolderId: index < 7 ? 'fixture-marketing-folder' : 'fixture-window-folder', isFolder: false,
    addedAt: '2026-01-01T00:00:00.000Z', addedBy: 'Propriétaire fictif', category: 'Documents', status: 'À jour'}));
  const source = await payload();
  source.documents ??= [];
  for (const id of documents.map(d => d.id).concat(['fixture-marketing-crm-folder','fixture-window-crm-folder'])) {
    if (!reuseFixture) assert.ok(!source.documents.some(d => d.id === id), 'Unique fixture IDs required; do not overwrite any retained row');
  }
  const folders = [{id: 'fixture-marketing-crm-folder', title: 'Marketing fictif', driveFolderId: 'fixture-marketing-folder', isFolder: true},
    {id: 'fixture-window-crm-folder', title: 'Devis vitre fictif', driveFolderId: 'fixture-window-folder', isFolder: true}];
  const unshared = {...documents[0], id: 'fixture-unshared-doc', driveFileId: 'fixture-unshared-drive', title: documents[0].title};
  const protectedDocument = {...documents[0], id: 'fixture-protected-doc', driveFileId: 'fixture-protected-drive'};
  const bankDocument = {...documents[0], id: 'fixture-bank-doc', driveFileId: 'fixture-bank-drive'};
  if (!reuseFixture) source.documents.push(...folders, ...documents, unshared, protectedDocument, bankDocument);
  source.tasks ??= []; source.contacts ??= [];
  const taskID = 'targeted-task-' + run, contactID = 'targeted-contact-' + run;
  if (!reuseFixture) source.tasks.push({id: taskID, title: 'Tâche fictive protégée', status: 'À faire', driveFileId: protectedDocument.driveFileId});
  if (!reuseFixture) source.contacts.push({id: contactID, name: 'Prestataire fictif protégé', kind: 'Prestataire', supplierBankAccounts: [{id: 'bank-' + run, driveFileId: bankDocument.driveFileId}]});
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [source]);
  const preservedPayload = await payload();
  saveFixture(documents);
  // PostgREST refreshes its schema cache asynchronously after the local migration.
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = await share(users.owner, documents[0]);
    if (probe.status === 204 || probe.status === 200) break;
    if (probe.status !== 404 || attempt === 39) ok(probe);
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await test('exact CRM/resource association, folders and eight explicit read-only grants persist', async () => {
    for (const document of documents.slice(1)) ok(await share(users.owner, document));
    const visible = await list(users.clement);
    assert.deepEqual(visible.map(d => d.resource_id).sort(), documents.map(d => d.driveFileId).sort());
    assert.equal(visible.filter(d => d.folder === 'Marketing fictif').length, 7);
    assert.equal(visible.filter(d => d.folder === 'Devis vitre fictif').length, 1);
    assert.ok(visible.every(d => d.collection === 'documents' && d.module === 'documents' && d.readonly && !d.replaceable && !d.deletable));
    assert.deepEqual(await list(users.clement), visible);
    assert.equal(ok(await rpc('crm_reference_options', users.clement, {p_module: 'documents'})).documents.length, 8);
    assert.equal(ok(await rpc('crm_export_module', users.clement, {p_module: 'documents'})).collections.documents.length, 8);
    await grant(users.clement, {...documentGrants, dashboard: {level: 'read'}});
    assert.equal(ok(await rpc('crm_read_module', users.clement, {p_module: 'dashboard'})).collections.documents, 8);
    await grant(users.clement, documentGrants);
    await grant(users.other, {...documentGrants, dashboard: {level: 'read'}});
    assert.equal(ok(await rpc('crm_read_module', users.other, {p_module: 'dashboard'})).collections.documents, 0);
    await grant(users.other, documentGrants);
    assert.deepEqual(await payload(), preservedPayload);
    assert.equal((await sql.query("select count(distinct detail->>'resource_id')::int n from public.crm_permission_events where subject_id=$1 and action=$2 and detail->>'provider'='google-drive'", [users.clement.id, 'document_shared'])).rows[0].n, 8);
  });
  await test('unshared user, same title, direct resource IDs and forbidden modules stay denied', async () => {
    assert.equal((await list(users.other)).length, 0);
    for (const document of documents) {
      assert.equal(await authorize(users.clement, document.driveFileId), true);
      assert.equal(await authorize(users.clement, document.driveFileId, false, true), true);
      assert.equal(await authorize(users.clement, document.driveFileId, true), false);
      assert.equal(await authorize(users.other, document.driveFileId), false);
    }
    assert.equal(await authorize(users.clement, unshared.driveFileId), false);
    assert.equal(await authorize(users.clement, protectedDocument.driveFileId), false);
    assert.equal(await authorize(users.clement, bankDocument.driveFileId), false);
    for (const moduleKey of ['contacts','tasks','vendorInvoices','houseTracking','izord']) denied(await rpc('crm_read_module', users.clement, {p_module: moduleKey}));
    denied(await rpc('crm_share_general_document', users.owner, {p_provider: 'google-drive', p_resource: documents[0].driveFileId, p_record: unshared.id, p_user: users.clement.id}));
  });
  await test('metadata edits, deletion, upload, replacement and sharing mutations are denied', async () => {
    const doc = documents[0], snapshot = ok(await rpc('crm_read_module', users.clement, {p_module: 'documents'}));
    denied(await rpc('crm_update_document', users.clement, {p_resource: doc.driveFileId, p_title: 'Modifié', p_folder: 'Modifié'}));
    denied(await rpc('crm_new_document', users.clement, {p_collection: 'documents', p_record: doc.id, p_title: 'Ajout interdit', p_bank: false}));
    denied(await rpc('crm_mutate_record', users.clement, {p_module: 'documents', p_collection: 'documents', p_id: doc.id, p_patch: {}, p_revision: snapshot.revision, p_delete: false}));
    denied(await share(users.clement, doc, users.other));
    denied(await rpc('crm_revoke_document_share', users.clement, {p_provider: 'google-drive', p_resource: doc.driveFileId, p_user: users.clement.id}));
    await grant(users.clement, {documents: {level: 'contribute', sensitive: {export: true, delete: true}}});
    denied(await rpc('crm_mutate_record', users.clement, {p_module: 'documents', p_collection: 'documents', p_id: doc.id, p_patch: {}, p_revision: snapshot.revision, p_delete: true}));
    denied(await request('/rest/v1/crm_document_shares?user_id=eq.' + users.clement.id, users.clement.token, {revoked_at: null}, 'PATCH'));
    await grant(users.clement, documentGrants);
    assert.deepEqual(await payload(), preservedPayload);
  });
  await test('share, Documents, Export, profile, membership and Auth changes affect the same existing token', async () => {
    const doc = documents[0];
    ok(await rpc('crm_revoke_document_share', users.owner, {p_provider: 'google-drive', p_resource: doc.driveFileId, p_user: users.clement.id}));
    assert.equal((await list(users.clement)).length, 7); assert.equal(await authorize(users.clement, doc.driveFileId), false);
    await appDenied(users.clement, doc.driveFileId); await appDenied(users.clement, doc.driveFileId, true);
    ok(await share(users.owner, doc));
    await grant(users.clement, {}); denied(await rpc('crm_read_module', users.clement, {p_module: 'documents'}));
    await appDenied(users.clement, doc.driveFileId); await appDenied(users.clement, doc.driveFileId, true);
    assert.equal(await authorize(users.clement, doc.driveFileId), false);
    await grant(users.clement, {documents: {level: 'contribute'}});
    assert.equal((await list(users.clement)).length, 8); assert.equal(await authorize(users.clement, doc.driveFileId), true);
    assert.equal(await authorize(users.clement, doc.driveFileId, false, true), false);
    const preview = await appFile(users.clement, doc.driveFileId); assert.equal(preview.status, 200); await preview.arrayBuffer();
    await appDenied(users.clement, doc.driveFileId, true);
    await grant(users.clement, documentGrants);
    await sql.query('update public.crm_access_profiles set active=false where user_id=$1', [users.clement.id]);
    denied(await rpc('crm_read_module', users.clement, {p_module: 'documents'})); assert.equal(await authorize(users.clement, doc.driveFileId), false);
    await appDenied(users.clement, doc.driveFileId); await appDenied(users.clement, doc.driveFileId, true);
    await sql.query('update public.crm_access_profiles set active=true where user_id=$1', [users.clement.id]);
    await sql.query("update public.app_memberships set status='revoked' where user_id=$1 and workspace_id='oar'", [users.clement.id]);
    denied(await rpc('crm_read_module', users.clement, {p_module: 'documents'})); assert.equal(await authorize(users.clement, doc.driveFileId), false);
    await appDenied(users.clement, doc.driveFileId); await appDenied(users.clement, doc.driveFileId, true);
    await sql.query("update public.app_memberships set status='active' where user_id=$1 and workspace_id='oar'", [users.clement.id]);
    for (const change of ['banned_until=now()+interval \'1 hour\'', 'email_confirmed_at=null', 'deleted_at=now()']) {
      await sql.query('update auth.users set ' + change + ' where id=$1', [users.clement.id]);
      denied(await rpc('crm_read_module', users.clement, {p_module: 'documents'})); assert.equal(await authorize(users.clement, doc.driveFileId), false);
      await appDenied(users.clement, doc.driveFileId); await appDenied(users.clement, doc.driveFileId, true);
      await sql.query('update auth.users set banned_until=null,email_confirmed_at=now(),deleted_at=null where id=$1', [users.clement.id]);
    }
    assert.equal((await list(users.clement)).length, 8);
  });
  await test('business/banking protection, owner access and original data are preserved', async () => {
    ok(await rpc('crm_classify_document', users.owner, {p_provider: 'google-drive', p_resource: protectedDocument.driveFileId, p_collection: 'tasks', p_record: taskID, p_title: 'Métier fictif', p_bank: false}));
    ok(await rpc('crm_classify_document', users.owner, {p_provider: 'google-drive', p_resource: bankDocument.driveFileId, p_collection: 'contacts', p_record: contactID, p_title: 'RIB fictif', p_bank: true}));
    denied(await share(users.owner, protectedDocument)); denied(await share(users.owner, bankDocument));
    denied(await rpc('crm_classify_document', users.owner, {p_provider: 'google-drive', p_resource: bankDocument.driveFileId, p_collection: 'documents', p_record: bankDocument.id, p_title: 'RIB reclassé', p_bank: false}));
    assert.equal(await authorize(users.business, protectedDocument.driveFileId, false, true), true);
    assert.equal(await authorize(users.business, bankDocument.driveFileId, false, true), false);
    assert.equal(await authorize(users.owner, bankDocument.driveFileId, true, true), true);
    assert.equal(await authorize(users.owner, protectedDocument.driveFileId, true, true), true);
    for (const doc of documents) assert.equal(await authorize(users.owner, doc.driveFileId, true, true), true);
    const currentRevision = ok(await rpc('crm_read_module', users.clement, {p_module: 'documents'})).revision;
    const unrelated = await payload(); unrelated.documents.push({...unshared, id: 'future-unshared-' + run, driveFileId: 'future-unshared-drive-' + run});
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [unrelated]);
    assert.equal(ok(await rpc('crm_read_module', users.clement, {p_module: 'documents'})).revision, currentRevision);
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [preservedPayload]);
    const ambiguous = await payload(); ambiguous.documents.push({...documents[0], id: 'ambiguous-general-' + run});
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [ambiguous]);
    assert.equal(await authorize(users.clement, documents[0].driveFileId), false);
    denied(await share(users.owner, documents[0]));
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [preservedPayload]);
    const p = await payload(); p.tasks.push({id: 'future-business-' + run, title: 'Référence métier ajoutée', driveFileId: documents[0].driveFileId});
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [p]);
    assert.equal(await authorize(users.clement, documents[0].driveFileId), false);
    p.tasks[p.tasks.length - 1] = {id: 'future-business-' + run, title: 'Lien métier protégé', url: 'https://drive.google.com/file/d/' + documents[0].driveFileId + '/view'};
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [p]);
    assert.equal(await authorize(users.clement, documents[0].driveFileId), false);
    denied(await share(users.owner, documents[0]));
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [preservedPayload]);
    assert.deepEqual(await payload(), preservedPayload);
    assert.equal((await list(users.clement)).length, 8);
    const matrix = ok(await rpc('crm_access_snapshot', users.clement));
    assert.equal(matrix.generalAdmin, false); assert.equal(matrix.fullAccess, false);
    assert.deepEqual(matrix.modules, documentGrants);
    assert.equal(ok(await rpc('crm_access_snapshot', users.owner)).fullAccess, true);
  });
  await test('general Storage bytes obey the same read-only sharing and Export boundary', async () => {
    const path = 'targeted-fictional/' + run + '.txt';
    const p = await payload(), record = {id: 'storage-' + run, title: 'Stockage fictif', storagePath: path, isFolder: false};
    p.documents.push(record); await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [p]);
    const upload = await fetch(api + '/storage/v1/object/crm-documents/' + path, {method: 'POST', headers: {apikey: status.ANON_KEY, Authorization: 'Bearer ' + users.owner.token, 'Content-Type': 'text/plain'}, body: 'FICTIONAL GENERAL DOCUMENT BYTES'});
    assert.equal(upload.status, 200, await upload.text());
    ok(await rpc('crm_share_general_document', users.owner, {p_provider: 'storage', p_resource: path, p_record: record.id, p_user: users.clement.id}));
    const download = user => fetch(api + '/storage/v1/object/authenticated/crm-documents/' + path, {headers: {apikey: status.ANON_KEY, Authorization: 'Bearer ' + user.token}});
    assert.equal(await (await download(users.clement)).text(), 'FICTIONAL GENERAL DOCUMENT BYTES');
    assert.ok((await download(users.other)).status >= 400);
    const overwrite = await fetch(api + '/storage/v1/object/crm-documents/' + path, {method: 'PUT', headers: {apikey: status.ANON_KEY, Authorization: 'Bearer ' + users.clement.token, 'Content-Type': 'text/plain'}, body: 'FORBIDDEN REPLACEMENT'});
    assert.ok(overwrite.status >= 400);
    denied(await rpc('crm_forget_document', users.clement, {p_resource: path}));
    await grant(users.clement, {documents: {level: 'contribute'}}); assert.ok((await download(users.clement)).status >= 400);
    await grant(users.clement, documentGrants);
    ok(await rpc('crm_revoke_document_share', users.owner, {p_provider: 'storage', p_resource: path, p_user: users.clement.id}));
    assert.ok((await download(users.clement)).status >= 400);
    assert.equal((await list(users.clement)).length, 8);
    // Retain the fictitious original; only restore the source catalogue used by the browser fixture.
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [preservedPayload]);
  });
  saveFixture(documents);
  writeFileSync('/private/tmp/oar-targeted-docs-local-results.json', JSON.stringify({results, realLocalAuth: true, realLocalStorageBytes: true, productionSessionVerified: false}, null, 2), {mode: 0o600});
  console.log(`${results.length} targeted groups passed; browser fixture ready at ${fixturePath}`);
} finally {
  await sql.end();
}
