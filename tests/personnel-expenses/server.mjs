/** Real Auth -> PostgREST -> PostgreSQL, only guarded fictional loopback stack. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, request, rpc, login, directory } from '../prepaid-hours/server-local.mjs';
const fixtures=JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const results=[];const output=process.env.PERSONNEL_EXPENSE_OUTPUT||'/private/tmp/personnel-expenses-checks';mkdirSync(output,{recursive:true});
const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const ok=async promise=>{const r=await promise;assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const denied=async promise=>{const r=await promise;assert.ok(r.status>=400,'must deny');return r;};
await connect();
try {
 for(const u of Object.values(fixtures.users))u.token=await login(u);
 const token=who=>fixtures.users[who].token;
 const source=async()=>(await sql.query("select payload,updated_at::text revision from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
 const projection=who=>ok(rpc('crm_read_module',token(who),{p_module:'houseTracking'}));
 const ledgerBefore=await ok(rpc('crm_house_prepaid_state',token('owner'),{}));
 const before=await source();
 const id='personnel-expense-clement-0';
 await test('restricted projections expose only authorised module; no-access and anonymous reads denied',async()=>{
  for(const who of ['owner','contributor','reader']){const read=await projection(who);assert.equal(read.collections.houseTimeEntries.filter(e=>e.id.startsWith('personnel-expense-')).length,14);assert.equal(read.collections.houseTimeEntries.find(e=>e.id===id).expenseAmount,10.1);if(who!=='owner')assert.equal(read.collections.contacts,undefined);}
  await denied(rpc('crm_read_module',token('none'),{p_module:'houseTracking'}));await denied(rpc('crm_read_module',null,{p_module:'houseTracking'}));
 });
 await test('read-only and no-access users cannot update expenses; failed saves preserve all payload fields',async()=>{
  const revision=(await projection('reader')).revision;
  for(const who of ['reader','none'])await denied(rpc('crm_update_house_time_expenses',token(who),{p_id:id,p_patch:{expenseAmount:1},p_revision:revision}));
  await denied(rpc('crm_update_house_time_expenses',null,{p_id:id,p_patch:{expenseAmount:1},p_revision:revision}));assert.deepEqual((await source()).payload,before.payload);
 });
 await test('authorised contributor saves one expense, re-reads persisted result and preserves hours/payments/forfaits/history',async()=>{
  const revision=(await projection('contributor')).revision;
  await ok(rpc('crm_update_house_time_expenses',token('contributor'),{p_id:id,p_patch:{expenseAmount:12.34,expenseNote:'Montant fictif confirmé'},p_revision:revision}));
  const saved=(await projection('reader')).collections.houseTimeEntries.find(e=>e.id===id);assert.equal(saved.expenseAmount,12.34);assert.equal(saved.expenseNote,'Montant fictif confirmé');
  const after=await source();const old=before.payload.houseTimeEntries.find(e=>e.id===id),next=after.payload.houseTimeEntries.find(e=>e.id===id);
  for(const key of Object.keys(old))if(!['expenseAmount','expenseNote','updatedAt','updatedBy'].includes(key))assert.deepEqual(next[key],old[key],key);
  assert.deepEqual(after.payload.houseTimeEntries.filter(e=>e.id!==id),before.payload.houseTimeEntries.filter(e=>e.id!==id));for(const key of Object.keys(before.payload))if(key!=='houseTimeEntries')assert.deepEqual(after.payload[key],before.payload[key],key);
  await denied(rpc('crm_update_house_time_expenses',token('contributor'),{p_id:id,p_patch:{expenseAmount:99},p_revision:revision}));
  const current=(await projection('contributor')).revision;await ok(rpc('crm_update_house_time_expenses',token('contributor'),{p_id:id,p_patch:{expenseAmount:old.expenseAmount,expenseNote:old.expenseNote},p_revision:current}));
  const ledgerAfter=await ok(rpc('crm_house_prepaid_state',token('owner'),{}));for(const key of ['settings','packages','allocations','summaries'])assert.deepEqual(ledgerAfter[key],ledgerBefore[key],key+' preserved');
 });
 writeFileSync(join(output,'server-results.json'),JSON.stringify({passed:results.length,results,evidence:'Real local Auth/PostgREST/PostgreSQL; fictitious records only; production never contacted'},null,2));
} finally {await sql.end();}
