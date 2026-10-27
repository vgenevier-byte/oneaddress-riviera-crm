/** Calendar persistence on an owned real Auth/PostgreSQL/PostgREST stack only.
 * Reuses the audited loopback guard; all accounts/projects are fictional. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {connect,sql,fixtureFile,output,ok,denied,login,payload,anonymous,createFonciereRepository} from '../fonciere-arbitrage/local.mjs';
const require=createRequire(import.meta.url);
const {calculateProjectCalendar}=require('../../lib/fonciere/calendar');
const {createFonciereData}=require('../../lib/fonciere/model');
const {applyAgencyImport}=require('../../lib/fonciere/import');
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[];
for(const [name,user] of Object.entries(fixture.users))users[name]=await login(user);
await connect();
const initial=payload('Villa fictive — Calendrier'),values=initial.data.guided.values;
initial.data.worksHypothesis='Budget historique travaux';initial.data.resaleHypothesis='Échéance libre historique : après étude du marché';initial.data.rentalHypothesis='Commentaire locatif historique';
values.personalStrategy='rental_then_resale';values.worksHypothesis={amount:120000,level:'renovation',comment:'Commentaire à préserver',startDate:'2028-01-31',durationMonths:1};
values.resaleHypothesis={amount:900000,timing:'Deuxième semestre, à confirmer',comment:'Revente après location',receiptDelayMonths:6};
values.rentalHypothesis={mode:'long_term',amount:2500,period:'month',occupiedUnits:10,comment:'Loyer fictif',receiptDelayMonths:1};
const project=await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:initial,p_contact:'',p_agency_contact:''}));
for(const who of ['vincent','annCharlotte','contributor'])await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)',[project,users[who].id]);
fixture.projects.calendar=project;writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});
const row=async()=> (await sql.query('select * from public.fonciere_projects where id=$1',[project])).rows[0];
const read=who=>ok(users[who].client.rpc('fonciere_arbitrage_read',{p_project:project}));
const save=async next=>{const current=await row();return ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:current.revision,p_payload:next,p_contact:'',p_agency_contact:''}));};
const change=async fn=>{const next=structuredClone((await row()).payload);fn(next.data);await save(next);};
const approve=async who=>{const state=await read(who);return ok(users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:'approved',p_remark:'Avis fictif de test calendrier'}));};
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'calendar-server-progress.json'),JSON.stringify(checks,null,2));}
try{
 await test('Additive validation migration leaves existing projects, approvals, histories and Drive jobs byte-identical',async()=>{
  const fingerprint=async()=> (await sql.query("select md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by id) from public.fonciere_projects p),'')) projects,md5(coalesce((select string_agg(to_jsonb(o)::text,'' order by project_id,slot) from app_private.fonciere_arbitrage_opinions o),'')) opinions,md5(coalesce((select string_agg(to_jsonb(h)::text,'' order by id) from app_private.fonciere_arbitrage_history h),'')) history,md5(coalesce((select string_agg(to_jsonb(j)::text,'' order by id) from app_private.fonciere_drive_jobs j),'')) jobs")).rows[0];
  const before=await fingerprint(),migration=readdirSync('supabase/migrations').find(name=>name.endsWith('_fonciere_project_calendar.sql'));assert(migration);
  await sql.query(readFileSync(join('supabase/migrations',migration),'utf8'));assert.deepEqual(await fingerprint(),before);
 });
 await test('Structured assumptions persist through actual repository load, save, reload and a new Auth session',async()=>{
  let repository=createFonciereRepository(users.admin.client),loaded=await repository.loadProject(project);assert.deepEqual(loaded.data.guided.values,values);
  loaded.data.guided.values.worksHypothesis.durationMonths=3;loaded=await repository.saveProject({data:loaded.data,previous:loaded});assert.equal(loaded.data.guided.values.worksHypothesis.durationMonths,3);
  await ok(users.admin.client.auth.signOut());users.admin=await login(fixture.users.admin);repository=createFonciereRepository(users.admin.client);const refreshed=await repository.loadProject(project);assert.equal(refreshed.data.guided.values.worksHypothesis.durationMonths,3);assert.equal(refreshed.data.guided.values.resaleHypothesis.timing,'Deuxième semestre, à confirmer');assert.equal(refreshed.data.resaleHypothesis,initial.data.resaleHypothesis);
 });
 await test('Direct RPC rejects invalid dates and noninteger, negative, excessive or textual durations even in inactive scenarios',async()=>{
  const current=await row();
  for(const bad of ['2027-02-29','2028-02-30','2028-04-31','2028-13-01','2028-00-10','0000-01-01','2028-1-01','2028-01-01T00:00:00Z',42,{},true]){
   const next=structuredClone(current.payload);next.data.guided.values.worksHypothesis.startDate=bad;const result=await denied(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:current.revision,p_payload:next,p_contact:'',p_agency_contact:''}));assert.equal(result.code,'22023',String(bad));
  }
  for(const key of ['worksHypothesis','resaleHypothesis','rentalHypothesis'])for(const bad of [-1,0.25,1201,'3',true,{},[]]){
   const next=structuredClone(current.payload);next.data.guided.values.personalStrategy='resale';next.data.guided.values[key][key==='worksHypothesis'?'durationMonths':'receiptDelayMonths']=bad;const result=await denied(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:current.revision,p_payload:next,p_contact:'',p_agency_contact:''}));assert.equal(result.code,'22023');
  }
  const invalid=structuredClone(current.payload);invalid.data.guided.values.personalStrategy='agency_rental';assert.equal((await denied(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:current.revision,p_payload:invalid,p_contact:'',p_agency_contact:''}))).code,'22023');assert.equal((await row()).revision,current.revision);
 });
 await test('Null/empty missing dates and months remain missing; zero must persist explicitly and leap days remain civil dates',async()=>{
  await change(data=>{data.guided.values.worksHypothesis.startDate='';data.guided.values.worksHypothesis.durationMonths=null;data.guided.values.rentalHypothesis.receiptDelayMonths=null;});let saved=(await row()).payload.data,result=calculateProjectCalendar(saved);assert.equal(result.startDate,null);assert.equal(result.durationMonths,null);assert.equal(result.worksEndDate,null);assert.equal(result.firstReceiptMonths,null);
  await change(data=>{data.guided.values.worksHypothesis.durationMonths=0;data.guided.values.rentalHypothesis.receiptDelayMonths=0;});saved=(await row()).payload.data;result=calculateProjectCalendar(saved);assert.equal(result.durationMonths,0);assert.equal(result.firstReceiptMonths,0);assert.equal(result.firstReceiptDate,null);
  await change(data=>{data.guided.values.worksHypothesis.startDate='2028-02-29';});result=calculateProjectCalendar((await row()).payload.data);assert.equal(result.worksEndDate,'2028-02-29');assert.equal(result.firstRentDate,'2028-02-29');
  await change(data=>{data.guided.values.worksHypothesis.startDate=null;});assert.equal((await row()).payload.data.guided.values.worksHypothesis.startDate,null);
 });
 await test('Changing personal strategy conserves inactive values while calendar results use only the chosen scenario',async()=>{
  await change(data=>{data.guided.values.worksHypothesis.startDate='2028-01-31';data.guided.values.worksHypothesis.durationMonths=1;data.guided.values.rentalHypothesis.receiptDelayMonths=1;data.guided.values.resaleHypothesis.receiptDelayMonths=6;data.guided.values.personalStrategy='resale';});let saved=(await row()).payload.data,result=calculateProjectCalendar(saved);assert.equal(result.firstRentDate,null);assert.equal(result.firstReceiptDate,'2028-08-29');assert.equal(saved.guided.values.rentalHypothesis.receiptDelayMonths,1);
  await change(data=>{data.guided.values.personalStrategy='rental';});saved=(await row()).payload.data;result=calculateProjectCalendar(saved);assert.equal(result.saleReceiptDate,null);assert.equal(result.firstReceiptDate,'2028-03-29');assert.equal(saved.guided.values.resaleHypothesis.receiptDelayMonths,6);
  await change(data=>{data.guided.values.personalStrategy='rental_then_resale';data.guided.values.resaleHypothesis.receiptDelayMonths=0;});result=calculateProjectCalendar((await row()).payload.data);assert.equal(result.firstReceiptDate,'2028-03-29');assert.equal(result.inconsistentChronology,true);
  await change(data=>{data.guided.values.personalStrategy=null;});result=calculateProjectCalendar((await row()).payload.data);assert.equal(result.firstReceiptDate,null);assert.equal(result.firstRentDate,null);assert.equal(result.saleReceiptDate,null);
 });
 await test('Agency reimport persists factual corrections without replacing personal calendar, budgets, comments or legacy timing',async()=>{
  const repository=createFonciereRepository(users.admin.client),loaded=await repository.loadProject(project),incoming=createFonciereData();incoming.name='Nom issu agence';incoming.description='Description agence réimportée';incoming.guided.values.personalStrategy='resale';incoming.guided.values.worksHypothesis={startDate:'2030-01-01',durationMonths:12};
  const merged=applyAgencyImport(loaded.data,incoming,['description','worksHypothesis','resaleHypothesis','rentalHypothesis']);assert.deepEqual(merged.guided.values,loaded.data.guided.values);assert.equal(merged.resaleHypothesis,loaded.data.resaleHypothesis);const saved=await repository.saveProject({data:merged,previous:loaded});assert.deepEqual(saved.data.guided.values,loaded.data.guided.values);assert.equal(saved.data.description,incoming.description);
 });
 await test('A saved calendar change requires both designated approvals to be reconfirmed and retains their previous opinions',async()=>{
  await change(data=>{data.guided.values.personalStrategy='rental_then_resale';data.guided.values.resaleHypothesis.receiptDelayMonths=6;});await approve('vincent');await approve('annCharlotte');const before=await read('vincent');assert.equal(before.status,'approved');const oldFingerprint=before.fingerprint;
  await change(data=>{data.guided.values.worksHypothesis.durationMonths=4;});let after=await read('vincent');assert.notEqual(after.fingerprint,oldFingerprint);assert.equal(after.status,'pending');assert.equal(after.opinions.vincent.choice,'approved');assert(after.opinions.vincent.stale&&after.opinions.ann_charlotte.stale);assert.equal(after.pending.length,2);
  await approve('vincent');after=await read('vincent');assert.deepEqual(after.pending,['ann_charlotte']);await approve('annCharlotte');assert.equal((await read('vincent')).status,'approved');
 });
 await test('Repeated calendar displays, changed system time and read RPCs neither write nor invalidate approvals',async()=>{
  const before=await row(),state=await read('vincent'),jobs=(await sql.query('select count(*) from app_private.fonciere_drive_jobs where project_id=$1',[project])).rows[0].count,now=Date.now;
  try{for(const delta of [0,31*86400000,366*86400000]){Date.now=()=>now()+delta;for(let i=0;i<3;i++){calculateProjectCalendar(before.payload.data);assert.equal((await read('vincent')).fingerprint,state.fingerprint);}}}finally{Date.now=now;}
  assert.deepEqual(await row(),before);assert.equal((await read('vincent')).status,'approved');assert.equal((await sql.query('select count(*) from app_private.fonciere_drive_jobs where project_id=$1',[project])).rows[0].count,jobs);
 });
 await test('Read-only users load calendar but cannot save it; strangers and anonymous callers cannot access the project',async()=>{
  const current=await row(),next=structuredClone(current.payload);next.data.guided.values.worksHypothesis.durationMonths=5;const reader=createFonciereRepository(users.vincent.client),loaded=await reader.loadProject(project);assert.equal(loaded.data.guided.values.worksHypothesis.durationMonths,4);await denied(users.vincent.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:current.revision,p_payload:next,p_contact:'',p_agency_contact:''}));
  const invisible=await ok(users.stranger.client.from('fonciere_projects').select('id').eq('id',project));assert.equal(invisible.length,0);const anon=await anonymous.from('fonciere_projects').select('id').eq('id',project);assert(anon.error||anon.data.length===0);assert.deepEqual(await row(),current);
 });
 await test('Calendar validators and catalog remain unavailable as directly executable public functions',async()=>{
  for(const fn of ['app_private.fonciere_guided_catalog()','app_private.validate_fonciere_guided_scalar(jsonb,jsonb)']){const acl=(await sql.query("select has_function_privilege('anon',$1,'execute') anonymous,has_function_privilege('authenticated',$1,'execute') authenticated",[fn])).rows[0];assert.deepEqual(acl,{anonymous:false,authenticated:false});}
 });
 writeFileSync(join(output,'calendar-server-results.json'),JSON.stringify({passed:checks.length,checks,services:'Real local Auth/PostgREST/PostgreSQL/Storage',productionWrites:0,externalRequests:0},null,2));
}finally{await sql.end();}
