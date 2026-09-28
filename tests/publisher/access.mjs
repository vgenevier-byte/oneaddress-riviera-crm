/** Real, isolated Supabase Auth/PostgREST test of Publisher's module boundary.
 * No provider calls, service-role browser session, real invitation or remote DB.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertPublisherLocalTarget } from './local-target.mjs';

assert.ok(process.env.LOCAL_STATUS_FILE, 'LOCAL_STATUS_FILE required');
assert.ok(process.env.LOCAL_PG_MODULE, 'LOCAL_PG_MODULE required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
assertPublisherLocalTarget(status);
const { Client } = createRequire(import.meta.url)(process.env.LOCAL_PG_MODULE);
const sql = new Client({ connectionString: status.DB_URL });
const password = 'Local-Publisher-2026!';
const checked = [];
async function request(path, token, body, method) {
 const response = await fetch(status.API_URL + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { apikey: status.ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
 const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
 return { status: response.status, data };
}
const rpc = (name, actor, args = {}) => request('/rest/v1/rpc/' + name, actor?.token, args);
const ok = response => { assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response)); return response.data; };
const denied = response => assert.ok(response.status >= 400, JSON.stringify(response));
async function user(name) {
 const email = 'publisher-access-' + name + '@example.invalid';
 let actor = (await sql.query('select id from auth.users where email=$1', [email])).rows[0];
 if (!actor) actor = ok(await request('/auth/v1/admin/users', status.SERVICE_ROLE_KEY, { email, password, email_confirm: true }));
 const session = ok(await request('/auth/v1/token?grant_type=password', null, { email, password }));
 return { id: actor.id, email, token: session.access_token };
}
async function save(actor, grants, options = {}) {
 const current = (await sql.query('select revision from public.crm_access_profiles where user_id=$1', [actor.id])).rows[0];
 return rpc('crm_admin_save', admin, { p_user: actor.id, p_revision: Number(current?.revision ?? 0), p_active: options.active ?? true, p_general_admin: options.admin ?? false, p_grants: grants, p_izord_role: options.izordRole ?? null, p_assignments: [] });
}
const grant = (level, sensitive = {}) => ({ publisher: { level, sensitive } });
async function test(name, action) {
 if (process.argv.includes('--boundary-only') && !name.startsWith('Publisher-only')) return;
 await action(); checked.push(name); console.log('PASS ' + name);
}
const actions = ['session', 'today', 'history', 'status', 'image', 'export', 'generate', 'regenerate-text', 'regenerate-image', 'publish', 'music-status', 'export-text', 'delete', 'unknown', null];
const readActions = actions.slice(0, 5);
let admin;
await sql.connect();
try {
 assert.equal(Number((await sql.query("select count(*) n from auth.users where email is null or email not like '%@example.invalid'")).rows[0].n), 0, 'Only fictitious identities may be modified');
 admin = await user('administrator');
 await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,true,true) on conflict(user_id) do update set active=true,general_admin=true,revision=crm_access_profiles.revision+1', [admin.id]);
 const matrix = await user('matrix');
 const baseline = (await sql.query('select coalesce(jsonb_agg(to_jsonb(w)),\'[]\') as rows from public.crm_workspace_state w')).rows[0].rows;
 await test('anonymous and invalid Auth tokens cannot invoke the Publisher authority', async () => {
  denied(await rpc('crm_authorize_publisher', null, { p_action: 'today' }));
  denied(await rpc('crm_authorize_publisher', { token: 'invalid-token' }, { p_action: 'today' }));
 });
 await test('administrator of permissions receives no Publisher content implicitly', async () => {
  ok(await save(admin, {}, { admin: true }));
  ok(await rpc('crm_admin_users', admin));
  for (const action of actions) assert.equal(ok(await rpc('crm_authorize_publisher', admin, { p_action: action })), false);
 });
 await test('live none/read/contribute/sensitive permission matrix and unknown/null denial', async () => {
  for (const [level, sensitive, expected] of [
   ['none', {}, []], ['read', {}, readActions], ['read', { export: true }, [...readActions, 'export', 'export-text']],
   ['contribute', {}, [...readActions, 'music-status']],
   ['contribute', { generate: true }, [...readActions, 'music-status', 'generate', 'regenerate-text', 'regenerate-image']],
   ['contribute', { export: true, generate: true, mark_published: true }, actions.slice(0, 12)]
  ]) {
   ok(await save(matrix, grant(level, sensitive)));
   for (const action of actions) assert.equal(ok(await rpc('crm_authorize_publisher', matrix, { p_action: action })), expected.includes(action), `${level}: ${action}`);
  }
 });
 await test('Publisher-only receives no OAR/IZORD membership, payload, REST, RPC or storage right', async () => {
  ok(await save(matrix, grant('contribute', { generate: true, export: true, mark_published: true })));
  assert.deepEqual(ok(await request('/rest/v1/app_memberships?select=workspace_id', matrix.token)), []);
  const access = ok(await rpc('crm_access_snapshot', matrix));
  assert.equal(access.fullAccess, false); assert.equal(access.generalAdmin, false); assert.deepEqual(Object.keys(access.modules), ['publisher']);
  for (const table of ['crm_workspace_state', 'crm_contacts', 'izord_projects', 'izord_project_versions', 'izord_assets']) {
   const response = await request('/rest/v1/' + table + '?select=*', matrix.token);
   if (response.status < 400) assert.deepEqual(response.data, []);
  }
  denied(await rpc('crm_read_module', matrix, { p_module: 'contacts' }));
  denied(await rpc('crm_mutate_record', matrix, { p_module: 'contacts', p_collection: 'contacts', p_id: 'forbidden-publisher-write', p_patch: { name: 'Forbidden' }, p_revision: 'invalid', p_delete: false }));
  denied(await request('/rest/v1/crm_workspace_state', matrix.token, { workspace_id: 'forbidden-publisher-workspace', payload: {} }));
  denied(await rpc('crm_admin_users', matrix));
  denied(await rpc('izord_create_project', matrix, { p_title: 'Forbidden Publisher creation' }));
  for (const bucket of ['crm-documents', 'izord-documents']) {
   const listing = await request('/storage/v1/object/list/' + bucket, matrix.token, { prefix: '', limit: 10, offset: 0 });
   if (listing.status < 400) assert.deepEqual(listing.data, []);
   denied(await request('/storage/v1/object/' + bucket + '/publisher-access-forbidden.txt', matrix.token, { forbidden: true }));
  }
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures.private.json', 'file://' + process.env.LOCAL_STATUS_FILE), 'utf8'));
  assert.ok(fixtures.boundaries?.project && fixtures.boundaries?.files, 'Existing protected rows and objects required');
  const owner = fixtures.users.admin;
  const ownerSession = ok(await request('/auth/v1/token?grant_type=password', null, { email: owner.email, password: owner.password }));
  const projectPath = '/rest/v1/izord_projects?select=id&id=eq.' + fixtures.boundaries.project;
  assert.equal(ok(await request(projectPath, ownerSession.access_token)).length, 1, 'Authorized actor sees the existing project');
  assert.deepEqual(ok(await request(projectPath, matrix.token)), []);
  for (const file of Object.values(fixtures.boundaries.files)) {
   const object = '/' + file.bucket + '/' + file.path;
   assert.equal(ok(await request('/storage/v1/object/authenticated' + object, ownerSession.access_token)), file.content, 'Authorized actor reads the actual protected bytes');
   denied(await request('/storage/v1/object/authenticated' + object, matrix.token));
   denied(await request('/storage/v1/object/sign' + object, matrix.token, { expiresIn: 60 }));
  }
 });
 await test('client metadata and browser role cannot self-grant permissions', async () => {
  ok(await save(matrix, {}));
  ok(await request('/auth/v1/user', matrix.token, { data: { publisher: 'admin', role: 'admin', general_admin: true } }, 'PUT'));
  assert.equal(ok(await rpc('crm_authorize_publisher', matrix, { p_action: 'generate' })), false);
  denied(await request('/rest/v1/crm_module_grants', matrix.token, { user_id: matrix.id, module: 'publisher', level: 'contribute', sensitive: { generate: true } }));
  denied(await rpc('crm_admin_save', matrix, { p_user: matrix.id, p_revision: 0, p_active: true, p_general_admin: true, p_grants: grant('contribute', { generate: true }), p_izord_role: null, p_assignments: [] }));
 });
 await test('current revocation applies to an already issued Auth token', async () => {
  ok(await save(matrix, grant('contribute', { generate: true, export: true, mark_published: true })));
  ok(await save(matrix, grant('contribute', { generate: true, export: true, mark_published: true }), { active: false }));
  for (const action of actions) assert.equal(ok(await rpc('crm_authorize_publisher', matrix, { p_action: action })), false);
  assert.deepEqual(ok(await rpc('crm_access_snapshot', matrix)).modules, {});
 });
 await test('sign-out invalidates an unexpired bearer at the Publisher server boundary', async () => {
  const signedOut = await user('signed-out');
  ok(await save(signedOut, grant('read')));
  assert.equal(ok(await rpc('crm_authorize_publisher', signedOut, { p_action: 'today' })), true);
  ok(await request('/auth/v1/logout', signedOut.token, {}));
  const reply = await rpc('crm_authorize_publisher', signedOut, { p_action: 'today' });
  if (reply.status < 400) assert.equal(reply.data, false);
 });
 await test('invalid/null levels and module-specific sensitive grants are rejected', async () => {
  for (const grants of [grant(null), grant('owner'), grant('read', { generate: true }), grant('read', { mark_published: true }), grant('none', { export: true }), grant('contribute', { delete: true }), grant('contribute', { bank_read: false }), grant('contribute', { generate: 'true' }), { contacts: { level: 'contribute', sensitive: { generate: true } } }, { tasks: { level: 'read', sensitive: { mark_published: false } } }, null]) denied(await save(matrix, grants));
 });
 await test('OAR fullAccess remains true with Publisher absent, none or read', async () => {
  const modules = ['dashboard', 'contacts', 'leads', 'tasks', 'quotes', 'bookings', 'vendorQuotes', 'vendorInvoices', 'houseTracking', 'documents', 'planning', 'properties', 'vehicles', 'boats'];
  const grants = Object.fromEntries(modules.map(module => [module, { level: 'contribute', sensitive: { delete: true, export: true, ...(module === 'contacts' ? { bank_read: true, bank_write: true } : {}), ...(module === 'vendorInvoices' ? { payment: true } : {}) } }]));
  for (const publisher of [undefined, { level: 'none', sensitive: {} }, { level: 'read', sensitive: {} }]) {
   ok(await save(admin, { ...grants, ...(publisher ? { publisher } : {}) }, { admin: true }));
   assert.equal(ok(await rpc('crm_access_snapshot', admin)).fullAccess, true);
   assert.equal(ok(await rpc('crm_authorize_publisher', admin, { p_action: 'today' })), publisher?.level === 'read');
   assert.equal(ok(await rpc('crm_authorize_publisher', admin, { p_action: 'generate' })), false);
  }
 });
 await test('IZORD membership and module never imply Publisher access', async () => {
  const izord = await user('izord-only');
  ok(await save(izord, { izord: { level: 'read', sensitive: {} } }, { izordRole: 'reader' }));
  const snapshot = ok(await rpc('crm_access_snapshot', izord));
  assert.deepEqual(Object.keys(snapshot.modules), ['izord']);
  for (const action of actions) assert.equal(ok(await rpc('crm_authorize_publisher', izord, { p_action: action })), false);
 });
 await test('invitation defaults grant no Publisher and explicit Publisher invitation creates no OAR membership', async () => {
  const recipient = await user('invitation');
  ok(await save(recipient, {}));
  const prepared = ok(await rpc('crm_invite_prepare', admin, { p_email: recipient.email, p_grants: grant('read'), p_izord_role: null, p_assignments: [] }));
  assert.equal(ok(await rpc('crm_authorize_publisher', recipient, { p_action: 'today' })), false);
  ok(await rpc('crm_invite_accept', recipient, { p_token: prepared.token }));
  assert.equal(ok(await rpc('crm_authorize_publisher', recipient, { p_action: 'today' })), true);
  assert.deepEqual(ok(await request('/rest/v1/app_memberships?select=workspace_id', recipient.token)), []);
  const other = await user('invitation-empty'); ok(await save(other, {}));
  const empty = ok(await rpc('crm_invite_prepare', admin, { p_email: other.email, p_grants: {}, p_izord_role: null, p_assignments: [] }));
  ok(await rpc('crm_invite_accept', other, { p_token: empty.token }));
  assert.deepEqual(ok(await rpc('crm_access_snapshot', other)).modules, {});
 });
 await test('permission revision conflicts preserve the saved grant', async () => {
  ok(await save(matrix, grant('read')));
  const access = ok(await rpc('crm_access_snapshot', matrix));
  ok(await save(matrix, grant('contribute')));
  const conflict = await rpc('crm_admin_save', admin, { p_user: matrix.id, p_revision: access.revision, p_active: true, p_general_admin: false, p_grants: grant('read'), p_izord_role: null, p_assignments: [] });
  denied(conflict); assert.equal(conflict.data.code, '40001');
  assert.equal(ok(await rpc('crm_access_snapshot', matrix)).modules.publisher.level, 'contribute');
 });
 await test('business workspace unchanged by all access checks', async () => {
  assert.deepEqual((await sql.query('select coalesce(jsonb_agg(to_jsonb(w)),\'[]\') as rows from public.crm_workspace_state w')).rows[0].rows, baseline);
 });
 console.log(JSON.stringify({ authenticatedLocalTests: checked.length, providerCalls: 0, invitationEmails: 0, passed: checked }));
} finally { await sql.end(); }
