/** Actual local Auth -> RPC -> PostgreSQL; reuses the owned expenses bench. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureData } from '../house-expenses/fixture-data.mjs';
import { connect, sql, request, rpc, login, directory } from '../house-expenses/server-local.mjs';

const require = createRequire(import.meta.url);
assert.ok(process.env.HOUSE_QUARTER_COMPILED, 'HOUSE_QUARTER_COMPILED must point to compiled release helpers');
const { getHouseTimeHours, getHouseTimeAmount, getHouseTimeTotalAmount } = require(join(process.env.HOUSE_QUARTER_COMPILED, 'houseTracking.js'));
const users = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8')).users;
const historic = { ...fixtureData.houseTimeEntries[0], id:'quarter-historic', date:'2026-10-26', startTime:'08:07', endTime:'12:42', breakMinutes:0, hourlyRate:20, note:'Historique précis conservé' };
const baseline = structuredClone(fixtureData);
baseline.houseTimeEntries.push(historic);
const results = [];
const allowed = async promise => { const r=await promise; assert.ok(r.status>=200&&r.status<300, JSON.stringify(r)); return r.data; };
const denied = async promise => { const r=await promise; assert.ok(r.status>=400, 'Mutation unexpectedly accepted'); return r; };
const snapshot = async () => (await sql.query("select payload, updated_at::text revision from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0];
const moduleRead = who => allowed(rpc('crm_read_module', users[who].token, { p_module:'houseTracking' }));
const restore = () => sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [baseline]);
async function create(who, id, patch) {
  if(who==='owner') return rpc('crm_create_house_time_entry', users[who].token, { p_id:id, p_patch:patch, p_revision:(await snapshot()).revision });
  return rpc('crm_mutate_record', users[who].token, { p_module:'houseTracking', p_collection:'houseTimeEntries', p_id:id, p_patch:patch, p_revision:(await moduleRead(who)).revision, p_delete:false });
}
async function expense(who, patch) {
  return rpc('crm_update_house_time_expenses', users[who].token, { p_id:historic.id, p_patch:patch, p_revision:who==='owner'?(await snapshot()).revision:(await moduleRead(who)).revision });
}
async function reauthenticate(who) {
  const oldToken=users[who].token;
  const oldSession=JSON.parse(Buffer.from(oldToken.split('.')[1],'base64url').toString()).session_id;
  await allowed(request('/auth/v1/logout?scope=local', oldToken, undefined, 'POST'));
  assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1',[oldSession])).rows[0].n, 0, 'Old local session ended');
  users[who].token=await login(users[who]);
  const newSession=JSON.parse(Buffer.from(users[who].token.split('.')[1],'base64url').toString()).session_id;
  assert.notEqual(newSession,oldSession,'Reread uses a fresh authenticated session');
  assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1',[newSession])).rows[0].n,1);
}
async function check(name, run) {
  await restore();
  await run();
  results.push({name,passed:true});
  writeFileSync(join(directory,'quarter-hour-server-results.json'),JSON.stringify(results,null,2));
  console.log('PASS '+name);
}
await connect();
try {
  for(const user of Object.values(users)) user.token=await login(user);
  await check('real Auth full and restricted permission paths',async()=>{
    assert.equal((await allowed(rpc('crm_access_snapshot',users.owner.token))).fullAccess,true);
    assert.equal((await allowed(rpc('crm_access_snapshot',users.contributor.token))).fullAccess,false);
    assert.equal((await allowed(request('/auth/v1/user',users.owner.token))).id,users.owner.id);
    assert.equal((await allowed(request('/auth/v1/user',users.contributor.token))).id,users.contributor.id);
  });
  for(const who of ['owner','contributor']) await check(who+' saves exact HH:mm, break and midnight; sign out/sign in rereads identical times',async()=>{
    const before=await snapshot();
    const entries=[
      { ...fixtureData.houseTimeEntries[0],id:'quarter-'+who+'-day',startTime:'08:15',endTime:'12:45',breakMinutes:30, expectedHours:4 },
      { ...fixtureData.houseTimeEntries[0],id:'quarter-'+who+'-night',startTime:'23:45',endTime:'00:15',breakMinutes:0, expectedHours:0.5 }
    ];
    for(const {id,expectedHours,...patch} of entries) {
      await allowed(create(who,id,patch));
      assert.equal(getHouseTimeHours(patch),expectedHours);
      assert.equal(getHouseTimeAmount(patch),expectedHours*25);
    }
    await reauthenticate(who);
    const persisted=who==='owner'
      ? (await allowed(request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload',users[who].token)))[0].payload
      : (await moduleRead(who)).collections;
    for(const entry of entries) {
      const found=persisted.houseTimeEntries.find(row=>row.id===entry.id);
      for(const key of ['startTime','endTime','breakMinutes','hourlyRate']) assert.equal(found[key],entry[key]);
      assert.equal(getHouseTimeHours(found),entry.expectedHours);
    }
    const after=await snapshot();
    assert.deepEqual(after.payload.houseTimeEntries.filter(row=>!entries.some(entry=>entry.id===row.id)),before.payload.houseTimeEntries);
    for(const key of Object.keys(before.payload))if(key!=='houseTimeEntries') assert.deepEqual(after.payload[key],before.payload[key],key+' unchanged');
  });
  await check('server rejects non-quarter new times and readonly writes atomically',async()=>{
    const before=await snapshot();
    for(const who of ['owner','contributor']) for(const bad of [{startTime:'08:07'},{endTime:'12:44'}]) {
      const {id,...patch}=fixtureData.houseTimeEntries[0];
      await denied(create(who,'quarter-invalid-'+id,{...patch,...bad}));
      assert.deepEqual(await snapshot(),before);
    }
    const {id,...patch}=fixtureData.houseTimeEntries[0];
    await denied(create('reader','quarter-reader-'+id,patch));
    await denied(expense('reader',{expenseAmount:8}));
    await denied(rpc('crm_create_house_time_entry',null,{p_id:'quarter-anonymous',p_patch:patch,p_revision:before.revision}));
    assert.deepEqual(await snapshot(),before);
  });
  for(const who of ['owner','contributor']) await check(who+' expense-only update preserves precise historic hours, duration, labour amount and payments',async()=>{
    const before=await snapshot();
    const original=before.payload.houseTimeEntries.find(entry=>entry.id===historic.id);
    const duration=getHouseTimeHours(original), amount=getHouseTimeAmount(original);
    assert.equal(duration,275/60);
    await allowed(expense(who,{expenseAmount:48.6,expenseNote:'Trajet fictif'}));
    await reauthenticate(who);
    const readback=(await moduleRead(who)).collections.houseTimeEntries.find(entry=>entry.id===historic.id);
    const {expenseAmount,expenseNote,updatedAt,updatedBy,...unchanged}=readback;
    assert.deepEqual(unchanged,original);
    assert.equal(expenseAmount,48.6);assert.equal(expenseNote,'Trajet fictif');
    assert.equal(getHouseTimeHours(readback),duration);assert.equal(getHouseTimeAmount(readback),amount);
    assert.equal(getHouseTimeTotalAmount(readback),amount+48.6);
    const after=await snapshot();
    assert.deepEqual(after.payload.houseTimeEntries.filter(entry=>entry.id!==historic.id),before.payload.houseTimeEntries.filter(entry=>entry.id!==historic.id));
    for(const key of Object.keys(before.payload))if(key!=='houseTimeEntries') assert.deepEqual(after.payload[key],before.payload[key],key+' unchanged');
  });
} finally {
  await restore();
  await sql.end();
}
