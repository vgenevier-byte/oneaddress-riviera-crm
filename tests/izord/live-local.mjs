/** Real local Auth -> PostgREST/RLS/RPC/Storage verification.
 * No production env is loaded. Missing infrastructure fails; nothing is skipped.
 * Google/Next route verification is a separate runner using the private fixture.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertLocalTarget } from './local-target.mjs';
import { prepareReuse, verifyRetained, visibleIds, withFixtureVendor } from './reuse-local.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
const api = status.API_URL, db = status.DB_URL, app = 'http://127.0.0.1:3159', mail = 'http://127.0.0.1:55434';
// Deliberately before any client construction, connect(), or fetch().
assertLocalTarget({ api, database: db, app, mail, acknowledgement: process.env.IZORD_TEST_ACK });
assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local stack status credentials required');
const fixturePath = resolve(process.env.LOCAL_FIXTURE_FILE || '');
assert.ok(process.env.LOCAL_FIXTURE_FILE && (fixturePath.startsWith('/tmp/') || fixturePath.startsWith('/private/tmp/') || fixturePath.startsWith(resolve(tmpdir()) + '/')), 'Private fixture must be outside shared artifacts in /tmp');
const { Client } = require(process.env.IZORD_PG_MODULE || 'pg');
const sql = new Client({ connectionString: db });
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(api, status.SERVICE_ROLE_KEY, clientOptions);
const publicKey = status.ANON_KEY;
const anonymous = createClient(api, publicKey, clientOptions);
const log = [], users = {};
const reuseExisting = process.argv.includes('--reuse-existing'), runId = randomUUID();
const oarDocument = reuseExisting ? `fictional-${runId}.pdf` : 'fictional.pdf';
let retained;
let activeTest = 'local initialization';
const historical = ['crm_leads', 'crm_tasks', 'crm_properties', 'crm_vehicles', 'crm_boats', 'crm_quotes', 'crm_contacts', 'crm_backups'];
const names = ['none', 'pending', 'invitee', 'oar', 'oar2', 'admin', 'partner', 'a', 'b', 'reader', 'both', 'revoked', 'revoke_oar', 'drive_revoke', 'revoke_admin'];
const hasOAR = name => ['oar', 'oar2', 'both', 'revoke_oar', 'drive_revoke'].includes(name);
const hasIzord = name => ['admin', 'partner', 'a', 'b', 'reader', 'both', 'revoke_admin'].includes(name);
const globalIzord = name => ['admin', 'partner', 'both', 'revoke_admin'].includes(name);
const actor = name => name === 'anon' ? anonymous : users[name].client;
const rpc = (name, fn, args = {}) => actor(name).rpc(fn, args);
function safeCode(error) { return /^[A-Z0-9_]{1,40}$/i.test(String(error?.code || '')) ? String(error.code) : error?.name || 'Error'; }
async function ok(p) { const r = await p; if (r.error) throw Object.assign(new Error('Expected authorized operation failed'), { code: safeCode(r.error) }); return r.data; }
async function denied(p) { const r = await p; assert.ok(r.error || Array.isArray(r.data) && r.data.length === 0, 'Expected denied operation or zero affected rows'); return r; }
async function test(name, fn) { activeTest = name; await fn(); log.push({ name, result: 'passed' }); console.log(`PASS ${name}`); }
const rows = (who, table, columns = '*') => ok(actor(who).from(table).select(columns));
const pdf = text => new Blob([`%PDF-1.4\n${text}\n%%EOF`], { type: 'application/pdf' });
const store = who => actor(who).storage.from('izord-documents');
const assetId = path => path.split('/')[1];
async function storedEquals(who, path, expected) { const blob = await ok(store(who).download(path)); assert.equal(await blob.text(), expected); }
async function raw(who, path, init = {}) {
  return fetch(`${api}${path}`, { ...init, redirect: 'error', headers: { apikey: publicKey, ...(who !== 'anon' && { Authorization: `Bearer ${users[who].token}` }), ...init.headers } });
}
function privateFixture(data) { mkdirSync(dirname(fixturePath), { recursive: true, mode: 0o700 }); writeFileSync(fixturePath, JSON.stringify(data), { mode: 0o600 }); chmodSync(fixturePath, 0o600); }
const fixture = { api, app, mail, publicKey, users: {}, projects: {}, documents: {}, integrationComplete: false, vendorContactId: reuseExisting ? `fixture-vendor-api-${runId}` : 'fixture-vendor-api' };
try {
  await sql.connect();
  await test(reuseExisting ? 'retained disposable database verified without reset or migration replay' : 'fresh disposable database and real migrations applied only to guarded loopback', async () => {
    if (reuseExisting) {
      retained = await prepareReuse(sql, { statusFile: process.env.LOCAL_STATUS_FILE, fixturePath, api, runId });
      fixture.reuse = { runId, retainedSnapshotFile: retained.snapshotFile, originalWorkspacePayloadHash: retained.workspace.payload_hash };
      return;
    }
    assert.equal((await sql.query("select to_regclass('public.crm_workspace_state') table_name")).rows[0].table_name, null, 'Fresh disposable stack required; no existing table is dropped');
    const baseline = readFileSync('tests/izord/sql-fixture.sql', 'utf8');
    const begin = baseline.indexOf('create table public.crm_workspace_state'), end = baseline.indexOf('create schema storage;');
    assert.ok(begin > 0 && end > begin);
    // Minimal, fictitious historical table baseline; actual local Auth/Storage schemas remain intact.
    await sql.query(baseline.slice(begin, end));
    await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
    await sql.query(readFileSync('supabase/migrations/20260914210807_drive_folder_registry.sql', 'utf8'));
    await sql.query(readFileSync('supabase/migrations/20260916170445_module_access_foundation.sql', 'utf8'));
    await sql.query("notify pgrst, 'reload schema'");
  });
  await test('fictitious users sign in through real local Auth and receive verified sessions', async () => {
    for (const name of names) {
      const email = `${name}-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('hex');
      const created = await ok(admin.auth.admin.createUser({ email, password, email_confirm: true }));
      const client = createClient(api, publicKey, clientOptions);
      const signed = await ok(client.auth.signInWithPassword({ email, password }));
      assert.ok(signed.session?.access_token && signed.session.expires_at * 1000 > Date.now());
      users[name] = { id: created.user.id, email, password, client, token: signed.session.access_token, session: signed.session };
      assert.equal((await ok(client.auth.getUser(signed.session.access_token))).user.id, created.user.id);
      const { client: _client, ...privateUser } = users[name]; fixture.users[name] = privateUser;
    }
    for (const name of names.filter(hasOAR)) await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member')", [users[name].id]);
    for (const [name, role] of Object.entries({ admin: 'admin', partner: 'partner', a: 'contributor', b: 'contributor', reader: 'reader', both: 'admin', revoked: 'contributor', revoke_admin: 'admin' })) {
      await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'izord',$2,$3)", [users[name].id, role, name === 'revoked' ? 'revoked' : 'active']);
    }
    // Every user owns historical rows, proving restrictive OAR membership even where the old owner policy matches.
    for (const table of historical) for (const name of names) await sql.query(`insert into public.${table}(user_id,payload) values($1,$2)`, [users[name].id, { fictitious: true, ownerFixture: name }]);
    const payload = reuseExisting ? withFixtureVendor(retained.workspace.payload, fixture.vendorContactId) : { contacts: [{ id: 'fictional-contact-browser', name: 'OAR LOCAL CONFIDENTIEL', type: 'Particulier', email: 'contact@example.invalid', category: 'Client' }, { id: 'fixture-vendor-api', kind: 'Prestataire', companyName: 'Prestataire fictif API' }], leads: [], tasks: [], properties: [], vehicles: [], boats: [], quotes: [], documents: [] };
    const seeded = await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera' and ($2::timestamptz is null or updated_at=$2::timestamptz) returning md5(payload::text) payload_hash", [payload, retained?.workspace.revision ?? null]);
    assert.equal(seeded.rowCount, 1, 'Shared fictitious workspace changed before guarded preparation');
    if (reuseExisting) { fixture.reuse.activeWorkspacePayloadHash = seeded.rows[0].payload_hash; privateFixture(fixture); }
    for (let n = 0; n < 50; n++) { const check = await users.admin.client.from('app_memberships').select('role'); if (!check.error) break; if (n === 49) throw new Error('PostgREST schema cache unavailable'); await new Promise(r => setTimeout(r, 100)); }
  });
  const pa = await ok(rpc('a', 'izord_create_project', { p_title: 'Projet fictif A' }));
  const pb = await ok(rpc('b', 'izord_create_project', { p_title: 'Projet fictif B' }));
  fixture.projects = { a: pa, b: pb };
  await ok(rpc('admin', 'izord_assign_project', { p_project: pa, p_user: users.reader.id, p_assigned: true }));
  await ok(rpc('admin', 'izord_invite_izord', { p_email: users.pending.email, p_role: 'reader' }));
  const docA = await ok(rpc('a', 'izord_register_asset', { p_project: pa, p_revision: 1, p_kind: 'pdf' }));
  const docB = await ok(rpc('b', 'izord_register_asset', { p_project: pb, p_revision: 1, p_kind: 'pdf' }));
  const presentation = await ok(rpc('a', 'izord_register_asset', { p_project: pa, p_revision: 1, p_kind: 'presentation' }));
  const bytesA = '%PDF-1.4\nFICTITIOUS A\n%%EOF', bytesB = '%PDF-1.4\nFICTITIOUS B\n%%EOF';
  await ok(store('a').upload(docA, new Blob([bytesA], { type: 'application/pdf' })));
  await ok(store('b').upload(docB, new Blob([bytesB], { type: 'application/pdf' })));
  await ok(store('a').upload(presentation, new Blob(['FICTITIOUS PRESENTATION'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })));
  for (const [who,path] of [['a',docA],['b',docB],['a',presentation]]) await ok(rpc(who, 'izord_finalize_asset', { p_asset: assetId(path) }));
  await ok(users.oar.client.storage.from('crm-documents').upload(oarDocument, pdf('FICTITIOUS OAR')));
  fixture.documents = { a: docA, b: docB, presentation, oar: oarDocument };
  privateFixture(fixture);
  console.log('Private local fixture ready (credentials deliberately omitted)');

  for (const name of ['anon', ...names]) {
    await test(`${name}: OAR payload and eight historical tables read/write boundaries`, async () => {
      if (name === 'anon') {
        await denied(anonymous.from('crm_workspace_state').select('*'));
        for (const table of historical) await denied(anonymous.from(table).select('*'));
        return;
      }
      assert.equal((await rows(name, 'crm_workspace_state')).length, hasOAR(name) ? 1 : 0);
      for (const table of historical) {
        const visible = await rows(name, table); assert.equal(visible.length, hasOAR(name) ? 1 : 0);
        if (hasOAR(name)) assert.equal(visible[0].user_id, users[name].id);
        else {
          await denied(actor(name).from(table).insert({ user_id: users[name].id, payload: { unauthorized: true } }).select());
          await denied(actor(name).from(table).update({ payload: { unauthorized: true } }).eq('user_id', users[name].id).select());
          await denied(actor(name).from(table).delete().eq('user_id', users[name].id).select());
          assert.deepEqual((await sql.query(`select payload from public.${table} where user_id=$1`, [users[name].id])).rows.map(r => r.payload), [{ fictitious: true, ownerFixture: name }]);
        }
      }
      if (!hasOAR(name)) {
        await denied(actor(name).from('crm_workspace_state').upsert({ workspace_id: 'oneaddress-riviera', payload: { unauthorized: true } }).select());
        const r = await actor(name).from('crm_workspace_state').update({ payload: { unauthorized: true } }).eq('workspace_id', 'oneaddress-riviera').select(); await denied(Promise.resolve(r));
      }
    });
    await test(`${name}: three direct OAR registry RPCs and wrong workspace`, async () => {
      const lease = randomUUID(), key = `vendor:${reuseExisting ? runId + '-' : ''}${name}`;
      for (const [fn, args] of [['claim', { p_parent_id: 'fictional-root' }], ['reserve', { p_drive_folder_id: `fictional-${runId}-${name}` }], ['ready', { p_drive_folder_id: `fictional-${runId}-${name}` }]]) {
        const result = rpc(name, `crm_drive_folder_${fn}`, { p_workspace_id: 'oneaddress-riviera', p_logical_key: key, p_lease_token: lease, ...args });
        if (hasOAR(name)) assert.ok(await ok(result)); else await denied(result);
      }
      await denied(rpc(name, 'crm_drive_folder_claim', { p_workspace_id: 'izord', p_logical_key: key, p_parent_id: 'fictional-root', p_lease_token: lease }));
      await denied(actor(name).from('crm_drive_folder_registry').select('*'));
    });
    await test(`${name}: private OAR document download/list/create boundaries`, async () => {
      const bucket = actor(name).storage.from('crm-documents');
      if (hasOAR(name)) { assert.ok((await ok(bucket.download(oarDocument))).size > 0); assert.equal((await ok(bucket.list(''))).some(o => o.name === oarDocument), true); }
      else {
        await denied(bucket.download(oarDocument)); await denied(bucket.list(''));
        await denied(bucket.upload(`unauthorized-${runId}-${name}.pdf`, pdf('FORBIDDEN')));
        await denied(bucket.createSignedUrl(oarDocument, 60));
        await bucket.remove([oarDocument]);
        assert.ok((await ok(users.oar.client.storage.from('crm-documents').download(oarDocument))).size > 0);
      }
    });
    await test(`${name}: IZORD direct REST project/version/asset visibility`, async () => {
      if (name === 'anon') { for (const table of ['izord_projects', 'izord_project_versions', 'izord_assets']) await denied(anonymous.from(table).select('*')); return; }
      const expected = globalIzord(name) ? [pa, pb] : ['a', 'reader'].includes(name) ? [pa] : name === 'b' ? [pb] : [];
      assert.deepEqual((await rows(name, 'izord_projects', 'id')).map(p => p.id).sort(), visibleIds(retained?.baseline.projects ?? [], expected, globalIzord(name)));
      assert.deepEqual([...new Set((await rows(name, 'izord_project_versions', 'project_id')).map(p => p.project_id))].sort(), visibleIds(retained?.baseline.versionProjects ?? [], expected, globalIzord(name)));
      const expectedAssets = globalIzord(name) ? [docA, docB, presentation] : name === 'a' ? [docA, presentation] : name === 'b' ? [docB] : [];
      assert.deepEqual((await rows(name, 'izord_assets', 'object_path')).map(p => p.object_path).sort(), visibleIds(retained?.baseline.assets ?? [], expectedAssets, globalIzord(name)));
      const forbiddenProject = expected.includes(pb) ? null : pb;
      if (forbiddenProject) assert.deepEqual(await ok(actor(name).from('izord_projects').select('*').eq('id', forbiddenProject)), []);
    });
    await test(`${name}: IZORD private bytes, listing and signed URL authorization`, async () => {
      const canA = globalIzord(name) || name === 'a', canB = globalIzord(name) || name === 'b';
      for (const [path, allowed, expected] of [[docA, canA, bytesA], [docB, canB, bytesB]]) {
        if (allowed) { await storedEquals(name, path, expected); assert.ok((await ok(store(name).createSignedUrl(path, 60))).signedUrl); }
        else { await denied(store(name).download(path)); await denied(store(name).createSignedUrl(path, 60)); }
      }
      const listA = await store(name).list(pa), listB = await store(name).list(pb);
      if (name === 'anon' && listA.error) await denied(Promise.resolve(listA)); else assert.equal((await ok(Promise.resolve(listA))).length, canA ? 2 : 0);
      if (name === 'anon' && listB.error) await denied(Promise.resolve(listB)); else assert.equal((await ok(Promise.resolve(listB))).length, canB ? 1 : 0);
    });
  }

  await test('OAR authorized CRUD preserves ownership and server-stamps workspace author', async () => {
    const saved = await ok(users.oar.client.from('crm_workspace_state').update({ updated_by: users.admin.id }).eq('workspace_id', 'oneaddress-riviera').select('updated_by'));
    assert.equal(saved[0].updated_by, users.oar.id);
    await denied(users.oar.client.from('crm_workspace_state').insert({ workspace_id: 'izord', payload: {} }).select());
    for (const table of historical) {
      await denied(users.oar.client.from(table).insert({ user_id: users.admin.id, payload: {} }).select());
      const created = await ok(users.oar.client.from(table).insert({ user_id: users.oar.id, payload: { fictitious: 'CRUD' } }).select('id')); assert.equal(created.length, 1);
      const id = created[0].id;
      assert.equal((await ok(users.both.client.from(table).select('*').eq('id', id))).length, 0);
      if (table === 'crm_backups') { await denied(users.oar.client.from(table).update({ payload: {} }).eq('id', id).select()); await denied(users.oar.client.from(table).delete().eq('id', id).select()); }
      else {
        await denied(users.oar.client.from(table).update({ user_id: users.admin.id }).eq('id', id).select());
        assert.equal((await ok(users.oar.client.from(table).update({ payload: { fictitious: 'UPDATED' } }).eq('id', id).select())).length, 1);
        assert.equal((await ok(users.oar.client.from(table).delete().eq('id', id).select())).length, 1);
        assert.deepEqual(await ok(users.oar.client.from(table).select('*').eq('id', id)), []);
      }
    }
    const bucket = users.oar.client.storage.from('crm-documents'), path = `fictional-crud-${runId}.pdf`;
    await ok(bucket.upload(path, pdf('OAR CRUD'))); await ok(bucket.update(path, pdf('OAR UPDATED')));
    assert.ok((await ok(bucket.download(path))).size > 0); assert.equal((await ok(bucket.remove([path]))).length, 1); await denied(bucket.download(path));
  });
  await test('direct client mutations cannot alter role, workspace, owner, assignment, project or audit', async () => {
    for (const name of ['none', 'oar', 'reader', 'a', 'partner', 'admin', 'both']) {
      await denied(actor(name).from('app_memberships').insert({ user_id: users[name].id, workspace_id: 'oar', role: 'member' }).select());
      await denied(actor(name).from('app_memberships').update({ role: 'admin', workspace_id: 'izord' }).eq('user_id', users[name].id).select());
      await denied(actor(name).from('app_memberships').delete().eq('user_id', users[name].id).select());
      await denied(actor(name).from('izord_projects').insert({ owner_id: users[name].id, title: 'FORBIDDEN' }).select());
      await denied(actor(name).from('izord_projects').update({ owner_id: users[name].id }).eq('id', pb).select());
      await denied(actor(name).from('izord_projects').delete().eq('id', pb).select());
      await denied(actor(name).from('izord_project_assignments').insert({ project_id: pb, user_id: users[name].id }).select());
      await denied(actor(name).from('izord_project_assignments').update({ project_id: pb }).eq('user_id', users.reader.id).select());
      await denied(actor(name).from('izord_assets').update({ project_id: pa, created_by: users[name].id }).eq('object_path', docB).select());
      await denied(actor(name).from('izord_access_events').insert({ actor_id: users.admin.id, action: 'FORGED' }).select());
      await denied(actor(name).from('izord_invitations').select('*'));
    }
    assert.equal((await ok(users.admin.client.from('izord_projects').select('owner_id').eq('id', pb)))[0].owner_id, users.b.id);
  });
  await test('client-editable user metadata and JWT signature tampering grant no access', async () => {
    await ok(users.none.client.auth.updateUser({ data: { role: 'admin', workspace_id: 'oar', app_metadata: { role: 'admin' } } }));
    assert.deepEqual(await rows('none', 'crm_workspace_state'), []); assert.deepEqual(await rows('none', 'izord_projects'), []);
    await denied(rpc('none', 'izord_create_project', { p_title: 'FORBIDDEN' }));
    const parts = users.none.token.split('.'), claims = JSON.parse(Buffer.from(parts[1], 'base64url')); claims.sub = users.admin.id; claims.role = 'service_role';
    parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const forged = await fetch(`${api}/rest/v1/izord_projects`, { headers: { apikey: publicKey, authorization: `Bearer ${parts.join('.')}` }, redirect: 'error' }); assert.equal(forged.status, 401);
  });
  await test('IZORD create RPC permits admin/partner/contributor and rejects every other role', async () => {
    for (const name of ['anon', 'none', 'pending', 'oar', 'reader', 'revoked']) await denied(rpc(name, 'izord_create_project', { p_title: 'FORBIDDEN' }));
    for (const name of ['admin', 'partner', 'a', 'b', 'both']) {
      const id = await ok(rpc(name, 'izord_create_project', { p_title: `Projet fictif création ${name}` }));
      const row = (await ok(actor(name).from('izord_projects').select('owner_id,revision').eq('id', id)))[0];
      assert.equal(row.owner_id, users[name].id); assert.equal(row.revision, 1);
    }
  });
  await test('reader cannot write and contributor cannot cross a project boundary', async () => {
    for (const name of ['anon', 'none', 'oar', 'reader', 'revoked', 'b']) {
      await denied(rpc(name, 'izord_save_project', { p_id: pa, p_expected_revision: 1, p_title: 'FORBIDDEN', p_payload: {}, p_status: 'draft' }));
      await denied(rpc(name, 'izord_register_asset', { p_project: pa, p_revision: 1, p_kind: 'pdf' }));
      await denied(store(name).upload(`${pa}/${randomUUID()}`, pdf('FORBIDDEN')));
    }
    await denied(rpc('a', 'izord_save_project', { p_id: pb, p_expected_revision: 1, p_title: 'FORBIDDEN', p_payload: {}, p_status: 'draft' }));
    await denied(rpc('a', 'izord_register_asset', { p_project: pb, p_revision: 1, p_kind: 'pdf' }));
    for (const name of ['reader', 'a', 'b', 'partner', 'oar', 'none']) {
      await denied(rpc(name, 'izord_assign_project', { p_project: pb, p_user: users[name].id, p_assigned: true }));
      await denied(rpc(name, 'izord_set_izord_member', { p_user: users[name].id, p_role: 'admin', p_status: 'active' }));
      await denied(rpc(name, 'izord_invite_izord', { p_email: 'no-send@example.invalid', p_role: 'admin' }));
    }
  });
  await test('admin assignment grants then removes contributor access on the next request', async () => {
    await ok(rpc('admin', 'izord_assign_project', { p_project: pb, p_user: users.a.id, p_assigned: true }));
    assert.equal((await ok(users.a.client.from('izord_projects').select('id').eq('id', pb))).length, 1);
    await storedEquals('a', docB, bytesB);
    const changed = await ok(rpc('a', 'izord_save_project', { p_id: pb, p_expected_revision: 1, p_title: 'Projet fictif B assigné', p_payload: { fictitious: true }, p_status: 'draft' })); assert.equal(changed, 2);
    await ok(rpc('admin', 'izord_assign_project', { p_project: pb, p_user: users.a.id, p_assigned: false }));
    assert.deepEqual(await ok(users.a.client.from('izord_projects').select('id').eq('id', pb)), []); await denied(store('a').download(docB));
    await denied(rpc('a', 'izord_save_project', { p_id: pb, p_expected_revision: 2, p_title: 'FORBIDDEN', p_payload: {}, p_status: 'draft' }));
  });
  await test('optimistic revision check permits one concurrent save and preserves immutable history', async () => {
    await denied(rpc('a', 'izord_save_project', { p_id: pa, p_expected_revision: 1, p_title: 'A', p_payload: {}, p_status: 'approved' }));
    const attempts = await Promise.all([rpc('a', 'izord_save_project', { p_id: pa, p_expected_revision: 1, p_title: 'A', p_payload: { scenario: 1 }, p_status: 'review' }), rpc('a', 'izord_save_project', { p_id: pa, p_expected_revision: 1, p_title: 'A', p_payload: { scenario: 2 }, p_status: 'review' })]);
    assert.equal(attempts.filter(r => !r.error).length, 1); assert.equal(attempts.find(r => r.error)?.error.code, '40001');
    assert.equal(await ok(rpc('partner', 'izord_save_project', { p_id: pa, p_expected_revision: 2, p_title: 'A approuvé', p_payload: { reviewed: true }, p_status: 'approved' })), 3);
    await denied(rpc('a', 'izord_save_project', { p_id: pa, p_expected_revision: 3, p_title: 'FORBIDDEN', p_payload: {}, p_status: 'draft' }));
    const versions = await ok(users.a.client.from('izord_project_versions').select('revision,author_id').eq('project_id', pa).order('revision'));
    assert.deepEqual(versions.map(v => v.revision), [1, 2, 3]); assert.equal(versions[2].author_id, users.partner.id);
    await denied(users.admin.client.from('izord_project_versions').update({ payload: { forged: true } }).eq('project_id', pa).select());
  });
  await test('private Storage rejects public URLs, changed paths, overwrite and cross-project delete', async () => {
    for (const bucket of ['crm-documents', 'izord-documents']) {
      const path = bucket === 'crm-documents' ? oarDocument : docB;
      const response = await fetch(`${api}/storage/v1/object/public/${bucket}/${path}`, { redirect: 'error' }); assert.equal(response.ok, false);
    }
    await denied(store('a').upload(`${pb}/${randomUUID()}`, pdf('FORBIDDEN')));
    await denied(store('b').update(docB, pdf('OVERWRITE')));
    await denied(store('b').upload(docB, pdf('UPSERT'), { upsert: true }));
    await denied(store('b').move(docB, `${pb}/${randomUUID()}`));
    await storedEquals('b', docB, bytesB);
    for (const name of ['anon', 'none', 'oar', 'reader', 'a', 'revoked']) { await store(name).remove([docB]); await storedEquals('b', docB, bytesB); }
    const own = await ok(rpc('b', 'izord_register_asset', { p_project: pb, p_revision: 2, p_kind: 'pdf' }));
    await ok(store('b').upload(own, pdf('LOGICAL WITHDRAWAL')));
    await storedEquals('b', own, '%PDF-1.4\nLOGICAL WITHDRAWAL\n%%EOF');
    await denied(store('partner').download(own));
    await ok(rpc('b', 'izord_finalize_asset', { p_asset: assetId(own) }));
    assert.equal((await ok(store('b').remove([own]))).length, 0);
    await ok(rpc('partner', 'izord_withdraw_asset', { p_asset: assetId(own) }));
    await denied(store('b').download(own));
    await denied(store('b').upload(own, pdf('FORBIDDEN PATH REUSE')));
  });
  await test('reader receives only an explicitly published presentation and remains unable to mutate it', async () => {
    await denied(store('reader').download(presentation));
    await denied(rpc('a', 'izord_allow_reader_download', { p_asset: assetId(presentation), p_allowed: true }));
    await ok(rpc('partner', 'izord_allow_reader_download', { p_asset: assetId(presentation), p_allowed: true }));
    assert.equal(await (await ok(store('reader').download(presentation))).text(), 'FICTITIOUS PRESENTATION');
    assert.deepEqual((await ok(store('reader').list(pa))).map(v => v.name), [assetId(presentation)]);
    assert.deepEqual((await rows('reader', 'izord_assets', 'object_path')).map(v => v.object_path), [presentation]);
    await denied(store('reader').download(docA)); await denied(store('reader').download(docB));
    await denied(store('reader').update(presentation, pdf('FORBIDDEN'))); await store('reader').remove([presentation]);
    assert.equal(await (await ok(store('reader').download(presentation))).text(), 'FICTITIOUS PRESENTATION');
    await ok(rpc('partner', 'izord_allow_reader_download', { p_asset: assetId(presentation), p_allowed: false }));
    await denied(store('reader').download(presentation)); assert.deepEqual(await ok(store('reader').list(pa)), []);
  });
  await test('invitation recipient, expiration, revocation, one-time acceptance and role are server enforced', async () => {
    const invite = await ok(rpc('admin', 'izord_invite_izord', { p_email: users.invitee.email, p_role: 'reader' }));
    await denied(rpc('pending', 'izord_accept_invitation', { p_token: invite.token }));
    await sql.query("update public.izord_invitations set expires_at=now()-interval '1 second' where id=$1", [invite.id]);
    await denied(rpc('invitee', 'izord_accept_invitation', { p_token: invite.token }));
    const revoked = await ok(rpc('admin', 'izord_invite_izord', { p_email: users.invitee.email, p_role: 'reader' }));
    await ok(rpc('admin', 'izord_revoke_invitation', { p_id: revoked.id })); await denied(rpc('invitee', 'izord_accept_invitation', { p_token: revoked.token }));
    const valid = await ok(rpc('admin', 'izord_invite_izord', { p_email: users.invitee.email, p_role: 'reader' }));
    await denied(rpc('invitee', 'izord_accept_invitation', { p_token: valid.token, p_role: 'admin' }));
    const attempts = await Promise.all([rpc('invitee', 'izord_accept_invitation', { p_token: valid.token }), rpc('invitee', 'izord_accept_invitation', { p_token: valid.token })]); assert.equal(attempts.filter(r => !r.error).length, 1);
    await denied(rpc('invitee', 'izord_accept_invitation', { p_token: valid.token }));
    const member = await rows('invitee', 'app_memberships', 'workspace_id,role,status'); assert.deepEqual(member, [{ workspace_id: 'izord', role: 'reader', status: 'active' }]);
    await denied(rpc('invitee', 'izord_create_project', { p_title: 'FORBIDDEN' })); assert.deepEqual(await rows('invitee', 'crm_workspace_state'), []);
    const promotion = await ok(rpc('admin', 'izord_invite_izord', { p_email: users.invitee.email, p_role: 'admin' }));
    await denied(rpc('invitee', 'izord_accept_invitation', { p_token: promotion.token }));
    assert.equal((await rows('invitee', 'app_memberships', 'role'))[0].role, 'reader');
  });
  await test('unconfirmed recipient and invitation from a revoked administrator cannot be accepted', async () => {
    const invite = await ok(rpc('admin', 'izord_invite_izord', { p_email: users.pending.email, p_role: 'reader' }));
    await sql.query('update auth.users set email_confirmed_at=null where id=$1', [users.pending.id]);
    await denied(rpc('pending', 'izord_accept_invitation', { p_token: invite.token }));
    await sql.query('update auth.users set email_confirmed_at=now() where id=$1', [users.pending.id]);
    const fromRevoked = await ok(rpc('revoke_admin', 'izord_invite_izord', { p_email: users.pending.email, p_role: 'reader' }));
    await ok(rpc('admin', 'izord_set_izord_member', { p_user: users.revoke_admin.id, p_role: 'admin', p_status: 'revoked' }));
    await denied(rpc('pending', 'izord_accept_invitation', { p_token: fromRevoked.token }));
    await denied(rpc('revoke_admin', 'izord_invite_izord', { p_email: users.pending.email, p_role: 'reader' }));
    assert.equal((await ok(users.revoke_admin.client.auth.getUser(users.revoke_admin.token))).user.id, users.revoke_admin.id);
  });
  await test('IZORD revocation immediately denies REST/RPC/Storage while the original Auth JWT remains valid', async () => {
    const tokenBefore = users.a.token;
    const signed = await ok(store('a').createSignedUrl(docA, 4));
    const signedCreated = Date.now(); assert.equal((await fetch(signed.signedUrl, { redirect: 'error' })).ok, true);
    await ok(rpc('admin', 'izord_set_izord_member', { p_user: users.a.id, p_role: 'contributor', p_status: 'revoked' }));
    assert.equal((await ok(users.a.client.auth.getUser(tokenBefore))).user.id, users.a.id);
    const response = await raw('a', '/rest/v1/izord_projects?select=id'); assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
    assert.deepEqual(await rows('a', 'izord_project_versions'), []); assert.deepEqual(await rows('a', 'izord_assets'), []);
    await denied(rpc('a', 'izord_create_project', { p_title: 'FORBIDDEN' })); await denied(store('a').download(docA)); await denied(store('a').createSignedUrl(docA, 60)); assert.deepEqual(await ok(store('a').list(pa)), []);
    assert.equal(users.a.token, tokenBefore);
    // A previously issued signed URL is a capability until its expiry; revocation cannot revoke downloaded bytes.
    assert.equal((await fetch(signed.signedUrl, { redirect: 'error' })).ok, true);
    await new Promise(r => setTimeout(r, Math.max(0, signedCreated + 6000 - Date.now())));
    assert.equal((await fetch(signed.signedUrl, { redirect: 'error' })).ok, false);
    fixture.signedUrlObservation = { requestedTtlSeconds: 4, accessibleImmediatelyAfterMembershipRevocation: true, inaccessibleAfterSixSeconds: true };
  });
  await test('OAR revocation denies existing owner rows, shared payload, document and registry with unchanged valid JWT', async () => {
    const before = users.revoke_oar.token;
    await sql.query("update public.app_memberships set status='revoked' where user_id=$1 and workspace_id='oar'", [users.revoke_oar.id]);
    assert.equal((await ok(users.revoke_oar.client.auth.getUser(before))).user.id, users.revoke_oar.id);
    assert.deepEqual(await rows('revoke_oar', 'crm_workspace_state'), []);
    for (const table of historical) assert.deepEqual(await rows('revoke_oar', table), []);
    await denied(users.revoke_oar.client.storage.from('crm-documents').download(oarDocument));
    await denied(rpc('revoke_oar', 'crm_drive_folder_claim', { p_workspace_id: 'oneaddress-riviera', p_logical_key: 'vendor:revoked-current', p_parent_id: 'fictional-root', p_lease_token: randomUUID() }));
    assert.equal(users.revoke_oar.token, before);
  });
  await test('Auth invitation is delivered only to the isolated local mail catcher', async () => {
    const recipient = `mail-${randomUUID()}@example.invalid`;
    await ok(admin.auth.admin.inviteUserByEmail(recipient, { redirectTo: app }));
    let caught = false;
    for (let n = 0; n < 30; n++) {
      const response = await fetch(`${mail}/api/v1/messages`, { redirect: 'error' }); assert.equal(response.ok, true);
      if ((await response.text()).includes(recipient)) { caught = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    assert.equal(caught, true, 'Fictitious recipient must appear in the local mail catcher');
  });
  if (reuseExisting) activeTest = 'preservation of prior retained rows and schema';
  const retainedValidation = reuseExisting ? await verifyRetained(sql, retained) : undefined;
  fixture.integrationComplete = true; privateFixture(fixture);
  const report = { passed: log.length, failed: 0, skipped: 0, realLocalAuthJWT: true, realPostgREST: true, realStorageBytes: true, GoogleTransportExercisedHere: false, baseline: 'fictitious minimal historical schema; actual Auth and Storage schemas', reuseExisting, retainedValidation, signedUrlObservation: fixture.signedUrlObservation, tests: log };
  if (process.env.IZORD_ARTIFACTS) { mkdirSync(process.env.IZORD_ARTIFACTS, { recursive: true }); writeFileSync(`${process.env.IZORD_ARTIFACTS}/live-local-results.json`, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed: log.length, failed: 0, skipped: 0, realLocalAuthJWT: true, realPostgREST: true, realStorageBytes: true }));
} catch (error) {
  // Never stringify HTTP/Auth/Storage responses, SQL parameters or credentials in failure reports.
  console.error(`FAIL ${activeTest} (${safeCode(error)})`);
  if (process.env.IZORD_ARTIFACTS) { mkdirSync(process.env.IZORD_ARTIFACTS, { recursive: true }); writeFileSync(`${process.env.IZORD_ARTIFACTS}/live-local-results.json`, JSON.stringify({ passed: log.length, failed: 1, skipped: 0, failure: { test: activeTest, code: safeCode(error) }, tests: log }, null, 2)); }
  process.exitCode = 1;
} finally {
  await sql.end().catch(() => {});
  for (const user of Object.values(users)) user.client.auth.stopAutoRefresh();
  admin.auth.stopAutoRefresh(); anonymous.auth.stopAutoRefresh();
}
