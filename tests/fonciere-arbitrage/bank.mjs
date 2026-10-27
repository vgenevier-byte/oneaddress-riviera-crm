/** Persistent bank draft checks against real local Auth/RPC/Storage.
 * The one lost HTTP response below is deliberately simulated after a real commit. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {connect,sql,fixtureFile,output,ok,login,createGeneratorRepository,toPresentationData,payload} from './local.mjs';
const require=createRequire(import.meta.url),{prepareBankPresentation}=require('../../lib/fonciere/bankPresentation'),{notesText}=require('../../lib/izord/presentation-notes'),{calculate}=require('../../lib/izord/finance');
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[];let project;
for(const [name,user] of Object.entries(fixture.users))users[name]=await login(user);
await connect();
const presentationBaseline=Number((await sql.query('select count(*) from public.izord_projects')).rows[0].count);
const initial=payload('Villa fictive — Dossier bancaire');initial.data.description='Données effectivement approuvées';
project=await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:initial,p_contact:'',p_agency_contact:''}));
for(const name of ['vincent','annCharlotte','contributor'])await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)',[project,users[name].id]);
const pdf=Buffer.from('%PDF-1.4\nFictitious approved source\n%%EOF'),path=await ok(users.admin.client.rpc('fonciere_register_asset',{p_project:project,p_revision:1,p_kind:'pdf',p_size:pdf.length,p_mime:'application/pdf',p_name:'dossier-banque-fictif.pdf',p_category:'agency'}));
await ok(users.admin.client.storage.from('fonciere-documents').upload(path,pdf,{upsert:false,contentType:'application/pdf'}));await ok(users.admin.client.rpc('fonciere_finalize_asset',{p_asset:path.split('/')[1]}));initial.sourceDocuments.push(path.split('/')[1]);await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:1,p_payload:initial,p_contact:'',p_agency_contact:''}));
fixture.projects.bank=project;
const read=who=>ok(users[who].client.rpc('fonciere_arbitrage_read',{p_project:project}));
async function vote(who,choice,remark=''){const state=await read(who);return ok(users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:choice,p_remark:remark}));}
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'bank-progress.json'),JSON.stringify(checks,null,2));}
try{
 await vote('vincent','approved','PRIVATE_FAMILY_REMARK_7d456a bank');await vote('annCharlotte','approved');
 await test('Read-only voters keep approval when bank preparation is denied by separate transfer/presentation permissions',async()=>{
  assert.equal((await read('vincent')).status,'approved');const before=Number((await sql.query('select count(*) from public.izord_projects')).rows[0].count);await assert.rejects(prepareBankPresentation(users.vincent.client,project));assert.equal((await read('vincent')).status,'approved');assert.equal((await read('vincent')).bank.state,'blocked');assert.equal(Number((await sql.query('select count(*) from public.izord_projects')).rows[0].count),before);
 });
 await test('Snapshot remains exact across a later source edit; lost finalization response and concurrent retry create one draft',async()=>{
  const approved=(await sql.query('select * from public.fonciere_projects where id=$1',[project])).rows[0],approvedDescription=approved.payload.data.description,actualRpc=users.admin.client.rpc.bind(users.admin.client);let edited=false,lost=false;
  users.admin.client.rpc=(name,args,...rest)=>{
   const call=actualRpc(name,args,...rest);if(!['fonciere_bank_prepare','fonciere_bank_finish'].includes(name))return call;
   return Promise.resolve(call).then(async result=>{
    if(name==='fonciere_bank_prepare'&&result.data?.token&&!edited){edited=true;const changed=structuredClone(approved.payload);changed.data.description='VERSION ULTÉRIEURE NON APPROUVÉE';await ok(actualRpc('fonciere_save_project',{p_id:project,p_expected_revision:approved.revision,p_payload:changed,p_contact:'',p_agency_contact:''}));}
    if(name==='fonciere_bank_finish'&&!result.error&&!lost){lost=true;return {...result,data:null,error:{message:'Simulated lost response after committed finalize',code:'NETWORK_LOST'}};}return result;
   });
  };
  try{await assert.rejects(prepareBankPresentation(users.admin.client,project));}finally{users.admin.client.rpc=actualRpc;}
  assert(edited&&lost,'Real snapshot save/finalize executed before simulated response loss');
  const stale=await read('admin');assert.equal(stale.bank.currentApproval,false);await vote('vincent','approved');await vote('annCharlotte','approved');await Promise.all(Array.from({length:4},()=>prepareBankPresentation(users.admin.client,project)));
  const state=await read('admin');assert(state.bank.presentationId);assert.equal(state.bank.state,'ready');assert.equal(state.bank.needsUpdate,true);const rows=(await sql.query('select * from public.izord_projects where id=$1',[state.bank.presentationId])).rows;assert.equal(rows.length,1);const target=rows[0];assert.equal(target.id,state.bank.presentationId);assert.equal(target.status,'draft');
  assert.equal(target.payload.data.importMeta.fonciereSnapshot.fields.description,approvedDescription);assert.equal(target.payload.data.importMeta.fonciereSource.revision,approved.revision);assert.equal(target.payload.data.state.project,approved.project_reference+' — '+approved.payload.data.name+' — Dossier bancaire');assert(!JSON.stringify(target.payload).includes('VERSION ULTÉRIEURE NON APPROUVÉE'));
  fixture.bankPresentation=target.id;writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});
 });
 await test('Bank JSON metadata, presentation state and PowerPoint speaker notes exclude private family remarks; source PDF copied exactly',async()=>{
  const state=await read('admin'),generator=createGeneratorRepository(users.admin.client),loaded=await generator.loadProject(state.bank.presentationId),serialized=JSON.stringify(loaded.data);assert(!serialized.includes('PRIVATE_FAMILY_REMARK_7d456a'));assert(!JSON.stringify(loaded.project.payload).includes('PRIVATE_FAMILY_REMARK_7d456a'));
  const notes=notesText(loaded.data.state,calculate(loaded.data.state),loaded.data.importMeta);assert(!notes.includes('PRIVATE_FAMILY_REMARK_7d456a'));
  assert(loaded.sourceDocuments.length>0,'Approved compatible PDF source copied');for(const ref of loaded.sourceDocuments){const asset=loaded.assets.find(a=>a.id===ref);assert(asset);const bytes=await ok(users.admin.client.storage.from('izord-documents').download(asset.object_path));assert(Buffer.from(await bytes.arrayBuffer()).includes(Buffer.from('Fictitious approved source')));}
 });
 await test('A worked presentation survives new double approval and retry without silent overwrite or duplicate',async()=>{
  const state=await read('admin'),generator=createGeneratorRepository(users.admin.client),loaded=await generator.loadProject(state.bank.presentationId),data=structuredClone(loaded.data);data.state.decisionNotes='EXPLICIT BANK WRITING TO KEEP';await generator.saveProject({project:loaded.project,previous:loaded,data,status:'draft'});
  const before=(await sql.query('select * from public.izord_projects where id=$1',[state.bank.presentationId])).rows[0];await vote('vincent','approved','PRIVATE_FAMILY_REMARK_7d456a new approval');await vote('annCharlotte','approved');await prepareBankPresentation(users.admin.client,project);
  const after=(await sql.query('select * from public.izord_projects where id=$1',[state.bank.presentationId])).rows[0];assert.equal(after.revision,before.revision);assert.deepEqual(after.payload,before.payload);assert.equal((await read('admin')).bank.needsUpdate,true);assert.equal(Number((await sql.query('select count(*) from public.izord_projects')).rows[0].count),presentationBaseline+1);
 });
 await test('Withdrawing an opinion recalculates the project while preserving the bank draft and opinion history',async()=>{
  await vote('annCharlotte','pending','');const state=await read('admin');assert.equal(state.status,'pending');assert.equal(state.bank.currentApproval,false);assert(state.bank.presentationId);assert.equal(Number((await sql.query('select count(*) from public.izord_projects')).rows[0].count),presentationBaseline+1);
 });
 writeFileSync(join(output,'bank-results.json'),JSON.stringify({passed:checks.length,checks,services:'Real local Auth/PostgREST/PostgreSQL/Storage',simulatedBoundary:'One response lost after actual committed finalization',productionWrites:0,googleRequests:0},null,2));
}finally{await sql.end();}
