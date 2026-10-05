/** Actual local Auth JWT -> PostgREST -> scoped RPC tests. No fake JWT/role substitution. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, request, rpc, read, login, directory } from './server-local.mjs';

const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const users = fixture.users, results = [];
await connect();
for (const user of Object.values(users)) user.token = await login(user);
const baseline = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const token = who => users[who].token;
async function allowed(operation) { const result = await operation; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; }
async function denied(operation, code) { const result = await operation; assert.ok(result.status >= 400, 'Forbidden direct request must fail'); if (code) assert.equal(result.data.message, code); return result.data; }
async function test(name, operation) { await operation(); results.push({ name, passed: true }); console.log('PASS ' + name); }
const patch = (who, revision, p_patch, requestId = randomUUID()) => rpc('crm_patch_monthly_charges', token(who), { p_revision: revision, p_patch, p_request_id: requestId });
const selection = { personRules: [{ source: 'invoice', personId: 'vendor-september', included: true }, { source: 'hours', personId: 'worker-september', included: true }] };
let originalConfig;
try {
  originalConfig = (await sql.query('select * from app_private.monthly_charges_config')).rows[0];
  await test('anonymous and accounts without Charges cannot call direct reads or patches', async () => {
    for (const who of [null, 'none', 'invoiceOnly', 'publisherOnly', 'legacyOwner']) {
      await denied(read(who ? token(who) : null));
      await denied(rpc('crm_patch_monthly_charges', who ? token(who) : null, { p_revision: '0', p_patch: {}, p_request_id: randomUUID() }));
    }
  });
  await test('legacy full OAR access survives absence of Charges and read-only Charges grant', async () => {
    assert.equal((await allowed(rpc('crm_access_snapshot', token('legacyOwner')))).fullAccess, true);
    await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'monthlyCharges','read','{}')", [users.legacyOwner.id]);
    assert.equal((await allowed(rpc('crm_access_snapshot', token('legacyOwner')))).fullAccess, true);
    await sql.query("delete from public.crm_module_grants where user_id=$1 and module='monthlyCharges'", [users.legacyOwner.id]);
  });
  await test('existing access administration grants Charges explicitly without implicit sources; Publisher boundary unchanged', async () => {
    const profile = (await sql.query('select revision from public.crm_access_profiles where user_id=$1', [users.none.id])).rows[0];
    const args = { p_user: users.none.id, p_revision: Number(profile.revision), p_active: true, p_general_admin: false, p_grants: { monthlyCharges: { level: 'read', sensitive: { export: true } } }, p_izord_role: null, p_assignments: [] };
    await allowed(rpc('crm_admin_save', token('owner'), args));
    const view = await allowed(read(token('none')));
    assert.deepEqual(view.permissions.readableSources, []);
    assert.deepEqual(Object.values(view.sources).map(rows => rows.length), [0, 0, 0, 0, 0]);
    const current = (await sql.query('select revision from public.crm_access_profiles where user_id=$1', [users.none.id])).rows[0];
    await denied(rpc('crm_admin_save', token('owner'), { ...args, p_revision: Number(current.revision), p_grants: { monthlyCharges: { level: 'contribute', sensitive: { payment: true } } } }), 'invalid_module_sensitive');
    await allowed(rpc('crm_admin_save', token('owner'), { ...args, p_revision: Number(current.revision), p_grants: {} }));
    assert.equal((await allowed(rpc('crm_access_snapshot', token('publisherOnly')))).fullAccess, false);
    assert.equal(await allowed(rpc('crm_authorize_publisher', token('publisherOnly'), { p_action: 'today' })), true);
    await denied(read(token('publisherOnly')), 'module_forbidden');
  });
  await test('intersection filters source rows, options, config, permissions before browser calculations', async () => {
    for (const [who, invoices, hours] of [['owner', true, true], ['reader', true, true], ['invoice', true, false], ['house', false, true], ['empty', false, false]]) {
      const response = await allowed(read(token(who)));
      assert.equal(response.sources.invoices.length, invoices ? baseline.vendorInvoices.length : 0);
      assert.equal(response.sources.timeEntries.length, hours ? baseline.houseTimeEntries.length : 0);
      assert.equal(response.sources.suppliers.length > 0, invoices);
      assert.equal(response.sources.workers.length > 0, hours);
      assert.equal(response.sources.houses.length > 0, hours);
      assert.deepEqual(response.permissions.readableSources, [invoices && 'invoice', hours && 'hours'].filter(Boolean));
      assert.ok(Object.values(response.config).every(rows => rows.every(row => response.permissions.readableSources.includes(row.source))));
    }
  });
  await test('source projections exclude payments, email, bank, private notes and every document field', async () => {
    for (const who of ['owner', 'reader', 'invoice', 'house']) {
      const response = await allowed(read(token(who))), serialized = JSON.stringify(response);
      assert.ok(!serialized.includes('PRIVATE_'));
      for (const field of ['paidAmount', 'housePayments', 'invoiceDocument', 'supplierBankAccounts', 'notes', 'documentStoragePath', 'email', 'paymentBankAccountId']) assert.ok(!serialized.includes('"' + field));
      if (who !== 'owner') {
        assert.ok(!serialized.includes('Jardin Riviera fictif'));
        assert.ok(!serialized.includes('Camille fictive'));
      }
    }
  });
  await test('shared configuration persists with verified Auth author and zero business-payload changes', async () => {
    const before = await allowed(read(token('owner')));
    const saved = await allowed(patch('owner', before.revision, selection));
    assert.notEqual(saved.revision, before.revision);
    assert.deepEqual((await allowed(read(token('reader')))).config, saved.config);
    const stored = (await sql.query('select updated_by from app_private.monthly_charges_config')).rows[0];
    assert.equal(stored.updated_by, users.owner.id);
    assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload, baseline);
  });
  await test('source-only read does not acquire business contribution and Charges reader cannot save', async () => {
    const snap = await allowed(read(token('reader')));
    await denied(patch('reader', snap.revision, selection), 'module_forbidden');
    await denied(rpc('crm_mutate_record', token('invoice'), { p_module: 'vendorInvoices', p_collection: 'vendorInvoices', p_id: 'invoice-september', p_patch: { amount: 1 }, p_revision: 'any' }), 'module_forbidden');
    await denied(rpc('crm_mutate_record', token('house'), { p_module: 'houseTracking', p_collection: 'houseTimeEntries', p_id: 'hours-september', p_patch: { hourlyRate: 1 }, p_revision: 'any' }), 'module_forbidden');
  });
  await test('limited contributor patches retain hidden-source rules and prohibit foreign references', async () => {
    const snap = await allowed(read(token('invoice')));
    assert.ok(!JSON.stringify(snap.config).includes('worker-september'));
    const saved = await allowed(patch('invoice', snap.revision, { exceptions: [{ source: 'invoice', sourceId: 'invoice-september', included: false, reason: 'Déjà compté via une autre source' }] }));
    assert.equal(saved.config.exceptions.filter(item => item.sourceId === 'invoice-september').length, 1);
    const full = await allowed(read(token('owner')));
    assert.ok(full.config.personRules.some(rule => rule.source === 'hours' && rule.personId === 'worker-september'));
    const forbidden = await denied(patch('invoice', saved.revision, { exceptions: [{ source: 'hours', sourceId: 'hours-september', included: true }] }), 'source_forbidden');
    assert.ok(!JSON.stringify(forbidden).includes('Camille'));
    await allowed(patch('invoice', saved.revision, { exceptions: [{ source: 'invoice', sourceId: 'invoice-september', included: null }] }));
  });
  await test('atomic batch, stale revision conflict and lost-response retry are deterministic', async () => {
    const first = await allowed(read(token('invoice'))), second = await allowed(read(token('house')));
    const requestId = randomUUID(), operations = { exceptions: [{ source: 'invoice', sourceId: 'invoice-manual', included: true }], attachments: [{ source: 'invoice', sourceId: 'invoice-manual', mode: 'month', month: '2026-09' }] };
    const saved = await allowed(patch('invoice', first.revision, operations, requestId));
    const repeated = await allowed(patch('invoice', first.revision, operations, requestId));
    assert.equal(repeated.revision, saved.revision);
    assert.equal(repeated.config.exceptions.filter(item => item.sourceId === 'invoice-manual').length, 1);
    await denied(patch('house', second.revision, { personRules: [{ source: 'hours', personId: 'worker-archived', included: true }] }), 'revision_conflict');
    await denied(patch('invoice', first.revision, {}, requestId), 'request_id_conflict');
    const before = await allowed(read(token('owner')));
    await denied(patch('invoice', before.revision, { exceptions: [{ source: 'invoice', sourceId: 'invoice-cents', included: true }, { source: 'invoice', sourceId: 'nonexistent', included: true }] }), 'invalid_monthly_reference');
    assert.deepEqual((await allowed(read(token('owner')))).config, before.config);
  });
  await test('targeted month/default/spread changes preserve source dates and reject malformed or excessive ranges', async () => {
    let snap = await allowed(read(token('invoice')));
    snap = await allowed(patch('invoice', snap.revision, { attachments: [{ source: 'invoice', sourceId: 'invoice-spread', mode: 'spread', startMonth: '2026-10', endMonth: '2026-12' }, { source: 'invoice', sourceId: 'invoice-cents', mode: 'spread', startMonth: '2026-10', endMonth: '2026-12' }, { source: 'invoice', sourceId: 'invoice-cross-year', mode: 'spread', startMonth: '2025-12', endMonth: '2026-01' }] }));
    for (const operation of [
      { source: 'invoice', sourceId: 'invoice-spread', mode: 'spread', startMonth: '2026-01', endMonth: '2027-01' },
      { source: 'invoice', sourceId: 'invoice-spread', mode: 'spread', startMonth: '2026-12', endMonth: '2026-01' },
      { source: 'invoice', sourceId: 'invoice-spread', mode: 'month', month: '2026-13' },
      { source: 'invoice', sourceId: 'invoice-spread', mode: 'month', month: 202610 }
    ]) await denied(patch('invoice', snap.revision, { attachments: [operation] }), 'invalid_monthly_patch');
    snap = await allowed(patch('invoice', snap.revision, { attachments: [{ source: 'invoice', sourceId: 'invoice-manual', mode: 'default' }] }));
    assert.ok(!snap.config.attachments.some(item => item.sourceId === 'invoice-manual'));
    assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload, baseline);
  });
  await test('CSV authorization requires Charges export and every effective source export; explicit scope works', async () => {
    await denied(read(token('reader'), { p_export: true }), 'export_forbidden');
    await denied(read(token('contributor'), { p_export: true }), 'export_forbidden');
    const invoice = await allowed(read(token('contributor'), { p_export: true, p_sources: ['invoice'] }));
    assert.equal(invoice.sources.timeEntries.length, 0);
    assert.ok(invoice.config.personRules.every(rule => rule.source === 'invoice'));
    await allowed(read(token('owner'), { p_export: true }));
    await allowed(read(token('invoice'), { p_export: true }));
    await allowed(read(token('house'), { p_export: true }));
    await allowed(read(token('empty'), { p_export: true }));
    for (const args of [{ p_sources: ['unknown'] }, { p_sources: null }, { p_export: null }]) await denied(read(token('owner'), args), 'invalid_monthly_scope');
  });
  await test('deleted source stays absent; orphan configuration retained only for source-authorized accounts', async () => {
    const before = await allowed(read(token('owner'))), changed = structuredClone(baseline);
    changed.vendorInvoices = changed.vendorInvoices.filter(row => row.id !== 'invoice-manual');
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [changed]);
    const invoice = await allowed(read(token('invoice')));
    assert.ok(invoice.config.exceptions.some(item => item.sourceId === 'invoice-manual'));
    assert.ok(!invoice.sources.invoices.some(item => item.id === 'invoice-manual'));
    assert.ok(!JSON.stringify((await allowed(read(token('house')))).config).includes('invoice-manual'));
    await denied(patch('invoice', invoice.revision, { exceptions: [{ source: 'invoice', sourceId: 'invoice-manual', included: true }] }), 'invalid_monthly_reference');
    await allowed(patch('invoice', invoice.revision, { exceptions: [{ source: 'invoice', sourceId: 'invoice-manual', included: null }] }));
    assert.ok(before.config.exceptions.some(item => item.sourceId === 'invoice-manual'));
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
  });
  await test('source amount correction recalculates next projection; archived worker and historical rates remain', async () => {
    const before = await allowed(read(token('owner'))), changed = structuredClone(baseline);
    changed.vendorInvoices.find(row => row.id === 'invoice-spread').amount = 1200;
    changed.houseTrackingWorkers.find(row => row.id === 'worker-september').hourlyRate = 99;
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [changed]);
    const after = await allowed(read(token('owner')));
    assert.notEqual(after.sourceRevision, before.sourceRevision);
    assert.equal(after.sources.invoices.find(row => row.id === 'invoice-spread').amount, 1200);
    assert.equal(after.sources.timeEntries.find(row => row.id === 'hours-september').hourlyRate, 30);
    assert.ok(after.sources.workers.some(row => row.id === 'worker-archived' && row.status === 'Inactif'));
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
  });
  await test('private configuration table and global payload remain closed to a limited account', async () => {
    const raw = await request('/rest/v1/crm_workspace_state?select=*', token('invoice'));
    assert.equal(raw.status, 200); assert.deepEqual(raw.data, []);
    await denied(request('/rest/v1/monthly_charges_config?select=*', token('owner')));
    const relation = (await sql.query("select relrowsecurity from pg_class where oid='app_private.monthly_charges_config'::regclass")).rows[0];
    assert.equal(relation.relrowsecurity, true);
    assert.equal((await sql.query("select has_table_privilege('authenticated','app_private.monthly_charges_config','SELECT') granted")).rows[0].granted, false);
  });
  await test('revocation and terminated local Auth session close reads, exports, saves and retries', async () => {
    const snap = await allowed(read(token('contributor')));
    await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='monthlyCharges'", [users.contributor.id]);
    await denied(read(token('contributor')), 'module_forbidden');
    await denied(read(token('contributor'), { p_export: true }), 'module_forbidden');
    await denied(patch('contributor', snap.revision, {}), 'module_forbidden');
    await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='monthlyCharges'", [users.contributor.id]);
    await sql.query('delete from auth.sessions where user_id=$1', [users.contributor.id]);
    await denied(read(token('contributor')), 'module_forbidden');
    users.contributor.token = await login(users.contributor);
  });
  await test('JSON types, duplicate operations and forbidden fields fail without configuration writes', async () => {
    const before = await allowed(read(token('owner')));
    for (const operations of [
      { personRules: [{ source: 'invoice', personId: 123, included: true }] },
      { personRules: [{ source: 'invoice', personId: 'vendor-september', included: true, notes: 'extra' }] },
      { personRules: [{ source: 'invoice', personId: 'vendor-september', included: true }, { source: 'invoice', personId: 'vendor-september', included: false }] },
      { exceptions: [{ source: 'invoice', sourceId: 'invoice-september', included: true, reason: 123 }] },
      { attachments: [{ source: 'hours', sourceId: 'hours-september', mode: 'month', month: '2026-09' }] },
      { paidAmount: 5 }, { personRules: null }
    ]) await denied(patch('owner', before.revision, operations), 'invalid_monthly_patch');
    assert.deepEqual((await allowed(read(token('owner')))).config, before.config);
  });
  // One useful retained demo: September 900, quarterly invoice October-December 300 each.
  const demo = { personRules: selection.personRules, exceptions: [{ source: 'invoice', sourceId: 'invoice-spread', included: true }], attachments: [{ source: 'invoice', sourceId: 'invoice-spread', mode: 'spread', startMonth: '2026-10', endMonth: '2026-12' }] };
  await sql.query('update app_private.monthly_charges_config set config=$1,revision=gen_random_uuid(),updated_by=$2', [demo, users.owner.id]);
  assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload, baseline);
  writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify(fixture), { mode: 0o600 });
  writeFileSync(join(directory, 'server-results.json'), JSON.stringify({ passed: results.length, results, sourcePayloadPreserved: true, realLocalAuthJWT: true, productionTouched: false }, null, 2));
  console.log(JSON.stringify({ passed: results.length, sourcePayloadPreserved: true, localAuthJWT: true }));
} catch (error) {
  if (originalConfig) await sql.query('update app_private.monthly_charges_config set config=$1,revision=$2,updated_by=$3,updated_at=$4', [originalConfig.config, originalConfig.revision, originalConfig.updated_by, originalConfig.updated_at]);
  throw error;
} finally {
  await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
  await sql.end();
}
