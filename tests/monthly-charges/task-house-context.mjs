/** Genuine isolated Auth/HTTP RPC/PostgreSQL task context checks. No Production target. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
const fixtureFile = process.env.TASK_LINKS_FIXTURE || '/private/tmp/oar-task-links-bench/fixture.private.json';
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
const status = JSON.parse(readFileSync(fixture.statusFile, 'utf8'));
assert.equal(process.env.TASK_LINKS_ACK, 'TASK_LINKS_DISPOSABLE_LOCAL_ONLY');
assert.equal(status.API_URL, 'http://127.0.0.1:55931');
assert.equal(new URL(status.DB_URL).hostname, '127.0.0.1');
assert.equal(new URL(status.DB_URL).port, '55932');
const sql = new Client({ connectionString: status.DB_URL });
await sql.connect();
const results = [], run = randomUUID();
let task, oldHouseGrant;
const ref = { type: 'monthly_charges', id: '2026-09', context: { source: 'invoice', houseId: fixture.fixture.houseTrackingHouses[0].id, personId: fixture.fixture.vendorInvoices[0].contactId } };
async function login(user) {
  const result = await fetch(status.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: status.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: fixture.password }) });
  assert.equal(result.status, 200, 'Fresh real local Auth login');
  return { ...user, token: (await result.json()).access_token };
}
async function rpc(name, user, args = {}) {
  const response = await fetch(status.API_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  return { status: response.status, data: await response.json() };
}
const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); };
try {
  assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count), 0, 'Every Auth identity is fictional');
  if (process.env.TASK_CHARGE_SQL) await sql.query(readFileSync(process.env.TASK_CHARGE_SQL, 'utf8'));
  oldHouseGrant = (await sql.query("select level,sensitive from public.crm_module_grants where user_id=$1 and module='houseTracking'", [fixture.users.author.id])).rows[0];
  const author = await login(fixture.users.author), restricted = await login(fixture.users.restricted);
  await check('invoice and legacy hours monthly refs normalize with exact month, house and source identities', async () => {
    const normalized = (await sql.query('select app_private.task_target_ref($1::jsonb) ref', [ref])).rows[0].ref;
    assert.deepEqual(normalized, ref);
    const hours = { ...ref, context: { source: 'hours', houseId: ref.context.houseId, personId: fixture.fixture.houseTrackingWorkers[0].id } };
    assert.deepEqual((await sql.query('select app_private.task_target_ref($1::jsonb) ref', [hours])).rows[0].ref, hours);
    const targets = ok(await rpc('crm_task_targets_resolve', author, { p_refs: [ref, hours] }));
    assert.equal(targets[0].state, 'available'); assert.equal(targets[1].state, 'available');
    assert.deepEqual(targets[0].ref, ref); assert(targets[0].detail.includes(fixture.fixture.houseTrackingHouses[0].name));
  });
  await check('canonical task mutation persists invoice-house month and a new login retrieves exact context and inverse link', async () => {
    task = ok(await rpc('crm_tasks_mutate', author, { p_request_id: randomUUID(), p_id: 'charges-context-' + run, p_revision: null, p_patch: { title: 'Vérifier septembre fictif', assigneeIds: [fixture.users.restricted.id], linkChanges: { add: [ref], primary: { target: ref } } } }));
    const fresh = await login(fixture.users.author), loaded = ok(await rpc('crm_tasks_read', fresh, { p_id: task.id }))[0];
    assert.deepEqual(loaded.links[0].target, ref); assert.equal(loaded.links[0].primary, true);
    assert(ok(await rpc('crm_tasks_for_target', fresh, { p_ref: ref })).some(item => item.id === task.id));
    assert.equal((await sql.query('select target from app_private.task_links where task_id=$1', [task.id])).rows[0].target.id, '2026-09');
  });
  await check('restricted assignee sees opaque relation and an authorized note edit preserves it', async () => {
    const loaded = ok(await rpc('crm_tasks_read', restricted, { p_id: task.id }))[0];
    assert.equal(loaded.links[0].state, 'inaccessible'); assert.equal(loaded.links[0].target, undefined);
    const before = (await sql.query('select id,target,is_primary from app_private.task_links where task_id=$1', [task.id])).rows;
    ok(await rpc('crm_tasks_mutate', restricted, { p_request_id: randomUUID(), p_id: task.id, p_revision: loaded.revision, p_patch: { notes: 'Note fictive autorisée' } }));
    assert.deepEqual((await sql.query('select id,target,is_primary from app_private.task_links where task_id=$1', [task.id])).rows, before);
  });
  await check('invoice-house target export needs house export while ordinary authorized read remains available', async () => {
    await sql.query("update public.crm_module_grants set sensitive=jsonb_set(sensitive,'{export}','false') where user_id=$1 and module='houseTracking'", [author.id]);
    assert.equal(ok(await rpc('crm_task_targets_resolve', author, { p_refs: [ref] }))[0].state, 'available');
    const exported = ok(await rpc('crm_tasks_export', author)).find(item => item.id === task.id);
    assert.equal(exported.links[0].state, 'inaccessible'); assert.equal(exported.links[0].target, undefined);
  });
  await check('invoice-house monthly relation is masked after house read revocation and its storage is preserved', async () => {
    await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='houseTracking'", [author.id]);
    assert.deepEqual(ok(await rpc('crm_task_targets_resolve', author, { p_refs: [ref] })), [{ state: 'inaccessible' }]);
    assert.deepEqual((await sql.query('select target from app_private.task_links where task_id=$1', [task.id])).rows[0].target, ref);
    const invoiceOnly = { ...ref, context: { source: 'invoice', personId: ref.context.personId } };
    assert.equal(ok(await rpc('crm_task_targets_resolve', author, { p_refs: [invoiceOnly] }))[0].state, 'available');
  });
} finally {
  if (oldHouseGrant) await sql.query("update public.crm_module_grants set level=$2,sensitive=$3 where user_id=$1 and module='houseTracking'", [fixture.users.author.id, oldHouseGrant.level, oldHouseGrant.sensitive]);
  const output = process.env.TASK_CHARGES_EVIDENCE || '/private/tmp/charges-task-evidence'; mkdirSync(output, { recursive: true });
  writeFileSync(output + '/task-context-results.json', JSON.stringify({ realAuth: true, realHTTPRPC: true, realPostgres: true, fictional: true, taskId: task?.id, results }, null, 2));
  await sql.end();
}
