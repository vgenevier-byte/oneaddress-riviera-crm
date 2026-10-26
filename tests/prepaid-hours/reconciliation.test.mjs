import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareHousePrepaidReconciliation, housePrepaidReconciliationSQL } from '../../scripts/reconcile-house-prepaid.mjs';

function fixture() {
 const snapshot = { workspace_id:'oneaddress-riviera', updated_at:'2026-10-26T20:00:00Z',
  payload:{ contacts:[{id:'contact-example',name:'Example Teacher'}],
   houseTrackingWorkers:[{id:'worker-example',contactId:'contact-example',status:'Actif',hourlyRate:16.5}],
   houseTimeEntries:Array.from({length:16},(_,i)=>({id:`lesson-${i}`,workerId:'worker-example',houseId:i%2?'house-b':'house-a',date:`2026-10-${String(i+1).padStart(2,'0')}`,startTime:'08:00',endTime:'10:00',breakMinutes:0,hourlyRate:16.5,note:`Existing ${i}`})),
   housePayments:[{id:'payment-example',workerId:'worker-example',date:'2026-10-05',amount:500,method:'Virement'}], vendorInvoices:[] } };
 const plan = {operatorId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',
  workerId:'worker-example',contactId:'contact-example',paymentId:'payment-example',capacityMinutes:1800,priceCents:50000,
  expectedMinutes:1920,reviewed:true,reason:"Human's verified reconciliation",evidence:'Canonical records compared before administrative execution'};
 return {snapshot,plan};
}

test('reviewed canonical sources yield32h/2h without changing hours, rates or payments',()=>{
 const {snapshot,plan}=fixture(), before=structuredClone(snapshot), prepared=prepareHousePrepaidReconciliation(snapshot,plan);
 assert.deepEqual(snapshot,before); assert.equal(prepared.preview.performedMinutes,1920); assert.equal(prepared.preview.coveredMinutes,1800);
 assert.equal(prepared.preview.uncoveredMinutes,120); assert.equal(prepared.preview.availableMinutes,0); assert.equal(prepared.preview.paidCents,50000);
 assert.deepEqual(prepared.sourceBackup.entries,snapshot.payload.houseTimeEntries); assert.deepEqual(prepared.sourceBackup.payment,snapshot.payload.housePayments[0]);
 assert.equal(prepared.preview.execution.authenticatedRpc,false); assert.equal(prepared.preview.execution.channel,'connected_supabase_admin');
});

test('ambiguous identities, reserved payments and different durations require new review',()=>{
 for(const alter of [
  x=>x.snapshot.payload.houseTrackingWorkers.push(structuredClone(x.snapshot.payload.houseTrackingWorkers[0])),
  x=>x.snapshot.payload.housePayments.push(structuredClone(x.snapshot.payload.housePayments[0])),
  x=>x.snapshot.payload.housePayments[0].prepaidPackageId='existing-package',
  x=>x.snapshot.payload.houseTrackingWorkers[0].contactId='another-person',
  x=>x.snapshot.payload.houseTimeEntries[0].endTime='09:00',
  x=>x.plan.reviewed=false,
  x=>x.plan.expectedMinutes=1919
 ]) { const f=fixture();alter(f);assert.throws(()=>prepareHousePrepaidReconciliation(f.snapshot,f.plan)); }
});

test('SQL preserves admin provenance, exact source guards and replay journal; never forges Auth',()=>{
 const {snapshot,plan}=fixture(); snapshot.payload_md5='a'.repeat(32);
 const prepared=prepareHousePrepaidReconciliation(snapshot,plan), sql=housePrepaidReconciliationSQL(snapshot,prepared);
 assert.ok(sql.includes("auth.uid() is not null")); assert.ok(!sql.includes('set_config')); assert.ok(!sql.includes('request.jwt.claims'));
 assert.ok(sql.includes('for update')); assert.ok(sql.includes("md5(w.payload::text) is distinct from '"+'a'.repeat(32)));
 assert.ok(sql.includes('administrator_reconciliation')); assert.ok(sql.includes('sourceBackup')); assert.ok(sql.includes('reconciliation_request_reused'));
 assert.ok(sql.includes('reconciliation_source_interventions_changed')); assert.ok(sql.includes('reconciliation_source_payments_changed'));
 assert.ok(sql.includes("Human''s verified reconciliation")); assert.equal((sql.match(/insert into app_private.house_prepaid_packages/g)||[]).length,1);
 assert.equal((sql.match(/insert into.*housePayments/g)||[]).length,0);
});

test('linked supplier invoice requires explicit canonical contact, exact price and actual invoice status',()=>{
 const {snapshot,plan}=fixture(); snapshot.payload.vendorInvoices=[{id:'invoice-example',contactId:'contact-example',amount:500,status:'À payer'}];plan.invoiceId='invoice-example';
 assert.equal(prepareHousePrepaidReconciliation(snapshot,plan).preview.invoiceId,'invoice-example');
 snapshot.payload.vendorInvoices[0].status='En attente de facture';assert.throws(()=>prepareHousePrepaidReconciliation(snapshot,plan));
 snapshot.payload.vendorInvoices[0].status='À payer';snapshot.payload.vendorInvoices[0].contactId='other-contact';assert.throws(()=>prepareHousePrepaidReconciliation(snapshot,plan));
});

test('source notes cannot terminate the generated administrative dollar block',()=>{
 const {snapshot,plan}=fixture();
 snapshot.payload.houseTimeEntries[0].note='$prepaid_reconcile$ $prepaid_22222222222242228222222222222222_0$';
 const prepared=prepareHousePrepaidReconciliation(snapshot,plan), sql=housePrepaidReconciliationSQL(snapshot,prepared);
 const tag=/\ndo (\$prepaid_[a-z0-9_]+\$)\n/.exec(sql)?.[1];
 assert.ok(tag);assert.notEqual(tag,'$prepaid_22222222222242228222222222222222_0$');
 assert.equal(sql.split(tag).length-1,2);assert.ok(sql.includes('end '+tag+';'));
 assert.ok(sql.includes('reconciliation_reviewed_records_changed'));
});
