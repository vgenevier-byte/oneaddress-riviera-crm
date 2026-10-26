/** Two final permission/deletion regressions, real Auth/RPC, local fixtures only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, rpc, login, directory } from './server-local.mjs';
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
await connect();
try {
 const ownerToken = await login(fixture.users.owner), contributorToken = await login(fixture.users.contributor);
 const allowed = async promise => { const r = await promise; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
 const read = () => allowed(rpc('crm_house_prepaid_state', ownerToken));
 let state = await read();
 const mainBefore = state.summaries.find(x => x.workerId === 'worker-prepaid');
 const save = (action, patch) => allowed(rpc('crm_save_house_prepaid', ownerToken, { p_revision: state.revision, p_request_id: randomUUID(), p_action: action, p_patch: patch }));
 async function mutate(collection, id, patch, removing = false) {
  const projection = await allowed(rpc('crm_read_module', ownerToken, { p_module: 'houseTracking' }));
  return allowed(rpc('crm_mutate_record', ownerToken, { p_module: 'houseTracking', p_collection: collection, p_id: id, p_patch: patch, p_revision: projection.revision, p_delete: removing }));
 }
 await mutate('houseTrackingWorkers', 'worker-hourly-empty', { contactId: 'contact-worker-hourly', contactName: 'Suppression horaire fictive', role: 'Cours fictifs', hourlyRate: 25, status: 'Actif' }); state = await read();
 state = await save('settings', { workerId: 'worker-hourly-empty', billingMode: 'hourly', defaultMinutes: 1800, defaultPriceCents: 50000 });
 await mutate('houseTrackingWorkers', 'worker-hourly-empty', {}, true); state = await read();
 assert.ok(!state.settings.some(x => x.workerId === 'worker-hourly-empty'));
 console.log('PASS hourly mode settings preserve authorized empty-worker deletion');
 state = await save('settings', { workerId: 'worker-quarters', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 });
 state = await save('package', { workerId: 'worker-quarters', capacityMinutes: 1800, priceCents: 50000, payment: { id: 'payment-export-rights', houseId: 'house-a', date: '2026-10-26', method: 'Virement' }, invoiceId: 'invoice-prepaid' });
 await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'vendorInvoices','read','{}') on conflict(user_id,module) do update set level='read',sensitive='{}'", [fixture.users.contributor.id]);
 const normal = await allowed(rpc('crm_house_prepaid_state', contributorToken));
 assert.ok(normal.packages.some(x => x.invoiceId === 'invoice-prepaid'));
 const exported = await allowed(rpc('crm_house_prepaid_state', contributorToken, { p_export: true }));
 assert.ok(exported.packages.every(x => !('invoiceId' in x)));
 const moduleExport = await allowed(rpc('crm_export_module', contributorToken, { p_module: 'houseTracking' }));
 assert.ok(moduleExport.prepaidLedger.packages.every(x => !('invoiceId' in x)));
 assert.ok((await read()).packages.some(x => x.invoiceId === 'invoice-prepaid'), 'Hidden relation remains stored');
 await sql.query("delete from public.crm_module_grants where user_id=$1 and module='vendorInvoices'", [fixture.users.contributor.id]);
 assert.deepEqual((await read()).summaries.find(x => x.workerId === 'worker-prepaid'), mainBefore);
 console.log('PASS invoice-read without invoice-export redacts export IDs and preserves relation');
 const report = { passed: 2, realLocalAuthJWT: true, productionTouched: false, mainDemoPreserved: true, results: ['hourly mode settings preserve authorized empty-worker deletion', 'invoice-read without invoice-export redacts export IDs and preserves relation'] };
 writeFileSync(join(directory, 'edge-regressions-results.json'), JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report));
} finally { await sql.end(); }
