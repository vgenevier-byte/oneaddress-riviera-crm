/** Real local Auth JWT -> PostgREST -> PostgreSQL. Never points at Production. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureData } from './fixture-data.mjs';
import { connect, sql, request, rpc, login, read, directory } from './server-local.mjs';
const require = createRequire(import.meta.url);
const compiled = process.env.HOUSE_EXPENSES_COMPILED || '/private/tmp/oar-house-expenses-test-compiled';
const { getHouseTimeAmount, getHouseTimeTotalAmount, getHouseTrackingWorkerHistorySummary } = require(join(compiled,'houseTracking.js'));
const { buildMonthlyCharges, exportDetailedChargesCsv } = require(join(compiled,'monthlyCharges/calculations.js'));
const fixture = JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const users = fixture.users, results = [];
await connect();
for (const user of Object.values(users)) user.token = await login(user);
const token = who => who ? users[who].token : null;
const copy = value => JSON.parse(JSON.stringify(value));
async function restore() { await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[fixtureData]); }
async function snapshot() { return (await sql.query("select payload,updated_at::text revision from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0]; }
const moduleRead = who => rpc('crm_read_module',token(who),{ p_module:'houseTracking' });
async function allowed(promise) { const r=await promise; assert.ok(r.status>=200&&r.status<300,JSON.stringify(r)); return r.data; }
async function denied(promise,code) { const r=await promise; assert.ok(r.status>=400,'Request unexpectedly allowed: '+JSON.stringify(r)); if(code)assert.equal(r.data.message,code); return r; }
async function mutate(who,id,patch,revision) { const current=revision??(await allowed(moduleRead(who))).revision; return rpc('crm_mutate_record',token(who),{ p_module:'houseTracking',p_collection:'houseTimeEntries',p_id:id,p_patch:patch,p_revision:current,p_delete:false }); }
async function expense(who,id,patch,revision) { const current=revision??(who==='owner'?(await snapshot()).revision:(await allowed(moduleRead(who))).revision); return rpc('crm_update_house_time_expenses',token(who),{ p_id:id,p_patch:patch,p_revision:current }); }
async function ownerSave(payload) { const current=await snapshot(); return request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&updated_at=eq.'+encodeURIComponent(current.revision),token('owner'),{ payload,updated_by:users.none.id },'PATCH'); }
async function check(name,run) { await restore(); await run(); results.push({ name,passed:true }); console.log('PASS '+name); }
const row = (payload,id='expense-main') => payload.houseTimeEntries.find(entry=>entry.id===id);
const amountPatch = { expenseAmount:48.6,expenseNote:'Trajet fictif Port Grimaud' };
const metadataLess = ({ updatedAt,updatedBy,...entry }) => entry;
try {
  await check('real Auth sessions and owner/limited projection preserve the original no-expense intervention',async()=>{
    for(const who of ['owner','contributor','reader']) {
      const identity=await allowed(request('/auth/v1/user',token(who)));
      assert.equal(identity.id,users[who].id);
      const projection=await allowed(moduleRead(who));
      assert.equal(projection.collections.houseTimeEntries.length,3);
      assert.ok(!Object.hasOwn(row(projection.collections),'expenseAmount'));
      assert.ok(!Object.hasOwn(row(projection.collections,'expense-legacy'),'expenseAmount'));
    }
    assert.equal((await allowed(rpc('crm_access_snapshot',token('owner')))).fullAccess,true);
    assert.equal((await allowed(rpc('crm_access_snapshot',token('contributor')))).fullAccess,false);
  });
  await check('owner full-workspace create persists expense and reason without changing hours, rate or payment',async()=>{
    const before=await snapshot(),payload=copy(before.payload);
    payload.houseTimeEntries.push({ ...copy(row(payload)),id:'expense-owner-created',...amountPatch });
    await allowed(ownerSave(payload));
    const reread=await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload,updated_at,updated_by',token('owner')));
    const entry=row(reread[0].payload,'expense-owner-created');
    assert.equal(entry.expenseAmount,48.6);assert.equal(entry.expenseNote,amountPatch.expenseNote);
    assert.equal(getHouseTimeAmount(entry),100);assert.equal(getHouseTimeTotalAmount(entry),148.6);
    assert.equal(reread[0].updated_by,users.owner.id,'Verified Auth author overrides forged client author');
    assert.deepEqual(reread[0].payload.housePayments,before.payload.housePayments);
    const limited=await allowed(moduleRead('reader'));
    assert.equal(row(limited.collections,'expense-owner-created').expenseAmount,48.6);
    assert.equal(row(limited.collections,'expense-owner-created').expenseNote,amountPatch.expenseNote);
  });
  await check('limited contributor creates one intervention with hours and expense through generic authorised RPC',async()=>{
    const before=await snapshot();
    await allowed(mutate('contributor','expense-limited-created',{ ...copy(row(before.payload)),id:undefined,...amountPatch }));
    const projected=await allowed(moduleRead('reader')),entry=row(projected.collections,'expense-limited-created');
    assert.equal(entry.expenseAmount,48.6);assert.equal(entry.expenseNote,amountPatch.expenseNote);
    assert.equal(getHouseTimeAmount(entry),100);assert.equal(getHouseTimeTotalAmount(entry),148.6);
    const after=await snapshot();assert.deepEqual(after.payload.housePayments,before.payload.housePayments);
    assert.equal(after.payload.houseTimeEntries.filter(entry=>entry.id==='expense-limited-created').length,1);
    assert.deepEqual(row(after.payload),row(before.payload));
  });
  await check('targeted owner and limited updates persist/reload, preserve time/rate/payments, then zero fees without duplication',async()=>{
    const before=await snapshot(),initial=row(before.payload);
    for(const who of ['owner','contributor']) {
      await allowed(expense(who,'expense-main',amountPatch));
      const reloaded=await allowed(moduleRead('reader')),entry=row(reloaded.collections);
      assert.equal(entry.expenseAmount,48.6);assert.equal(entry.expenseNote,amountPatch.expenseNote);
      for(const field of ['startTime','endTime','breakMinutes','hourlyRate','date','workerId','houseId','note'])assert.deepEqual(entry[field],initial[field]);
      const after=await snapshot();assert.deepEqual(after.payload.housePayments,before.payload.housePayments);
      const summary=getHouseTrackingWorkerHistorySummary('expense-worker',after.payload.houseTimeEntries,after.payload.housePayments);
      assert.equal(summary.hours,4);assert.equal(summary.due,148.6);assert.equal(summary.paid,50);assert.equal(summary.balance,98.6);
      assert.equal(after.payload.houseTimeEntries.filter(entry=>entry.id==='expense-main').length,1);
    }
    await allowed(expense('contributor','expense-main',{ expenseAmount:0,expenseNote:'' }));
    const final=(await snapshot()).payload,summary=getHouseTrackingWorkerHistorySummary('expense-worker',final.houseTimeEntries,final.housePayments);
    assert.equal(summary.due,100);assert.equal(summary.balance,50);
    assert.deepEqual(row(final,'expense-legacy'),row(before.payload,'expense-legacy'));
  });
  await check('generic update expense fields validates persistence and retains unrelated original fields',async()=>{
    const before=await snapshot();
    await allowed(mutate('contributor','expense-main',amountPatch));
    const after=await snapshot();
    assert.deepEqual(metadataLess(row(after.payload)),{ ...row(before.payload),...amountPatch });
    assert.deepEqual(after.payload.housePayments,before.payload.housePayments);
  });
  await check('stale owner/module revisions, unknown IDs and foreign patch fields fail atomically',async()=>{
    const moduleRevision=(await allowed(moduleRead('contributor'))).revision,ownerRevision=(await snapshot()).revision;
    await allowed(expense('contributor','expense-main',amountPatch));
    const before=await snapshot();
    await denied(expense('owner','expense-main',{ expenseAmount:5 },ownerRevision),'revision_conflict');
    await denied(expense('contributor','expense-main',{ expenseAmount:5 },moduleRevision),'revision_conflict');
    await denied(expense('contributor','expense-missing',{ expenseAmount:5 }),'record_missing');
    for(const patch of [{ expenseAmount:5,hourlyRate:1 },{ expenseAmount:5,startTime:'00:00' },{ expenseAmount:5,paidAmount:0 },{ expenseNote:'Note seule interdite' }])await denied(expense('contributor','expense-main',patch),'invalid_expense_patch');
    assert.deepEqual(await snapshot(),before);
  });
  await check('anonymous/no-rights/read-only users cannot write fees through targeted RPC, generic RPC or global REST',async()=>{
    const before=await snapshot(),revision=(await allowed(moduleRead('reader'))).revision;
    for(const who of [null,'none','reader']) {
      await denied(rpc('crm_update_house_time_expenses',token(who),{ p_id:'expense-main',p_patch:amountPatch,p_revision:revision }));
      await denied(rpc('crm_mutate_record',token(who),{ p_module:'houseTracking',p_collection:'houseTimeEntries',p_id:'expense-main',p_patch:amountPatch,p_revision:revision,p_delete:false }));
      const payload=copy(before.payload);Object.assign(row(payload),amountPatch);
      const result=await request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',token(who),{ payload },'PATCH');
      assert.ok(result.status>=400||result.status===204,'RLS refusal may update zero rows without HTTP error');
      assert.deepEqual(await snapshot(),before,'Global REST cannot bypass readonly module');
    }
  });
  await check('invalid negative/type/three-decimal expense amounts and invalid notes fail on every write route',async()=>{
    const invalidPatches=[...[-1,48.601,'48.60',null,true,{},[]].map(expenseAmount=>({ expenseAmount })),{ expenseAmount:1,expenseNote:8 },{ expenseAmount:1,expenseNote:null },{ expenseAmount:1,expenseNote:'x'.repeat(4001) }];
    const before=await snapshot();
    for(const patch of invalidPatches) {
      await denied(expense('contributor','expense-main',patch));
      await denied(mutate('contributor','expense-main',patch));
      const creation={ ...copy(row(before.payload)),...patch };delete creation.id;
      await denied(mutate('contributor','expense-invalid-created',creation));
      const payload=copy(before.payload);Object.assign(row(payload),patch);
      await denied(ownerSave(payload));
      assert.deepEqual(await snapshot(),before,'Rejected mutation must not alter revision or any business value');
    }
  });
  await check('archived intervention accepts an expense-only correction without reactivating worker or changing hours',async()=>{
    const before=await snapshot();
    await allowed(expense('contributor','expense-archived',{ expenseAmount:10.25,expenseNote:'Trajet archivé fictif' }));
    const after=await snapshot(),entry=row(after.payload,'expense-archived');
    assert.equal(entry.expenseAmount,10.25);assert.equal(getHouseTimeTotalAmount(entry),35.25);
    assert.deepEqual(after.payload.houseTrackingWorkers,before.payload.houseTrackingWorkers);
    assert.deepEqual(after.payload.housePayments,before.payload.housePayments);
    assert.equal(after.payload.houseTrackingWorkers.find(worker=>worker.id==='expense-archived-worker').status,'Inactif');
  });
  await check('monthly real projection and CSV count expense once, preserve privacy and untouched legacy arithmetic',async()=>{
    const originalProjection=await allowed(read(token('contributor')));
    await allowed(expense('contributor','expense-main',amountPatch));
    for(const who of ['owner','contributor','reader']) {
      const projection=await allowed(read(token(who))),main=projection.sources.timeEntries.find(entry=>entry.id==='expense-main');
      assert.notEqual(projection.sourceRevision,originalProjection.sourceRevision,'Expense edit invalidates the monthly source fingerprint');
      assert.equal(main.expenseAmount,48.6);assert.ok(!Object.hasOwn(main,'expenseNote'));
      assert.ok(!JSON.stringify(projection).includes('PRIVATE_'));assert.ok(!JSON.stringify(projection).includes(amountPatch.expenseNote));
      const calculations=buildMonthlyCharges(projection,2026),included=calculations.entries.find(entry=>entry.sourceId==='expense-main');
      assert.equal(included.amountCents,14860);assert.equal(included.hoursAmountCents,10000);assert.equal(included.expenseAmountCents,4860);
      assert.equal(calculations.months[9].hoursCents,17360,'October main148.60 + archived25 exactly once');
      const legacy=calculations.entries.find(entry=>entry.sourceId==='expense-legacy');assert.equal(legacy.amountCents,2000);
      const csv=exportDetailedChargesCsv(calculations,{ source:'hours' });
      assert.ok(csv.includes('48,60')||csv.includes('48.60'),'Monthly export includes the expense cents');
    }
  });
  await check('INSERT trigger path rejects invalid cents and accepts valid cents inside rolled-back fictional transactions',async()=>{
    const before=await snapshot();
    await sql.query('begin');
    try {
      await assert.rejects(sql.query("insert into public.crm_workspace_state(workspace_id,payload) values('expense-insert-check',$1)",[{ houseTimeEntries:[{ id:'insert-invalid',expenseAmount:48.601 }] }]),error=>error.message==='invalid_expense_amount');
    } finally { await sql.query('rollback'); }
    await sql.query('begin');
    try {
      await sql.query("insert into public.crm_workspace_state(workspace_id,payload) values('expense-insert-check',$1)",[{ houseTimeEntries:[{ id:'insert-valid',expenseAmount:48.6,expenseNote:'Insertion fictive' }] }]);
      assert.equal((await sql.query("select payload->'houseTimeEntries'->0->>'expenseAmount' amount from public.crm_workspace_state where workspace_id='expense-insert-check'")).rows[0].amount,'48.6');
    } finally { await sql.query('rollback'); }
    assert.deepEqual(await snapshot(),before);
  });
  writeFileSync(join(directory,'server-results.json'),JSON.stringify({ passed:true,checks:results.length,realAuth:true,realPostgREST:true,realPostgreSQLPersistence:true,fictionalDataOnly:true,productionWrites:0,results },null,2));
  console.log(JSON.stringify({ passed:true,checks:results.length,report:join(directory,'server-results.json') }));
} finally { await restore(); await sql.end(); }
