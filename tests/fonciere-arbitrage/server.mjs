/** Real Auth + PostgreSQL + PostgREST tests; no production, email, AI or Google calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect,sql,fixtureFile,output,ok,denied,login,payload,anonymous} from './local.mjs';
await connect();
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[];
for(const [name,user] of Object.entries(fixture.users))users[name]=await login(user);
const project=fixture.projects.assigned,privateMarker='PRIVATE_FAMILY_REMARK_7d456a',read=who=>ok(users[who].client.rpc('fonciere_arbitrage_read',{p_project:project}));
const vote=(who,choice,remark='',fingerprint)=>users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:fingerprint,p_choice:choice,p_remark:remark});
async function save(who,choice,remark=''){const state=await read(who);return ok(vote(who,choice,remark,state.fingerprint));}
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'server-progress.json'),JSON.stringify(checks,null,2));}
async function projectState(){return (await sql.query('select * from public.fonciere_projects where id=$1',[project])).rows[0];}
const calc=(a,b)=>a==='approved'&&b==='approved'?'approved':a==='refused'&&b==='refused'?'refused':[a,b].includes('deepen')?'deepen':'pending';
try{
 const migration=readdirSync('supabase/migrations').find(name=>name.endsWith('_arbitrage.sql'));assert(migration,'Arbitrage migration required');
 if(!(await sql.query("select to_regprocedure('public.fonciere_arbitrage_read(uuid)') t")).rows[0].t){await sql.query(readFileSync(join('supabase/migrations',migration),'utf8'));await new Promise(resolve=>setTimeout(resolve,500));}
 await test('Initial projects have no attributed opinions; server config requires two distinct real CRM accounts',async()=>{
  const initial=await read('contributor');assert.equal(initial.status,'pending');assert.equal(initial.private,false);assert(!initial.opinions);assert.equal(initial.pending.length,2);
  const config=await ok(users.admin.client.rpc('fonciere_arbitrage_config'));
  await denied(users.admin.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.vincent.id,p_ann_charlotte:users.vincent.id}));
  await denied(users.contributor.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.vincent.id,p_ann_charlotte:users.annCharlotte.id}));
  await ok(users.admin.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.vincent.id,p_ann_charlotte:users.annCharlotte.id}));
  const state=await read('vincent');assert.equal(state.canVote,'vincent');assert.equal(state.private,true);assert.equal(state.opinions?.vincent??null,null);assert.equal(state.opinions?.ann_charlotte??null,null);
 });
 await test('Read-only designated users vote independently; missing or blank required remarks fail on direct RPC',async()=>{
  const state=await read('vincent');for(const choice of ['refused','deepen'])await denied(vote('vincent',choice,'   ',state.fingerprint));
  await denied(vote('vincent','arbitrary','',state.fingerprint));
  await save('vincent','approved');const after=await read('annCharlotte');assert(after.pending.includes('ann_charlotte'));assert(!after.pending.includes('vincent'));assert.equal(after.status,'pending');
 });
 await test('All sixteen opinion combinations produce the specified ordered server status, including disagreement',async()=>{
  for(const a of ['pending','approved','refused','deepen'])for(const b of ['pending','approved','refused','deepen']){
   await save('vincent',a,['refused','deepen'].includes(a)?privateMarker+' Vincent '+a:'');await save('annCharlotte',b,['refused','deepen'].includes(b)?privateMarker+' Ann Charlotte '+b:'');
   const result=await read('vincent');assert.equal(result.status,calc(a,b),a+' / '+b);assert.equal(result.disagreement,a==='approved'&&b==='refused'||a==='refused'&&b==='approved',a+' / '+b);
  }
 });
 await test('Contributor/admin/stranger and impersonation parameters cannot submit either designated opinion',async()=>{
  const state=await read('vincent');for(const name of ['contributor','admin'])await denied(vote(name,'approved','',state.fingerprint));
  await denied(users.stranger.client.rpc('fonciere_arbitrage_read',{p_project:project}));await denied(vote('stranger','approved','',state.fingerprint));
  await denied(users.vincent.client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:state.fingerprint,p_choice:'approved',p_remark:'',p_slot:'ann_charlotte'}));
  await denied(anonymous.rpc('fonciere_arbitrage_read',{p_project:project}));await denied(users.vincent.client.rpc('fonciere_arbitrage_read',{p_project:fixture.projects.foreign}));
 });
 await test('Private remarks/history never enter ordinary reader/admin/list/project responses or direct table grants',async()=>{
  await save('vincent','refused',privateMarker);await save('annCharlotte','deepen',privateMarker+' second');
  const privateState=await read('vincent');assert(JSON.stringify(privateState).includes(privateMarker));assert(privateState.history.length>0);
  for(const who of ['contributor','admin']){const result=await read(who);assert.equal(result.private,false);assert(!result.opinions);assert(!result.history);assert(!JSON.stringify(result).includes(privateMarker));const list=await ok(users[who].client.rpc('fonciere_arbitrage_list'));assert(!JSON.stringify(list).includes(privateMarker));}
  assert(!JSON.stringify(await projectState()).includes(privateMarker));
  const tables=(await sql.query("select tablename from pg_tables where schemaname='app_private' and tablename like 'fonciere_arbitrage%'")).rows;
  assert(tables.length>0);for(const {tablename} of tables){const privileges=(await sql.query("select has_table_privilege('authenticated',$1,'select') readable,has_table_privilege('anon',$1,'select') anonymous",['app_private.'+tablename])).rows[0];assert.equal(privileges.readable,false);assert.equal(privileges.anonymous,false);}
 });
 await test('Votes survive fresh Auth; opinion changes preserve prior history and never alter project revision or Drive jobs',async()=>{
  const before=await projectState(),jobs=Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs where project_id=$1',[project])).rows[0].count);
  await save('vincent','approved',privateMarker+' approved');const historyCount=(await read('vincent')).history.length;users.vincent=await login(fixture.users.vincent);assert.equal((await read('vincent')).opinions.vincent.choice,'approved');
  await save('vincent','pending','withdrawn');const after=await projectState();assert.equal(after.revision,before.revision);assert.deepEqual(after.payload,before.payload);assert.equal(Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs where project_id=$1',[project])).rows[0].count),jobs);assert((await read('vincent')).history.length>historyCount);
 });
 await test('Simultaneous opinions serialize without invalidating or losing the first opinion',async()=>{
  const fingerprint=(await read('vincent')).fingerprint;
  await Promise.all([ok(vote('vincent','approved','same dossier',fingerprint)),ok(vote('annCharlotte','approved','same dossier',fingerprint))]);
  const state=await read('vincent');assert.equal(state.status,'approved');assert.equal(state.opinions.vincent.stale,false);assert.equal(state.opinions.ann_charlotte.stale,false);assert.equal(state.pending.length,0);
 });
 await test('Concurrent business edit rejects the old fingerprint, retains historical approvals, and requires reconfirmation',async()=>{
  const before=await read('vincent'),row=await projectState(),changed=structuredClone(row.payload);changed.data.description='Description métier modifiée après consultation';
  await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:row.revision,p_payload:changed,p_contact:'',p_agency_contact:''}));
  const error=await denied(vote('vincent','approved','draft remark survives client-side',before.fingerprint));assert.equal(error.code,'40001');const after=await read('vincent');assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.status,'pending');assert(after.opinions.vincent.stale&&after.opinions.ann_charlotte.stale);
  await save('vincent','approved');const one=await read('vincent');assert(one.pending.includes('ann_charlotte'));await save('annCharlotte','approved');assert.equal((await read('vincent')).status,'approved');
 });
 await test('Finalized saved document changes require reconfirmation; pending uploads and Drive bookkeeping do not',async()=>{
  const state=await read('vincent'),row=await projectState(),bytes=Buffer.from('%PDF-1.4\nFictitious approved source\n%%EOF');
  const path=await ok(users.admin.client.rpc('fonciere_register_asset',{p_project:project,p_revision:row.revision,p_kind:'pdf',p_size:bytes.length,p_mime:'application/pdf',p_name:'dossier-fictif.pdf',p_category:'agency'}));
  await ok(users.admin.client.storage.from('fonciere-documents').upload(path,bytes,{upsert:false,contentType:'application/pdf'}));await ok(users.admin.client.rpc('fonciere_finalize_asset',{p_asset:path.split('/')[1]}));
  assert.equal((await read('vincent')).fingerprint,state.fingerprint,'Orphan upload not part of saved dossier');
  const changed=structuredClone(row.payload);changed.sourceDocuments.push(path.split('/')[1]);await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:row.revision,p_payload:changed,p_contact:'',p_agency_contact:''}));assert.notEqual((await read('vincent')).fingerprint,state.fingerprint);assert.equal((await read('vincent')).status,'pending');
  await save('vincent','approved');await save('annCharlotte','approved');const current=await read('vincent');await sql.query("update app_private.fonciere_drive_jobs set error='Fictional retry bookkeeping' where project_id=$1",[project]);assert.equal((await read('vincent')).fingerprint,current.fingerprint);assert.equal((await read('vincent')).status,'approved');
 });
 await test('Revoked project access denies current JWT reads and votes; replacement account receives no old validation',async()=>{
  const current=await read('vincent');await sql.query('delete from public.fonciere_project_assignments where project_id=$1 and user_id=$2',[project,users.vincent.id]);await denied(users.vincent.client.rpc('fonciere_arbitrage_read',{p_project:project}));await denied(vote('vincent','approved','',current.fingerprint));
  await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2)',[project,users.vincent.id]);
  let config=await ok(users.admin.client.rpc('fonciere_arbitrage_config'));await ok(users.admin.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.successor.id,p_ann_charlotte:users.annCharlotte.id}));assert.equal((await read('successor')).status,'pending');assert.equal((await read('successor')).canVote,'vincent');await denied(vote('vincent','approved','',current.fingerprint));assert.equal((await read('vincent')).private,false);
  config=await ok(users.admin.client.rpc('fonciere_arbitrage_config'));await ok(users.admin.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.vincent.id,p_ann_charlotte:users.annCharlotte.id}));assert.equal((await read('vincent')).status,'pending');
 });
 // Leave a clean fictional approved dossier for the separate bank and browser campaigns.
 await save('vincent','approved',privateMarker+' approved for bank tests');await save('annCharlotte','approved','Ready for fictional bank draft');
 writeFileSync(join(output,'server-results.json'),JSON.stringify({passed:checks.length,checks,matrixCases:16,services:'Real local Auth/PostgREST/PostgreSQL/Storage',externalRequests:0,productionWrites:0},null,2));
}finally{await sql.end();}
