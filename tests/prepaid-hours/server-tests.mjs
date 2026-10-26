/** Real local Auth JWT -> PostgREST -> guarded prepaid RPC; fictitious data only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, request, rpc, login, directory } from './server-local.mjs';

const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const users = fixture.users, results = [];
await connect();
for (const user of Object.values(users)) user.token = await login(user);
const baseline = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
const token = who => users[who].token;
const read = (who = 'owner', p_export = false) => rpc('crm_house_prepaid_state', who ? token(who) : null, { p_export });
const save = (revision, action, patch, id = randomUUID(), who = 'owner') => rpc('crm_save_house_prepaid', token(who), { p_revision: revision, p_action: action, p_patch: patch, p_request_id: id });
const allowed = async promise => { const r = await promise; assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.data)); return r.data; };
const denied = async (promise, code) => { const r = await promise; assert.ok(r.status >= 400, 'Must deny: ' + JSON.stringify(r.data)); if (code) assert.equal(r.data.message, code); return r.data; };
const test = async (name, task) => { await task(); results.push({ name, passed: true }); console.log('PASS ' + name); };
const summary = (state, workerId = 'worker-prepaid') => { const row = state.summaries.find(x => x.workerId === workerId); assert.ok(row, 'Global canonical worker summary'); return row; };
const newPayment = (id, date = '2026-11-01') => ({ id, houseId: 'house-a', date, method: 'Virement', note: 'Paiement fictif explicitement confirmé' });
const plan = (workerId, payment, extra = {}) => ({ workerId, capacityMinutes: 1800, priceCents: 50000, ...(typeof payment === 'string' ? { paymentId: payment } : { payment }), ...extra });
const sourceEntries = entries => entries.map(({ billingMode, prepaid, ...source }) => source);
const payload = async () => (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
async function mutate(collection, id, patch, removing = false, who = 'owner') {
 const projection = await allowed(rpc('crm_read_module', token(who), { p_module: 'houseTracking' }));
 return rpc('crm_mutate_record', token(who), { p_module: 'houseTracking', p_collection: collection, p_id: id, p_patch: patch, p_revision: projection.revision, p_delete: removing });
}
let snap;
try {
 await test('anonymous/no source access denied; restricted reader cannot mutate or export', async () => {
  for (const who of [null, 'none', 'invoiceOnly']) await denied(read(who));
  snap = await allowed(read()); assert.equal(snap.complete, true);
  await denied(save(snap.revision, 'settings', { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }, randomUUID(), 'reader'));
  await denied(read('reader', true));
 });
 await test('switch canonical worker to prepaid without rewriting source entries or legacy hourly rate', async () => {
  snap = await allowed(save(snap.revision, 'settings', { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }));
  assert.deepEqual(sourceEntries((await payload()).houseTimeEntries), baseline.houseTimeEntries);
  assert.equal((await payload()).houseTrackingWorkers.find(x => x.id === 'worker-prepaid').hourlyRate, 16.5);
  assert.equal(summary(snap).performedMinutes, 1920); assert.equal(summary(snap).uncoveredMinutes, 1920);
 });
 await test('existing500 payment attaches once:30h purchased,32h performed,2h uncovered,zero available', async () => {
  const id = randomUUID(), revision = snap.revision, patch = plan('worker-prepaid', 'payment-existing');
  snap = await allowed(save(revision, 'package', patch, id));
  assert.deepEqual(Object.fromEntries(['purchasedMinutes','performedMinutes','coveredMinutes','availableMinutes','uncoveredMinutes','paidCents'].map(k => [k, summary(snap)[k]])), { purchasedMinutes: 1800, performedMinutes: 1920, coveredMinutes: 1800, availableMinutes: 0, uncoveredMinutes: 120, paidCents: 50000 });
  assert.equal((await payload()).housePayments.length, baseline.housePayments.length);
  assert.equal(snap.packages.filter(p => p.workerId === 'worker-prepaid').length, 1);
  const again = await allowed(save(revision, 'package', patch, id)); assert.equal(again.packages.length, snap.packages.length);
  await denied(save(snap.revision, 'package', patch));
  await denied(save(revision, 'package', { ...patch, capacityMinutes: 1801 }, id));
 });
 await test('restricted global read includes both houses/months; classic hourly worker/payments unchanged', async () => {
  const restricted = await allowed(read('contributor')); assert.equal(restricted.complete, true);
  assert.deepEqual(summary(restricted), summary(snap));
  assert.equal(restricted.allocations.filter(a => a.workerId === 'worker-prepaid').length, 16);
  const projection = await allowed(rpc('crm_read_module', token('contributor'), { p_module: 'houseTracking' }));
  assert.equal(projection.collections.houseTimeEntries.find(x => x.id === 'hours-prepaid-00').prepaid.minutes, 120);
  assert.equal(projection.collections.houseTimeEntries.find(x => x.id === 'hours-prepaid-00').prepaid.amountCents, restricted.allocations.find(x => x.entryId === 'hours-prepaid-00').amountCents);
  const stored = await payload(); assert.deepEqual(stored.houseTrackingWorkers.find(x => x.id === 'worker-hourly'), baseline.houseTrackingWorkers.find(x => x.id === 'worker-hourly'));
  assert.deepEqual(stored.houseTimeEntries.find(x => x.id === 'hours-hourly'), baseline.houseTimeEntries.find(x => x.id === 'hours-hourly'));
  assert.deepEqual(stored.housePayments.find(x => x.id === 'payment-hourly'), baseline.housePayments.find(x => x.id === 'payment-hourly'));
 });
 await test('reserved payment cannot be changed/deleted by classic RPC or global workspace save', async () => {
  await denied(mutate('housePayments', 'payment-existing', { amount: 1 }));
  await denied(mutate('housePayments', 'payment-existing', {}, true));
  const stored = await payload(), forged = structuredClone(stored); forged.housePayments = forged.housePayments.filter(x => x.id !== 'payment-existing');
  await denied(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera', token('owner'), { payload: forged }, 'PATCH'));
  assert.deepEqual((await payload()).housePayments, stored.housePayments);
  const forgedValue = structuredClone(stored); forgedValue.houseTimeEntries.find(x => x.id === 'hours-prepaid-00').prepaid = { minutes: 0, coveredMinutes: 0, uncoveredMinutes: 0, coveredCents: 0, uncoveredCents: 0, amountCents: 0 };
  await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera', token('owner'), { payload: forgedValue }, 'PATCH'));
  assert.equal((await payload()).houseTimeEntries.find(x => x.id === 'hours-prepaid-00').prepaid.minutes, 120);
  assert.deepEqual(summary(await allowed(read())), summary(snap));
 });
 await test('second paid package concurrent double-click/retry creates one payment and28h available', async () => {
  const revision = snap.revision, id = randomUUID(), patch = plan('worker-prepaid', newPayment('payment-second'));
  const responses = await Promise.all([save(revision, 'package', patch, id), save(revision, 'package', patch, id)]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.data));
  snap = await allowed(read());
  assert.deepEqual(Object.fromEntries(['purchasedMinutes','performedMinutes','coveredMinutes','availableMinutes','uncoveredMinutes','paidCents'].map(k => [k, summary(snap)[k]])), { purchasedMinutes: 3600, performedMinutes: 1920, coveredMinutes: 1920, availableMinutes: 1680, uncoveredMinutes: 0, paidCents: 100000 });
  assert.equal((await payload()).housePayments.filter(x => x.id === 'payment-second').length, 1);
  assert.equal(snap.packages.filter(p => p.workerId === 'worker-prepaid').length, 2);
  const again = await allowed(save(revision, 'package', patch, id)); assert.equal(again.packages.length, snap.packages.length);
 });
 await test('new authentication reloads persisted package links, global balance and original dates', async () => {
  await request('/auth/v1/logout', token('reader'), {}, 'POST'); users.reader.token = await login(users.reader);
  const reread = await allowed(read('reader')); assert.deepEqual(summary(reread), summary(snap));
  assert.deepEqual(reread.packages, snap.packages.map(({ invoiceId, ...p }) => p));
  assert.deepEqual(sourceEntries((await payload()).houseTimeEntries), baseline.houseTimeEntries);
  assert.equal(snap.allocations.filter(x => x.workerId === 'worker-prepaid').reduce((s, x) => s + x.amountCents, 0), 53333);
 });
 await test('120 quarters consume1800 minutes and exactly50000 cents; linked invoice single economic source', async () => {
  snap = await allowed(save(snap.revision, 'settings', { workerId: 'worker-quarters', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }));
  snap = await allowed(save(snap.revision, 'package', plan('worker-quarters', newPayment('payment-quarters'), { invoiceId: 'invoice-prepaid' })));
  const quarter = snap.allocations.filter(x => x.workerId === 'worker-quarters'); assert.equal(quarter.length, 120);
  assert.equal(quarter.reduce((s, x) => s + x.minutes, 0), 1800); assert.equal(quarter.reduce((s, x) => s + x.amountCents, 0), 50000);
  assert.equal(summary(snap, 'worker-quarters').availableMinutes, 0); assert.equal(summary(snap, 'worker-quarters').uncoveredMinutes, 0);
  const charges = await allowed(rpc('crm_read_monthly_charges', token('owner')));
  assert.ok(charges.sources.invoices.find(x => x.id === 'invoice-prepaid').prepaidPackageId);
  const qEntries = charges.sources.timeEntries.filter(x => x.personId === 'worker-quarters'); assert.equal(qEntries.reduce((s, x) => s + x.prepaid.amountCents, 0), 50000);
 });
 await test('expenses independent; consumption stays on actual course months after November payment', async () => {
  const charges = await allowed(rpc('crm_read_monthly_charges', token('owner')));
  const entries = charges.sources.timeEntries.filter(x => x.personId === 'worker-prepaid'); assert.equal(entries.length, 16);
  assert.equal(entries.find(x => x.id === 'hours-prepaid-00').expenseAmount, 10);
  assert.equal(entries.filter(x => x.date.startsWith('2026-09')).reduce((s, x) => s + x.prepaid.minutes, 0), 960);
  assert.equal(entries.filter(x => x.date.startsWith('2026-10')).reduce((s, x) => s + x.prepaid.minutes, 0), 960);
  assert.equal(entries.filter(x => x.date.startsWith('2026-11')).length, 0);
  assert.equal(summary(snap).paidCents, 100000);
 });
 await test('crossing package boundary, late entry, authorized correction/deletion recompute once', async () => {
  snap = await allowed(save(snap.revision, 'settings', { workerId: 'worker-cross', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }));
  snap = await allowed(save(snap.revision, 'package', plan('worker-cross', newPayment('payment-cross-first'))));
  snap = await allowed(save(snap.revision, 'package', plan('worker-cross', newPayment('payment-cross-second'))));
  let crossing = snap.allocations.find(x => x.entryId === 'hours-cross-2'); assert.equal(crossing.allocations.length, 2); assert.deepEqual(crossing.allocations.map(x => x.minutes), [60, 60]);
  await allowed(mutate('houseTimeEntries', 'hours-cross-late', { workerId: 'worker-cross', houseId: 'house-a', date: '2026-08-31', startTime: '08:00', endTime: '09:00', breakMinutes: 0, hourlyRate: 0 }));
  snap = await allowed(read()); assert.equal(summary(snap, 'worker-cross').performedMinutes, 1920); assert.equal(summary(snap, 'worker-cross').availableMinutes, 1680);
  await allowed(mutate('houseTimeEntries', 'hours-cross-2', { endTime: '09:00' })); snap = await allowed(read()); assert.equal(summary(snap, 'worker-cross').performedMinutes, 1860);
  await allowed(mutate('houseTimeEntries', 'hours-cross-late', {}, true)); snap = await allowed(read()); assert.equal(summary(snap, 'worker-cross').performedMinutes, 1800);
  assert.equal(new Set(snap.allocations.map(x => x.entryId)).size, snap.allocations.length);
 });
 await test('different concurrent renewals require fresh revision and cannot duplicate payment credit', async () => {
  const revision = snap.revision;
  const both = await Promise.all([save(revision, 'package', plan('worker-cross', newPayment('payment-race-a'))), save(revision, 'package', plan('worker-cross', newPayment('payment-race-b')))]);
  assert.equal(both.filter(x => x.status === 200).length, 1); assert.equal(both.filter(x => x.status >= 400).length, 1);
  const stored = await payload(); assert.equal(stored.housePayments.filter(x => x.id === 'payment-race-a' || x.id === 'payment-race-b').length, 1);
  snap = await allowed(read());
 });
 await test('hidden invoice link is retained and cannot be forged or exported beyond rights', async () => {
  const restricted = await allowed(read('contributor'));
  assert.equal(restricted.complete, true);
  await denied(save(restricted.revision, 'package', plan('worker-prepaid', newPayment('payment-forbidden-invoice'), { invoiceId: 'invoice-prepaid' }), randomUUID(), 'contributor'));
  assert.ok((await allowed(read())).packages.some(x => x.invoiceId === 'invoice-prepaid'));
  await denied(read('reader', true)); await allowed(read('owner', true));
  await denied(rpc('crm_export_module', token('reader'), { p_module: 'houseTracking' }));
  const exported = await allowed(rpc('crm_export_module', token('contributor'), { p_module: 'houseTracking' }));
  assert.equal(exported.prepaidLedger.complete, true);
  assert.deepEqual(summary(exported.prepaidLedger), summary(snap));
  const exportedCourse = exported.collections.houseTimeEntries.find(x => x.id === 'hours-prepaid-00');
  assert.equal(exportedCourse.hourlyRate, undefined); assert.equal(exportedCourse.legacyHourlyRate, 16.5); assert.equal(exportedCourse.prepaidMinutes, 120);
  assert.equal(exportedCourse.prepaidAmountCents, snap.allocations.find(x => x.entryId === exportedCourse.id).amountCents);
  await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'vendorInvoices','read','{}')", [users.contributor.id]);
  assert.ok((await allowed(read('contributor'))).packages.some(x => x.invoiceId === 'invoice-prepaid'));
  assert.ok((await allowed(read('contributor', true))).packages.every(x => !('invoiceId' in x)));
  const limitedExport = await allowed(rpc('crm_export_module', token('contributor'), { p_module: 'houseTracking' }));
  assert.ok(limitedExport.prepaidLedger.packages.every(x => !('invoiceId' in x)));
  await sql.query("delete from public.crm_module_grants where user_id=$1 and module='vendorInvoices'", [users.contributor.id]);
  await denied(request('/rest/v1/house_prepaid_ledger?select=*', token('owner')));
 });
 await test('hourly mode settings do not block previously authorized empty-worker deletion', async () => {
  await allowed(mutate('houseTrackingWorkers', 'worker-hourly-empty', { contactId: 'contact-worker-hourly', contactName: 'Suppression horaire fictive', role: 'Cours fictifs', hourlyRate: 25, status: 'Actif' }));
  snap = await allowed(read());
  snap = await allowed(save(snap.revision, 'settings', { workerId: 'worker-hourly-empty', billingMode: 'hourly', defaultMinutes: 1800, defaultPriceCents: 50000 }));
  await allowed(mutate('houseTrackingWorkers', 'worker-hourly-empty', {}, true));
  snap = await allowed(read()); assert.ok(!snap.settings.some(x => x.workerId === 'worker-hourly-empty'));
 });
 await test('permission revocation closes existing JWT reads, writes and replay', async () => {
  await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='houseTracking'", [users.contributor.id]);
  await denied(read('contributor')); await denied(save(snap.revision, 'settings', { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 }, randomUUID(), 'contributor'));
  await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='houseTracking'", [users.contributor.id]);
  await sql.query('delete from auth.sessions where user_id=$1', [users.contributor.id]); await denied(read('contributor')); users.contributor.token = await login(users.contributor); await allowed(read('contributor'));
 });
 // Keep a useful fictional before-renewal scenario for UI screenshots. The second
 // package is part of the audit trail and is never deleted by a production path.
 writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify(fixture), { mode: 0o600 });
 writeFileSync(join(directory, 'server-results.json'), JSON.stringify({ passed: results.length, results, realLocalAuthJWT: true, productionTouched: false }, null, 2));
 console.log(JSON.stringify({ passed: results.length, localAuthJWT: true, productionTouched: false }));
} finally { await sql.end(); }
