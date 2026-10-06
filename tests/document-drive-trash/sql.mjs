/** Targeted SQL semantics against the retained fictitious loopback stack.
 * SQL role/JWT claims are simulated; this is not Production session evidence.
 * Fixture mutations roll back; only the additive local migration persists.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';

const statusPath = process.env.LOCAL_STATUS_FILE;
const fixturePath = process.env.DOCUMENT_SHARES_FIXTURE_FILE;
assert.ok(statusPath && fixturePath, 'Explicit private fictitious local manifests required');
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
assert.equal(new URL(status.API_URL).origin, 'http://127.0.0.1:55431');
assert.equal(new URL(status.DB_URL).hostname, '127.0.0.1');
assert.equal(new URL(status.DB_URL).port, '55432');
assert.ok(Object.values(fixture.users).every(user => user.email.endsWith('@example.invalid')));
const sql = new Client({ connectionString: status.DB_URL });
const migration = readdirSync('supabase/migrations').filter(name => name.endsWith('_document_drive_trash.sql'));
assert.equal(migration.length, 1);
const groups = [];
const payload = async () => (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const shares = async () => (await sql.query('select * from public.crm_document_shares order by provider,resource_id,user_id')).rows;
async function claims(user, role = 'authenticated', withSession = true) {
  await sql.query('reset role');
  const session = (await sql.query('select id from auth.sessions where user_id=$1 order by created_at desc limit 1', [user.id])).rows[0];
  assert.ok(session, 'Existing fictitious Auth session required');
  await sql.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: user.id, role, ...(withSession ? { session_id: session.id } : {}) })]);
  await sql.query('set local role ' + role);
}
async function asAdmin() { await sql.query('reset role'); await sql.query("select set_config('request.jwt.claims','{}',true)"); }
async function save(value) { await asAdmin(); await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [value]); }
async function refused(action, pattern) {
  await sql.query('savepoint expected_refusal');
  await assert.rejects(action, error => { assert.match(error.message, pattern); return true; });
  await sql.query('rollback to savepoint expected_refusal');
}
const begin = async (doc, preview = false, operation = randomUUID(), overrides = {}) => {
  const args = [operation, doc.id, doc.isFolder ? doc.driveFolderId : doc.driveFileId,
    doc.folderId ?? '', doc.driveParentFolderId ?? '', null, preview];
  for (const [index, value] of Object.entries(overrides)) args[Number(index)] = value;
  return (await sql.query('select public.crm_document_trash_begin($1,$2,$3,$4,$5,$6,$7) result', args)).rows[0].result;
};
const complete = async journal => (await sql.query('select public.crm_document_trash_complete($1,$2,$3) result',
  [journal.operation_id, journal.actor_id, { id: journal.resource_id, trashed: true, explicitlyTrashed: true, name: journal.snapshot.title }])).rows[0].result;
async function group(name, body) { await body(); groups.push(name); console.log('PASS ' + name); }

await sql.connect();
try {
  assert.equal((await sql.query("select count(*)::int n from auth.users where email is null or email not like '%@example.invalid'")).rows[0].n, 0);
  const initialPayload = await payload(), initialShares = await shares();
  if ((await sql.query("select to_regclass('app_private.document_drive_trash') journal")).rows[0].journal === null) {
    await sql.query(readFileSync('supabase/migrations/' + migration[0], 'utf8'));
  }
  assert.deepEqual(await payload(), initialPayload);
  assert.deepEqual(await shares(), initialShares);
  await sql.query('begin');
  const suffix = randomUUID().slice(0, 8);
  const folder = { id: 'trash-folder-' + suffix, title: 'Corbeille fictive', isFolder: true,
    driveFolderId: 'trash-drive-folder-' + suffix, folderId: '', driveParentFolderId: '' };
  const file = { id: 'trash-file-' + suffix, title: 'Même nom fictif', isFolder: false,
    driveFileId: 'trash-drive-file-' + suffix, folderId: folder.id, driveParentFolderId: folder.driveFolderId };
  const otherFolder = { ...folder, id: 'other-folder-' + suffix, driveFolderId: 'other-drive-folder-' + suffix };
  const homonym = { ...file, id: 'other-file-' + suffix, driveFileId: 'other-drive-file-' + suffix,
    folderId: otherFolder.id, driveParentFolderId: otherFolder.driveFolderId };
  const fixturePayload = { ...initialPayload, documents: [...initialPayload.documents, folder, file, otherFolder, homonym] };
  await save(fixturePayload);
  await group('preview/cancel makes no journal and preserves the eight existing shares', async () => {
    await claims(fixture.users.owner);
    const preview = await begin(file, true);
    assert.equal(preview.preview, true); assert.equal(preview.record_id, file.id);
    await asAdmin();
    assert.equal((await sql.query('select count(*)::int n from app_private.document_drive_trash where record_id=$1', [file.id])).rows[0].n, 0);
    assert.deepEqual(await shares(), initialShares);
  });
  await group('nonempty folder including subfolder, wrong identity and mismatched parent refused', async () => {
    await claims(fixture.users.owner);
    await refused(() => begin(folder), /document_folder_not_empty/);
    await refused(() => begin(file, false, randomUUID(), { 2: homonym.driveFileId }), /invalid_document_target/);
    await refused(() => begin(file, false, randomUUID(), { 3: otherFolder.id }), /document_parent_mismatch/);
    await refused(() => begin(file, false, randomUUID(), { 5: '2000-01-01T00:00:00Z' }), /revision_conflict/);
    await refused(() => begin({ ...file, id: 'root' }), /invalid_document_target/);
    await asAdmin();
    const p = await payload(); p.documents.push({ ...folder, id: 'nested-' + suffix, driveFolderId: 'nested-drive-' + suffix, folderId: otherFolder.id, driveParentFolderId: otherFolder.driveFolderId });
    await save(p); await claims(fixture.users.owner);
    await refused(() => begin(otherFolder), /document_folder_not_empty/);
  });
  await group('session, Contribution/Delete and readonly share never grant exact deletion', async () => {
    await claims(fixture.users.owner, 'authenticated', false);
    await refused(() => begin(file), /document_trash_forbidden/);
    await claims(fixture.users.clement);
    await refused(() => begin(file), /document_trash_forbidden/);
    await asAdmin();
    await sql.query("update public.crm_module_grants set sensitive=sensitive||'{\"delete\":true}'::jsonb where user_id=$1 and module='documents'", [fixture.users.clement.id]);
    await claims(fixture.users.clement);
    const shared = fixture.documents[0];
    await refused(() => begin(shared), /document_trash_forbidden/);
    await refused(() => sql.query('select public.crm_document_trash_complete($1,$2,$3)', [randomUUID(), fixture.users.clement.id, { id: shared.driveFileId, trashed: true, explicitlyTrashed: true }]), /permission denied/);
    await refused(() => sql.query('select * from app_private.document_drive_trash'), /permission denied/);
  });
  await group('duplicate CRM reference, business URL and bank document refused', async () => {
    await asAdmin(); const p = await payload();
    p.documents.push({ ...file, id: 'duplicate-' + suffix }); await save(p);
    await claims(fixture.users.owner); await refused(() => begin(file), /document_referenced_or_protected/);
    p.documents.pop(); p.tasks.push({ id: 'protected-task-' + suffix, title: 'Fictif', url: 'https://drive.google.com/file/d/' + file.driveFileId + '/view' });
    await save(p); await claims(fixture.users.owner); await refused(() => begin(file), /document_referenced_or_protected/);
    p.tasks.pop(); p.contacts.push({ id: 'protected-bank-' + suffix, supplierBankAccounts: [{ driveFileId: file.driveFileId }] });
    await save(p); await claims(fixture.users.owner); await refused(() => begin(file), /document_referenced_or_protected/);
    p.contacts.pop(); await save(p);
  });
  let journal;
  await group('durable pending replay freezes exact file while concurrent unrelated changes survive', async () => {
    await claims(fixture.users.owner); journal = await begin(file);
    const replay = await begin(file, false, randomUUID(), { 5: '2000-01-01T00:00:00Z' });
    assert.equal(replay.operation_id, journal.operation_id); assert.equal(replay.status, 'pending');
    assert.equal((await sql.query("select app_private.document_allowed('google-drive',$1,false,true) allowed", [file.driveFileId])).rows[0].allowed, false);
    await asAdmin(); const p = await payload();
    const changed = structuredClone(p); changed.documents.find(d => d.id === file.id).title = 'Concurrent target edit';
    await refused(() => save(changed), /document_trash_pending/);
    const reference = structuredClone(p); reference.tasks.push({ id: 'late-ref-' + suffix, driveFileId: file.driveFileId });
    await refused(() => save(reference), /document_trash_reference_forbidden/);
    const child = structuredClone(p); child.documents.push({ id: 'bad-child-' + suffix, isFolder: true, folderId: file.id });
    await refused(() => save(child), /document_trash_reference_forbidden/);
    await refused(() => sql.query("insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title) values('google-drive',$1,'documents','documents',$2,'Fictif')", [file.driveFileId,file.id]), /document_trash_scope_locked/);
    p.tasks.push({ id: 'concurrent-task-' + suffix, title: 'Modification concurrente conservée' }); await save(p);
    await sql.query('update public.crm_access_profiles set general_admin=true where user_id=$1', [fixture.users.other.id]);
    await sql.query('delete from public.crm_module_grants where user_id=$1', [fixture.users.other.id]);
    await sql.query('insert into public.crm_module_grants select $1,module,level,sensitive from public.crm_module_grants where user_id=$2', [fixture.users.other.id,fixture.users.owner.id]);
    await claims(fixture.users.other);
    await refused(() => begin(file), /document_trash_other_actor/);
    await claims(fixture.users.owner);
    await refused(() => begin(homonym, false, journal.operation_id), /document_trash_identity_conflict/);
    await refused(() => sql.query('select public.crm_document_trash_complete($1,$2,$3)', [journal.operation_id, journal.actor_id, { id: file.driveFileId, trashed: true, explicitlyTrashed: true }]), /permission denied/);
  });
  let completed;
  await group('server completion removes only exact homonym, preserves counters and all unrelated state', async () => {
    await claims(fixture.users.owner, 'service_role');
    await refused(() => sql.query('select public.crm_document_trash_complete($1,$2,$3)', [journal.operation_id, journal.actor_id, { id: homonym.driveFileId, trashed: true, explicitlyTrashed: true }]), /document_drive_confirmation_required/);
    completed = await complete(journal);
    assert.equal(completed.status, 'completed'); assert.ok(completed.completed_at);
    assert.ok(!completed.workspace_payload.documents.some(d => d.id === file.id));
    assert.deepEqual(completed.workspace_payload.documents.find(d => d.id === homonym.id), homonym);
    assert.ok(completed.workspace_payload.tasks.some(t => t.id === 'concurrent-task-' + suffix));
    assert.equal(completed.workspace_payload.documents.length, fixturePayload.documents.length); // one removed, nested fixture added
    const replay = await complete(journal); assert.equal(replay.completed_at, completed.completed_at);
    await asAdmin(); assert.deepEqual(await shares(), initialShares);
    assert.equal((await sql.query("select count(*)::int n from public.crm_permission_events where action='document_trashed' and detail->>'operation_id'=$1", [journal.operation_id])).rows[0].n, 1);
  });
  await group('stale resurrection stripped, conflicting identity refused, file then empty folder works', async () => {
    await asAdmin(); const p = await payload(); p.documents.push(file); p.tasks.push({ id: 'draft-' + suffix, title: 'Brouillon conservé' }); await save(p);
    assert.ok(!(await payload()).documents.some(d => d.id === file.id));
    assert.ok((await payload()).tasks.some(t => t.id === 'draft-' + suffix));
    p.documents[p.documents.length - 1] = { ...file, title: 'Changed stale file' };
    await refused(() => save(p), /document_trash_resurrection_forbidden/);
    await claims(fixture.users.owner); const folderOperation = await begin(folder);
    await asAdmin(); const pending = await payload();
    pending.documents.push({ ...file, id: 'new-child-' + suffix, driveFileId: 'new-child-drive-' + suffix });
    await refused(() => save(pending), /document_trash_reference_forbidden/);
    await claims(fixture.users.owner, 'service_role'); const empty = await complete(folderOperation);
    assert.ok(!empty.workspace_payload.documents.some(d => d.id === folder.id));
    await asAdmin(); assert.deepEqual(await shares(), initialShares);
  });
  await group('journal private, server finalize grant only and recoverable metadata persist', async () => {
    await asAdmin();
    const permissions = (await sql.query("select has_function_privilege('anon','public.crm_document_trash_begin(uuid,text,text,text,text,text,boolean)','execute') anon_begin, has_function_privilege('authenticated','public.crm_document_trash_complete(uuid,uuid,jsonb)','execute') browser_complete, has_function_privilege('service_role','public.crm_document_trash_complete(uuid,uuid,jsonb)','execute') server_complete")).rows[0];
    assert.deepEqual(permissions, { anon_begin: false, browser_complete: false, server_complete: true });
    const stored = (await sql.query('select * from app_private.document_drive_trash where operation_id=$1', [journal.operation_id])).rows[0];
    assert.deepEqual(stored.snapshot, file); assert.equal(stored.drive_confirmation.id, file.driveFileId);
    assert.equal(stored.parent_record_id, folder.id); assert.equal(stored.parent_resource_id, folder.driveFolderId);
    assert.equal((await sql.query("select relrowsecurity enabled from pg_class where oid='app_private.document_drive_trash'::regclass")).rows[0].enabled, true);
  });
  await sql.query('rollback');
  assert.deepEqual(await payload(), initialPayload); assert.deepEqual(await shares(), initialShares);
  console.log(JSON.stringify({ groups: groups.length, sqlRoleSimulation: true, migrationPreservesExistingPayloadAndShares: true, fixtureWritesRolledBack: true }));
} finally {
  await sql.query('rollback').catch(() => {}); await sql.end();
}
