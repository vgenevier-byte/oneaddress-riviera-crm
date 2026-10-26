/** Tests the explicit administrative reprise without impersonating an Auth JWT. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, directory } from './server-local.mjs';
import { prepareHousePrepaidReconciliation, housePrepaidReconciliationSQL } from '../../scripts/reconcile-house-prepaid.mjs';
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const workerId = 'worker-admin-reprise', contactId = 'contact-admin-reprise', paymentId = 'payment-admin-reprise';
const requestId = randomUUID();
await connect();
try {
 assert.equal((await sql.query('select current_user actor,auth.uid() uid')).rows[0].uid, null, 'Admin is never represented as an authenticated browser session');
 const before = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 assert.ok(!before.houseTrackingWorkers.some(x => x.id === workerId));
 const createdAt = '2026-09-01T00:00:00.000Z', changed = structuredClone(before);
 changed.contacts.push({ id: contactId, name: 'Reprise fictive', kind: 'Prestataire' });
 changed.houseTrackingWorkers.push({ id: workerId, contactId, contactName: 'Reprise fictive', status: 'Actif', hourlyRate: 16.5, role: 'Cours', notes: "Donnée fictive avec apostrophe d'essai", createdAt });
 changed.housePayments.push({ id: paymentId, workerId, workerName: 'Reprise fictive', houseId: 'house-a', houseName: 'Maison A fictive', date: '2026-10-05', amount: 500, method: 'Virement', createdAt });
 for (let i = 0; i < 16; i++) changed.houseTimeEntries.push({ id: 'hours-admin-' + i, workerId, workerName: 'Reprise fictive', houseId: 'house-a', houseName: 'Maison A fictive', date: '2026-09-' + String(i + 1).padStart(2, '0'), startTime: '08:00', endTime: '10:00', breakMinutes: 0, hourlyRate: 16.5, createdAt });
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [changed]);
 const snapshot = (await sql.query("select workspace_id,payload,updated_at::text,md5(payload::text) payload_md5 from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
 const plan = { operatorId: fixture.users.owner.id, requestId, workerId, contactId, paymentId, capacityMinutes: 1800, priceCents: 50000, expectedMinutes: 1920, reviewed: true, reason: 'Reprise fictive explicitement vérifiée', evidence: 'tests/prepaid-hours/server-admin-reconciliation.mjs' };
 const prepared = prepareHousePrepaidReconciliation(snapshot, plan), command = housePrepaidReconciliationSQL(snapshot, prepared);
 // A changed whole-workspace digest blocks the reviewed command before writes.
 await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{unrelatedSentinel}','true'::jsonb) where workspace_id='oneaddress-riviera'");
 await assert.rejects(sql.query(command), /reconciliation_source_changed/); await sql.query('rollback');
 assert.equal(Number((await sql.query('select count(*) n from app_private.house_prepaid_packages where worker_id=$1', [workerId])).rows[0].n), 0);
 // Restore the exact captured revision/payload only inside this disposable test.
 await sql.query("update public.crm_workspace_state set payload=$1,updated_at=$2 where workspace_id='oneaddress-riviera'", [snapshot.payload, snapshot.updated_at]);
 const freshSnapshot = (await sql.query("select workspace_id,payload,updated_at::text,md5(payload::text) payload_md5 from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
 const reviewed = prepareHousePrepaidReconciliation(freshSnapshot, plan), reviewedSQL = housePrepaidReconciliationSQL(freshSnapshot, reviewed);
 await sql.query(reviewedSQL); await sql.query(reviewedSQL);
 const packages = (await sql.query('select * from app_private.house_prepaid_packages where worker_id=$1', [workerId])).rows; assert.equal(packages.length, 1); assert.equal(packages[0].payment_id, paymentId);
 const after = (await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 assert.equal(after.housePayments.filter(x => x.workerId === workerId).length, 1); assert.equal(after.houseTimeEntries.filter(x => x.workerId === workerId).length, 16);
 const source = entries => entries.map(({ billingMode, prepaid, ...e }) => e);
 assert.deepEqual(source(after.houseTimeEntries.filter(x => x.workerId === workerId)), source(changed.houseTimeEntries.filter(x => x.workerId === workerId)));
 const journal = (await sql.query('select * from app_private.house_prepaid_requests where actor_id=$1 and request_id=$2', [plan.operatorId, requestId])).rows; assert.equal(journal.length, 1);
 assert.equal(journal[0].action, 'administrator_reconciliation'); assert.equal(journal[0].before_state.sourceBackup.entries.length, 16); assert.equal(journal[0].before_state.sourceBackup.payment.id, paymentId);
 assert.equal(journal[0].after_state.execution.authenticatedRpc, false); assert.equal(journal[0].after_state.execution.channel, 'connected_supabase_admin');
 const summary = journal[0].after_state.summaries.find(x => x.workerId === workerId); assert.equal(summary.performedMinutes, 1920); assert.equal(summary.uncoveredMinutes, 120); assert.equal(summary.paidCents, 50000);
 const audits = (await sql.query("select actor_id from app_private.house_prepaid_entry_audit where entry_id like 'hours-admin-%'")).rows; assert.equal(audits.length, 16); assert.ok(audits.every(x => x.actor_id === null));
 assert.deepEqual(after.houseTrackingWorkers.filter(x => x.id !== workerId), before.houseTrackingWorkers); assert.deepEqual(after.houseTimeEntries.filter(x => x.workerId !== workerId), before.houseTimeEntries); assert.deepEqual(after.housePayments.filter(x => x.workerId !== workerId), before.housePayments);
 const report = { passed: true, fictitious: true, productionTouched: false, authenticAdministrativeConnection: true, impersonatedSession: false, sourceChangedRejected: true, identicalReplayCreatedOnePackage: true, existingPaymentOnly: true, sourceBackupPersisted: true, administrativeChannelPersisted: true, auditActorNull: true, summary };
 writeFileSync(join(directory, 'admin-reconciliation-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await sql.end(); }
