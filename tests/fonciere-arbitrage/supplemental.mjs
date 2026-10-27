/** Additional races and recovery constraints using real disposable services. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect,sql,fixtureFile,output,ok,denied,login,payload,createFonciereRepository,createGeneratorRepository} from './local.mjs';
await connect();const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[];
for(const [name,user]of Object.entries(fixture.users))users[name]=await login(user);
const project=await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:payload('Projet fictif — vérifications complémentaires'),p_contact:'',p_agency_contact:''}));
for(const name of ['vincent','annCharlotte'])await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)',[project,users[name].id]);
const read=who=>ok(users[who].client.rpc('fonciere_arbitrage_read',{p_project:project}));
const row=async()=>ok(users.admin.client.from('fonciere_projects').select('*').eq('id',project).single());
async function saveData(data){const p=await row();await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:p.revision,p_payload:data,p_contact:'',p_agency_contact:''}));}
async function vote(who,choice,remark=''){const state=await read(who);return ok(users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:choice,p_remark:remark}));}
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 if(process.env.ARBITRAGE_PATCH){await sql.query("alter table app_private.fonciere_arbitrage_config_history alter column actor_id drop not null;alter table app_private.fonciere_arbitrage_config_history add column if not exists actor_source text not null default 'crm_account'");await sql.query(readFileSync(process.env.ARBITRAGE_PATCH,'utf8'));}
 await test('Whitespace-only remarks are rejected including tab/newline; exported comments remain independently owned',async()=>{
  const state=await read('vincent');for(const choice of ['refused','deepen'])await denied(users.vincent.client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:choice,p_remark:' \n\t\r '}));
 });
 await test('Business edit followed by exact revert never revives a previous approval',async()=>{
  await vote('vincent','approved');await vote('annCharlotte','approved');const before=await read('vincent'),original=(await row()).payload,changed=structuredClone(original);changed.data.description='Temporary business edit';await saveData(changed);await saveData(original);const after=await read('vincent');assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.status,'pending');assert(after.opinions.vincent.stale&&after.opinions.ann_charlotte.stale);
 });
 await test('Checked repository loading captures server fingerprint and rejects a business change during hydration',async()=>{
  const loaded=await createFonciereRepository(users.vincent.client).loadProject(project,{arbitration:true});assert.equal(loaded.arbitrationFingerprint,(await read('vincent')).fingerprint);
  const actualFrom=users.vincent.client.from.bind(users.vincent.client);let changed=false;
  function wrap(builder){return new Proxy(builder,{get(target,key){if(key==='maybeSingle')return async(...args)=>{const result=await target.maybeSingle(...args);if(!changed){changed=true;const p=await row(),next=structuredClone(p.payload);next.data.description='Changed while hydration in flight';await saveData(next);}return result;};const value=Reflect.get(target,key);return typeof value==='function'?(...args)=>{const result=value.apply(target,args);return result&&typeof result==='object'?wrap(result):result;}:value;}});}
  users.vincent.client.from=table=>table==='fonciere_project_contacts'?wrap(actualFrom(table)):actualFrom(table);
  try{await assert.rejects(createFonciereRepository(users.vincent.client).loadProject(project,{arbitration:true}),/autre modification|changed|relecture/i);}finally{users.vincent.client.from=actualFrom;}assert(changed);
 });
 await test('A user-edited reserved presentation shell blocks automatic overwrite and exposes intervention state',async()=>{
  await vote('vincent','approved');await vote('annCharlotte','approved');const reservation=await ok(users.admin.client.rpc('fonciere_bank_prepare',{p_project:project}));assert(reservation.presentationId&&reservation.token);const repository=createGeneratorRepository(users.admin.client),loaded=await repository.loadProject(reservation.presentationId),data=structuredClone(loaded.data);data.state.project='WORKED SHELL — DO NOT OVERWRITE';await repository.saveProject({project:loaded.project,previous:loaded,data,status:'draft'});
  const before=await ok(users.admin.client.from('izord_projects').select('*').eq('id',reservation.presentationId).single()),resumed=await ok(users.admin.client.rpc('fonciere_bank_prepare',{p_project:project}));assert(resumed.needsUpdate);const after=await ok(users.admin.client.from('izord_projects').select('*').eq('id',reservation.presentationId).single());assert.equal(after.revision,before.revision);assert.deepEqual(after.payload,before.payload);const state=await read('admin');assert.equal(state.bank.reason,'presentation_changed');assert.equal(state.bank.currentApproval,false);
 });
 writeFileSync(join(output,'supplemental-results.json'),JSON.stringify({passed:checks.length,checks,services:'Real local Auth/PostgREST/PostgreSQL; deterministic mutation timing on actual repository hydration',productionWrites:0},null,2));
}finally{await sql.end();}
