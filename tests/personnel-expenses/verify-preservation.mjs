/** Confirms unrelated fictional sources/ledgers remain exact, then restores owned test additions. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { connect, sql, rpc, login, directory } from '../prepaid-hours/server-local.mjs';
const output=process.env.PERSONNEL_EXPENSE_OUTPUT||'/private/tmp/personnel-expenses-checks';mkdirSync(output,{recursive:true});
const saved=JSON.parse(readFileSync(join(directory,'personnel-expenses-fixture.private.json'),'utf8'));
const fixture=JSON.parse(readFileSync(join(directory,'fixtures.private.json'),'utf8'));
const manifest=JSON.parse(readFileSync(join(directory,'app.private.json'),'utf8'));
const paths=['components/CRMApp.tsx','components/HouseTimeExpenseSummary.tsx','components/HouseTimeExpenseSummary.module.css','lib/houseTracking.ts','lib/i18n/catalogs/crm.ts'];
const hashes={};for(const path of paths){const sha=data=>createHash('sha256').update(data).digest('hex');const current=sha(readFileSync(path)),tested=sha(readFileSync(join(manifest.directory,path)));assert.equal(tested,current,'Tested source copy must match final source: '+path);hashes[path]=current;}
await connect();
try {
 const current=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 const changed=new Set(['personnel-expense-clement-0','personnel-expense-clement-7']);
 for(const key of Object.keys(saved.sources))if(key!=='houseTimeEntries')assert.deepEqual(current[key],saved.sources[key],key+' must remain exact');
 assert.equal(current.houseTimeEntries.length,saved.sources.houseTimeEntries.length);
 for(const old of saved.sources.houseTimeEntries){const next=current.houseTimeEntries.find(e=>e.id===old.id);assert.ok(next);if(changed.has(old.id)){for(const key of Object.keys(old))if(!['expenseAmount','expenseNote','updatedAt','updatedBy'].includes(key))assert.deepEqual(next[key],old[key],old.id+'.'+key);}else assert.deepEqual(next,old,old.id+' unchanged');}
 assert.equal(current.houseTimeEntries.find(e=>e.id==='personnel-expense-clement-0').expenseAmount,10.11);assert.equal(current.houseTimeEntries.find(e=>e.id==='personnel-expense-clement-7').expenseAmount,60.25);
 const token=await login(fixture.users.owner);
 const ledger=async()=>{const result=await rpc('crm_house_prepaid_state',token,{});assert.equal(result.status,200);return result.data;};
 const beforeRestore=await ledger();for(const key of ['settings','packages','allocations','summaries'])assert.deepEqual(beforeRestore[key],saved.ledger[key],key+' must remain exact');
 // Restore the exact business payload taken before this suite added its dedicated prefix.
 assert(!saved.before.houseTimeEntries.some(e=>e.id.startsWith('personnel-expense-')),'Only owned one-run fixture is restored');
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[saved.before]);
 const restored=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;assert.deepEqual(restored,saved.before);
 const afterRestore=await ledger();for(const key of ['settings','packages','allocations','summaries'])assert.deepEqual(afterRestore[key],saved.ledger[key],key+' preserved after owned fixture cleanup');
 writeFileSync(join(output,'preservation-results.json'),JSON.stringify({passed:true,sourceHashes:hashes,onlyChangesBeforeCleanup:['personnel-expense-clement-0 expenseAmount 10.10 -> 10.11','personnel-expense-clement-7 expenseAmount 48.60 -> 60.25 and reason'],unrelatedSourcesPaymentsHistoryExact:true,prepaidSettingsPackagesAllocationsSummariesExact:true,ownedFixtureCleanup:'Exact pre-suite business payload restored; all existing fictitious data retained',productionRequests:0},null,2));
 console.log('PASS tested source hashes match final implementation; unrelated sources/payments/history and prepaid ledger exact; original local business payload restored.');
} finally {await sql.end();}
