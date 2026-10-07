/** Bounded Administration history, using real fictional Auth/HTTP RPC on the
 * preserved disposable loopback bench. No Production, reset, invitation email,
 * existing-data rewrite or migration-history repair is permitted.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { assertAdminSimplificationTarget } from './admin-simplification-target.mjs';

const migrationFile = 'supabase/migrations/20261007171153_tasks_admin_history_pagination.sql';
const source = readFileSync(migrationFile, 'utf8');
const fixture = JSON.parse(readFileSync(process.env.TASKS_FIXTURE_FILE || '/private/tmp/oar-tasks-fixture.private.json', 'utf8'));
const status = JSON.parse(readFileSync(process.env.TASKS_STATUS_FILE || fixture.statusFile, 'utf8'));
assertAdminSimplificationTarget({ api: status.API_URL, database: status.DB_URL, acknowledgement: process.env.TASKS_TEST_ACK });
for (const user of Object.values(fixture.users)) assert.match(user.email, /@example\.invalid$/);
const sql = new Client({ connectionString: status.DB_URL });
await sql.connect();
const run = randomUUID(), users = {}, eventIds = [], results = [];
const output = process.env.TASKS_HISTORY_RESULTS || '/private/tmp/oar-tasks-admin-history-database-results.json';
const signature = 'public.crm_admin_history_page(bigint,bigint,integer)';
const tables = {
  'public.crm_workspace_state': 'workspace_id', 'public.crm_backups': 'id', 'public.crm_tasks': 'id',
  'public.crm_document_scopes': 'provider,resource_id', 'public.crm_document_shares': 'provider,resource_id,user_id',
  'public.crm_permission_events': 'id', 'app_private.task_transition_backup': 'source',
  'app_private.task_legacy_archive': 'source,task_id', 'app_private.task_records': 'id',
  'app_private.task_assignments': 'task_id,user_id', 'app_private.task_events': 'id',
  'app_private.task_requests': 'actor_id,request_id', 'app_private.task_identity_links': 'user_id',
  'public.crm_access_profiles': 'user_id', 'public.crm_module_grants': 'user_id,module',
  'public.app_memberships': 'user_id,workspace_id', 'public.crm_access_invitations': 'id',
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const selected = (table, order) => sql.query('select * from ' + table + ' order by ' + order).then(r => r.rows);
const capture = async () => Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([table, order]) => [table, await selected(table, order)])));
const functions = async () => (await sql.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
  pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('app_private','public') and p.prokind='f' and p.proname<>'crm_admin_history_page'
  order by n.nspname,p.proname,args`)).rows;
const policies = async () => (await sql.query(`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
  from pg_policies where schemaname in ('app_private','public') order by schemaname,tablename,policyname`)).rows;
const before = await capture(), oldFunctions = await functions(), oldPolicies = await policies();
const existingIds = (await sql.query('select id from auth.users')).rows.map(x => x.id);

async function request(path, user, body, method) {
  const response = await fetch(status.API_URL + path, {
    method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'error',
    headers: { apikey: status.ANON_KEY, ...(user?.token ? { Authorization: 'Bearer ' + user.token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data; };
const rejected = (response, code = '42501') => {
  assert(response.status >= 400, JSON.stringify(response)); assert.equal(response.data.code, code, JSON.stringify(response.data));
};
const rpc = (user, args = {}) => request('/rest/v1/rpc/crm_admin_history_page', user, args);
const login = async user => {
  user.token = ok(await request('/auth/v1/token?grant_type=password', null, { email: user.email, password: user.password })).access_token;
  return user;
};
async function provision(key, admin) {
  const email = 'history-' + key + '-' + run + '@example.invalid';
  const password = 'Fictional-Local-History-2026!';
  const user = ok(await request('/auth/v1/admin/users', { token: status.SERVICE_ROLE_KEY }, {
    email, password, email_confirm: true, user_metadata: { general_admin: true, verified_owner: true },
  }));
  users[key] = { id: user.id, email, password };
  await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,true,$2)', [user.id, admin]);
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'oar','member','active')", [user.id]);
  // Deliberately no Tasks grant: Administration must remain independent.
  return login(users[key]);
}
async function seed(count) {
  const ids = (await sql.query(`insert into public.crm_permission_events(actor_id,subject_id,action,detail,created_at)
    select $1::uuid,null,$2::text,jsonb_build_object('privateSentinel',$3::text,'email','private@example.invalid'),
      '2026-10-07T10:00:00Z'::timestamptz from generate_series(1,$4::integer) returning id::text`,
  [users.admin.id, 'history-fixture-' + run, 'not-exposed-' + run, count])).rows.map(x => x.id);
  eventIds.push(...ids); return ids;
}
const checkProjection = page => {
  assert.deepEqual(Object.keys(page).sort(), ['events', 'hasMore', 'nextCursor']);
  assert.equal(typeof page.hasMore, 'boolean');
  for (const event of page.events) {
    assert.deepEqual(Object.keys(event).sort(), ['action', 'actor_id', 'created_at', 'id', 'subject_id']);
    assert.match(event.id, /^[1-9]\d*$/); assert.equal(typeof event.created_at, 'string');
    assert.equal(typeof event.action, 'string'); assert.equal(typeof event.actor_id, 'string');
    assert(event.subject_id === null || typeof event.subject_id === 'string');
  }
  for (let index = 1; index < page.events.length; index++) assert(BigInt(page.events[index - 1].id) > BigInt(page.events[index].id));
  if (page.hasMore) {
    assert.deepEqual(Object.keys(page.nextCursor).sort(), ['beforeId', 'snapshotId']);
    assert.match(page.nextCursor.beforeId, /^[1-9]\d*$/); assert.match(page.nextCursor.snapshotId, /^[1-9]\d*$/);
    assert.equal(page.nextCursor.beforeId, page.events.at(-1).id);
  } else assert.equal(page.nextCursor, null);
  assert(!JSON.stringify(page).includes('not-exposed-')); assert(!JSON.stringify(page).includes('private@example.invalid'));
};
const test = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); };
let cleanupComplete = false;
try {
  const exists = (await sql.query('select to_regprocedure($1) is not null present', [signature])).rows[0].present;
  if (!exists) { await sql.query(source); await sql.query("notify pgrst, 'reload schema'"); }
  const body = source.match(/as \$\$([\s\S]*?)\$\$;/)[1];
  assert.equal((await sql.query('select prosrc from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosrc, body);
  assert.deepEqual(await capture(), before, 'Migration changed existing data');
  assert.deepEqual(await functions(), oldFunctions, 'Migration changed an existing function or its privileges');
  assert.deepEqual(await policies(), oldPolicies, 'Migration changed an existing policy');
  await provision('admin', true); await provision('member', false); await provision('revoked', true);
  await login(fixture.users.creator); await login(fixture.users.fullOther);

  await test('new function ACL, exact body and existing permission boundaries', async () => {
    const row = (await sql.query(`select p.provolatile,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') anon,
      has_function_privilege('authenticated',p.oid,'execute') authenticated,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public
      from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0];
    assert.deepEqual(row, { provolatile: 's', prosecdef: true, proconfig: ['search_path=pg_catalog'], anon: false, authenticated: true, public: false });
    assert.equal((await sql.query("select count(*)::int n from public.crm_module_grants where user_id=$1 and module='tasks'", [users.admin.id])).rows[0].n, 0);
    rejected(await rpc(users.member)); rejected(await rpc(null));
    rejected(await request('/rest/v1/rpc/crm_tasks_read', users.admin, {}));
    rejected(await request('/rest/v1/rpc/crm_tasks_directory', users.admin, {}));
  });
  await test('0, 1, 3 and 4 event page boundaries with stable ID ordering', async () => {
    // Empty initial history is available on the preserved bench. If the bench
    // already contains history, the strict lower bound tests the same empty tail.
    let page = ok(await rpc(users.admin)); checkProjection(page);
    if (!before['public.crm_permission_events'].length) assert.deepEqual(page, { events: [], hasMore: false, nextCursor: null });
    else {
      const ids = (await sql.query('select e.id::text from public.crm_permission_events e order by e.id')).rows.map(x => x.id);
      page = ok(await rpc(users.admin, { p_before_id: ids[0], p_snapshot_id: ids.at(-1) }));
      assert.deepEqual(page, { events: [], hasMore: false, nextCursor: null });
    }
    const initialCount = before['public.crm_permission_events'].length;
    for (const [added, count] of [[1, 1], [2, 3], [1, 4]]) {
      await seed(added);
      const ids = (await sql.query('select e.id::text from public.crm_permission_events e order by e.id')).rows.map(x => x.id);
      const args = initialCount ? { p_before_id: ids[count], p_snapshot_id: ids.at(-1), p_limit: 3 } : { p_limit: 3 };
      page = ok(await rpc(users.admin, args)); checkProjection(page);
      assert.equal(page.events.length, Math.min(count, 3)); assert.equal(page.hasMore, count > 3);
      if (count > 3) {
        const next = ok(await rpc(users.admin, { p_before_id: page.nextCursor.beforeId, p_snapshot_id: page.nextCursor.snapshotId, p_limit: 3 }));
        checkProjection(next); assert.equal(next.events.length, 1); assert.equal(next.hasMore, false);
      }
    }
  });
  await test('more than 100 events, complete pages and exclusion of later concurrent inserts', async () => {
    await seed(130);
    const expected = (await sql.query('select e.id::text from public.crm_permission_events e order by e.id desc')).rows.map(x => x.id);
    let page = ok(await rpc(users.admin)); checkProjection(page); assert.equal(page.events.length, 50);
    const anchor = page.nextCursor.snapshotId, all = [...page.events.map(x => x.id)];
    const concurrent = new Client({ connectionString: status.DB_URL }); await concurrent.connect();
    try {
      const inserted = (await concurrent.query(`insert into public.crm_permission_events(actor_id,action,detail)
        values($1,$2,'{"privateSentinel":"concurrent"}') returning id::text`, [users.admin.id, 'history-concurrent-' + run])).rows[0].id;
      eventIds.push(inserted); assert(BigInt(inserted) > BigInt(anchor));
      while (page.hasMore) {
        page = ok(await rpc(users.admin, { p_before_id: page.nextCursor.beforeId, p_snapshot_id: page.nextCursor.snapshotId }));
        checkProjection(page); assert(page.events.length <= 50); all.push(...page.events.map(x => x.id));
      }
      assert.deepEqual(all, expected); assert.equal(new Set(all).size, all.length); assert(!all.includes(inserted));
    } finally { await concurrent.end(); }
    page = ok(await rpc(users.admin, { p_limit: 100 })); checkProjection(page); assert.equal(page.events.length, 100);
    const old = ok(await request('/rest/v1/rpc/crm_admin_users', fixture.users.creator, {}));
    assert.equal(old.history.length, 100, 'Existing crm_admin_users retains its 100-event contract');
    assert(Object.hasOwn(old.history[0], 'detail'), 'Existing RPC projection was modified');
  });
  await test('invalid limits and incomplete, nonpositive or impossible cursors rejected', async () => {
    for (const limit of [null, 0, -1, 101]) rejected(await rpc(users.admin, { p_limit: limit }), '22023');
    const [minimum, maximum] = (await sql.query('select min(id)::text low,max(id)::text high from public.crm_permission_events')).rows.map(x => [x.low, x.high])[0];
    for (const args of [
      { p_before_id: minimum }, { p_snapshot_id: maximum },
      { p_before_id: '0', p_snapshot_id: maximum }, { p_before_id: '-1', p_snapshot_id: maximum },
      { p_before_id: maximum, p_snapshot_id: minimum },
      { p_before_id: minimum, p_snapshot_id: (BigInt(maximum) + 1000000n).toString() },
    ]) rejected(await rpc(users.admin, args), '22023');
  });
  await test('bigint event and cursor identifiers remain precise decimal strings', async () => {
    const id = '9007199254741017';
    assert.equal((await sql.query('select count(*)::int n from public.crm_permission_events where id=$1', [id])).rows[0].n, 0);
    await sql.query(`insert into public.crm_permission_events(id,actor_id,action) overriding system value values($1,$2,$3)`, [id, users.admin.id, 'history-bigint-' + run]);
    eventIds.push(id);
    const page = ok(await rpc(users.admin, { p_limit: 1 })); checkProjection(page);
    assert.equal(page.events[0].id, id); assert.equal(page.nextCursor.beforeId, id); assert.equal(page.nextCursor.snapshotId, id);
    const next = ok(await rpc(users.admin, { p_before_id: page.nextCursor.beforeId, p_snapshot_id: page.nextCursor.snapshotId, p_limit: 1 }));
    checkProjection(next); assert(BigInt(next.events[0].id) < BigInt(id));
  });
  await test('real Auth signout and expired, inactive, banned or anonymous sessions rejected', async () => {
    const signed = users.revoked.token;
    assert.equal((await request('/auth/v1/logout', users.revoked, {}, 'POST')).status, 204);
    rejected(await rpc({ token: signed }));
    const sessionId = JSON.parse(Buffer.from(users.admin.token.split('.')[1], 'base64url').toString()).session_id;
    const original = (await sql.query('select not_after from auth.sessions where id=$1 and user_id=$2', [sessionId, users.admin.id])).rows[0].not_after;
    try {
      await sql.query("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1 and user_id=$2", [sessionId, users.admin.id]);
      rejected(await rpc(users.admin));
    } finally { await sql.query('update auth.sessions set not_after=$2 where id=$1 and user_id=$3', [sessionId, original, users.admin.id]); }
    try { await sql.query('update public.crm_access_profiles set active=false where user_id=$1', [users.admin.id]); rejected(await rpc(users.admin)); }
    finally { await sql.query('update public.crm_access_profiles set active=true where user_id=$1', [users.admin.id]); }
    try { await sql.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [users.admin.id]); rejected(await rpc(users.admin)); }
    finally { await sql.query('update auth.users set banned_until=null where id=$1', [users.admin.id]); }
    try { await sql.query('update auth.users set is_anonymous=true where id=$1', [users.admin.id]); rejected(await rpc(users.admin)); }
    finally { await sql.query('update auth.users set is_anonymous=false where id=$1', [users.admin.id]); }
    checkProjection(ok(await rpc(users.admin)));
  });
  await test('history reads preserve data and permissions; private Tasks remain participant-only', async () => {
    const prior = await capture();
    checkProjection(ok(await rpc(users.admin)));
    checkProjection(ok(await rpc(fixture.users.creator)));
    rejected(await rpc(users.member));
    const privateTask = (await sql.query(`select t.id from app_private.task_records t where t.deleted_at is null and t.creator_id is distinct from $1
      and not exists(select 1 from app_private.task_assignments a where a.task_id=t.id and a.user_id=$1 and a.removed_at is null) limit 1`, [fixture.users.fullOther.id])).rows[0];
    assert(privateTask, 'Existing nonparticipant task fixture required');
    const nonparticipant = await request('/rest/v1/rpc/crm_tasks_read', fixture.users.fullOther, { p_id: privateTask.id });
    assert(nonparticipant.status >= 400 || (nonparticipant.status === 200 && nonparticipant.data.length === 0), 'General admin accessed nonparticipant Tasks');
    assert.deepEqual(await capture(), prior, 'Read-only RPC changed data or rights');
    assert.deepEqual(await functions(), oldFunctions, 'Existing functions/Tasks guard changed');
    assert.deepEqual(await policies(), oldPolicies, 'Existing policies/Tasks privacy changed');
  });
} finally {
  // Only fixture IDs and accounts created by this run are removed. Existing
  // history, Tasks, rights and the historical migration ledger stay untouched.
  if (eventIds.length) await sql.query('delete from public.crm_permission_events where id=any($1::bigint[]) and actor_id=$2', [eventIds, users.admin.id]);
  for (const user of Object.values(users)) {
    await sql.query('delete from public.crm_module_grants where user_id=$1', [user.id]);
    await sql.query('delete from public.app_memberships where user_id=$1', [user.id]);
    await sql.query('delete from public.crm_access_profiles where user_id=$1', [user.id]);
    const response = await request('/auth/v1/admin/users/' + user.id, { token: status.SERVICE_ROLE_KEY }, undefined, 'DELETE');
    assert.equal(response.status, 200, 'Local fictional Auth cleanup failed');
  }
  assert.deepEqual((await sql.query('select id from auth.users order by id')).rows.map(x => x.id), existingIds.sort(), 'Existing Auth identities changed');
  const after = await capture(), preserved = {};
  for (const table of Object.keys(tables)) {
    assert.deepEqual(after[table], before[table], 'Existing data changed: ' + table);
    preserved[table] = { rows: before[table].length, sha256: hash(before[table]), unchanged: true };
  }
  assert.deepEqual(await functions(), oldFunctions); assert.deepEqual(await policies(), oldPolicies);
  cleanupComplete = true;
  writeFileSync(output, JSON.stringify({ passed: results.length === 7 && results.every(x => x.passed), results,
    actualLocalAuth: true, actualLocalRpc: true, disposableLoopbackOnly: true, productionQueries: 0,
    externalCalls: 0, cleanupComplete, migrationFile, migrationSha256: createHash('sha256').update(source).digest('hex'),
    preserved, existingFunctionDefinitionsAndAclsUnchanged: true, existingPoliciesUnchanged: true }, null, 2) + '\n', { mode: 0o600 });
  await sql.end();
}
assert.equal(results.length, 7); assert(cleanupComplete);
console.log('Local history database suite complete; cleanup verified. Results: ' + output);
