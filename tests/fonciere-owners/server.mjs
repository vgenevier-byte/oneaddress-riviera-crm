/** Owned local Auth/PostgreSQL/RPC verification. Never loads repository env files. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {connect,sql,fixtureFile,output,ok,denied,login,payload,anonymous,createFonciereRepository} from '../fonciere-arbitrage/local.mjs';
const require=createRequire(import.meta.url); const {createOwnerContext,createOwnerPerson}=require('../../lib/fonciere/owners');
await connect(); const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),checks=[],users={};
for(const [name,user] of Object.entries(fixture.users))users[name]=await login(user);
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'owners-server-progress.json'),JSON.stringify(checks,null,2));}
let project;
const state=async()=> (await sql.query('select * from public.fonciere_projects where id=$1',[project])).rows[0];
async function save(who,edit){const row=await state(),changed=structuredClone(row.payload);edit(changed);return users[who].client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:row.revision,p_payload:changed,p_contact:'',p_agency_contact:''});}
try{
 if(!(await sql.query("select to_regprocedure('public.fonciere_arbitrage_read(uuid)') t")).rows[0].t){const name=readdirSync('supabase/migrations').find(name=>name.endsWith('_arbitrage.sql'));await sql.query(readFileSync(join('supabase/migrations',name),'utf8'));await new Promise(resolve=>setTimeout(resolve,500));}
 const ids=fixture.owners ? {person1:fixture.owners.person1,person2:fixture.owners.person2,company:fixture.owners.company,representative:fixture.owners.representative} : {person1:randomUUID(),person2:randomUUID(),company:randomUUID(),representative:randomUUID()};
 const contacts=[{id:ids.person1,entityType:'person',firstName:'Camille',name:'Génévier',companyName:'',city:'Nice'},{id:ids.person2,entityType:'person',firstName:'Élodie',name:'Martin',companyName:'',city:'Nice'},{id:ids.company,entityType:'company',firstName:'',name:'',companyName:'SCI Azur fictive',city:'Nice'},{id:ids.representative,entityType:'person',firstName:'René',name:'Représentant',companyName:'SCI Azur fictive',companyId:ids.company,city:'Nice'}].map(c=>({kind:'Client',email:'',phone:'',postalAddress:'',notes:'',...c}));
 if(!fixture.owners)await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',coalesce(payload->'contacts','[]')||$1::jsonb) where workspace_id='oneaddress-riviera'",[JSON.stringify(contacts)]);
 project=fixture.owners?.project || await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:payload('Villa fictive — Propriétaires'),p_contact:'',p_agency_contact:''}));
 for(const who of ['contributor','vincent','annCharlotte'])await sql.query('insert into public.fonciere_project_assignments(project_id,user_id) values($1,$2) on conflict do nothing',[project,users[who].id]);
 fixture.owners={...ids,project}; writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});
 await test('Optional sole owner context saves, reauthenticates and reloads with real RPC/SQL',async()=>{
  await ok(save('admin',p=>{p.data.ownerContext=createOwnerContext();p.data.ownerContext.organization='sole';p.data.ownerContext.rights='full';p.data.ownerContext.declaredCount=1;p.data.ownerContext.owners=[{contactId:ids.person1,entityType:'person',note:'OWNER_PRIVATE_FICTITIOUS_MARKER',person:createOwnerPerson()}];}));
  const reconnect=await login(fixture.users.admin),repo=createFonciereRepository(reconnect.client),loaded=await repo.loadProject(project);assert.equal(loaded.data.ownerContext.owners[0].contactId,ids.person1);assert.equal(loaded.data.ownerContext.organization,'sole');
 });
 await test('Four declared indivision owners keep two identified contacts and full ownership',async()=>{
  await ok(save('admin',p=>{const c=p.data.ownerContext;c.organization='indivision';c.declaredCount=4;c.owners.push({contactId:ids.person2,entityType:'person',note:''});c.owners[0].person={...createOwnerPerson(),age:65,ageApproximate:true,ageAsOf:'2026-10-28',residenceCountry:'FR',nationalities:['GB','IE']};}));
  const c=(await state()).payload.data.ownerContext;assert.equal(c.declaredCount,4);assert.equal(c.owners.length,2);assert.equal(c.rights,'full');assert.deepEqual(c.owners[0].person.nationalities,['GB','IE']);
 });
 await test('Company owner, representative and split ownership remain separate identities',async()=>{
  await ok(save('admin',p=>{const c=p.data.ownerContext;c.rights='split';c.owners.push({contactId:ids.company,entityType:'company',note:''});c.representatives=[{contactId:ids.representative,ownerContactId:ids.company,role:'Gérant'}];c.primaryContactId=ids.representative;c.primaryRole='Gérant de la société propriétaire';}));
  const c=(await state()).payload.data.ownerContext;assert.equal(c.owners.length,3);assert(!c.owners.some(o=>o.contactId===ids.representative));assert.equal(c.representatives[0].ownerContactId,ids.company);
 });
 await test('Server rejects duplicate/forged contacts, company person profiles and malformed values',async()=>{
  for(const mutate of [c=>c.owners.push(c.owners[0]),c=>c.declaredCount=2.5,c=>c.owners[0].person.age=131,c=>c.owners[0].person.residenceCountry='France',c=>c.sale.listedOn='2026-02-30',c=>c.owners[2].person=createOwnerPerson(),c=>c.owners.push({contactId:randomUUID(),entityType:'person',note:''}),c=>c.representatives[0].contactId=ids.company])await denied(save('admin',p=>mutate(p.data.ownerContext)));
  assert.equal((await state()).payload.data.ownerContext.owners.length,3);
 });
 await test('Manual negotiation records actual actor/date and retains them across unrelated saves',async()=>{
  await ok(save('admin',p=>Object.assign(p.data.ownerContext.negotiation,{potential:'moderate',justification:'NEGOTIATION_PRIVATE_FICTITIOUS_MARKER',favorablePoints:'Fictif',blockingPoints:'À préciser',nextQuestion:'Quelle échéance ?',updatedBy:'forged',updatedAt:'2026-01-01T00:00:00Z'})));
  const before=(await state()).payload.data.ownerContext.negotiation;assert.equal(before.updatedBy,users.admin.id);assert.notEqual(before.updatedAt,'2026-01-01T00:00:00Z');
  await ok(save('admin',p=>{p.data.description='Simple correction fictive';p.data.ownerContext.negotiation.updatedBy='forged';}));assert.deepEqual((await state()).payload.data.ownerContext.negotiation,before);
 });
 await test('Contributor without Contacts can retain links and edit context; new identity links fail',async()=>{
  await ok(save('contributor',p=>{p.data.ownerContext.sale.openQuestions='Question interne sans accès Contacts';}));
  await denied(save('contributor',p=>{p.data.ownerContext.owners.pop();}));
  await denied(users.contributor.client.rpc('crm_read_module',{p_module:'contacts'}));
  const loaded=await createFonciereRepository(users.contributor.client).loadProject(project);assert.equal(loaded.data.ownerContext.sale.openQuestions,'Question interne sans accès Contacts');
 });
 await test('Project reader, unassigned contributor and anonymous access enforce existing project rights',async()=>{
  const read=await ok(users.vincent.client.from('fonciere_projects').select('id,payload').eq('id',project));assert.equal(read.length,1);assert(read[0].payload.data.ownerContext);
  await denied(save('vincent',p=>{p.data.ownerContext.sale.openQuestions='Denied';}));
  assert.equal((await ok(users.stranger.client.from('fonciere_projects').select('id').eq('id',project))).length,0);await denied(anonymous.from('fonciere_projects').select('id').eq('id',project));
 });
 await test('Omitted context in an old client payload preserves saved project-only information',async()=>{
  const before=(await state()).payload.data.ownerContext;await ok(save('admin',p=>{delete p.data.ownerContext;p.data.description='Old-client correction';}));assert.deepEqual((await state()).payload.data.ownerContext,before);
 });
 await test('Principal must be a linked person; same-save agency agent is accepted and removed links remain reviewable',async()=>{
  await denied(save('admin',p=>{p.data.ownerContext.primaryContactId=ids.company;}));
  await denied(save('admin',p=>{p.data.ownerContext.primaryContactId=randomUUID();}));
  const forgedRow=await state(),forged=structuredClone(forgedRow.payload);forged.data.ownerContext.primaryContactId=ids.company;forged.data.ownerContext.primaryRole='Forged company agent';
  await denied(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:forgedRow.revision,p_payload:forged,p_contact:ids.company,p_agency_contact:''}));
  const before=await state(),changed=structuredClone(before.payload);changed.data.ownerContext.owners=changed.data.ownerContext.owners.filter(o=>o.contactId!==ids.person1);changed.data.ownerContext.primaryContactId=ids.person1;changed.data.ownerContext.primaryRole='Agent du dossier';
  await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:before.revision,p_payload:changed,p_contact:ids.person1,p_agency_contact:''}));
  const after=await state();assert.equal(after.payload.data.ownerContext.primaryContactId,ids.person1);
  await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:after.revision,p_payload:before.payload,p_contact:'',p_agency_contact:''}));
 });
 await test('Linked owner and representative identities cannot silently disappear or change entity type in Contacts',async()=>{
  await assert.rejects(sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',(select jsonb_agg(c) from jsonb_array_elements(payload->'contacts') c where c->>'id'<>$1)) where workspace_id='oneaddress-riviera'",[ids.person1]),e=>e.code==='23503');
  await assert.rejects(sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',(select jsonb_agg(case when c->>'id'=$1 then jsonb_set(c,'{entityType}','\"company\"') else c end) from jsonb_array_elements(payload->'contacts') c)) where workspace_id='oneaddress-riviera'",[ids.representative]),e=>e.code==='23503');
 });
 await test('Represented-owner identity requires Contacts admission and a linked owner; unchanged orphan remains reviewable',async()=>{
  await denied(save('contributor',p=>{p.data.ownerContext.representatives[0].ownerContactId=ids.person1;}));
  await denied(save('admin',p=>{p.data.ownerContext.representatives[0].ownerContactId=randomUUID();}));
  await ok(save('admin',p=>{p.data.ownerContext.representatives[0].ownerContactId=ids.person1;}));
  assert.equal((await state()).payload.data.ownerContext.representatives[0].ownerContactId,ids.person1);
  const before=await state();await ok(save('admin',p=>{p.data.ownerContext.owners=p.data.ownerContext.owners.filter(o=>o.contactId!==ids.person1);}));
  await ok(save('contributor',p=>{p.data.ownerContext.sale.openQuestions='Orphan link retained explicitly for review';}));
  const after=await state();assert.equal(after.payload.data.ownerContext.representatives[0].ownerContactId,ids.person1);assert(!after.payload.data.ownerContext.owners.some(o=>o.contactId===ids.person1));
  await ok(users.admin.client.rpc('fonciere_save_project',{p_id:project,p_expected_revision:after.revision,p_payload:before.payload,p_contact:'',p_agency_contact:''}));
 });
 await test('Source contact and document references require authorized existing identities',async()=>{
  await denied(save('admin',p=>{p.data.ownerContext.sale.information.contactId=randomUUID();}));
  await denied(save('admin',p=>{p.data.ownerContext.sale.information.documentId=randomUUID();}));
  await ok(save('admin',p=>{p.data.ownerContext.sale.information={source:'contact',contactId:ids.person1,documentId:'',detail:'Communiqué oralement',date:'2026-10-28',confirmation:'confirm'};}));
 });
 await test('Owner edit invalidates saved arbitration; derived display reads do not write',async()=>{
  const config=await ok(users.admin.client.rpc('fonciere_arbitrage_config'));await ok(users.admin.client.rpc('fonciere_arbitrage_config_save',{p_revision:config.revision,p_vincent:users.vincent.id,p_ann_charlotte:users.annCharlotte.id}));
  const read=()=>ok(users.vincent.client.rpc('fonciere_arbitrage_read',{p_project:project}));let a=await read();for(const who of ['vincent','annCharlotte'])await ok(users[who].client.rpc('fonciere_arbitrage_vote',{p_project:project,p_fingerprint:a.fingerprint,p_choice:'approved',p_remark:''}));assert.equal((await read()).status,'approved');
  const unchanged=await state();await createFonciereRepository(users.admin.client).loadProject(project);assert.equal((await state()).revision,unchanged.revision);assert.equal((await read()).fingerprint,a.fingerprint);
  await ok(save('admin',p=>{p.data.ownerContext.sale.priceReductions='Baisse annoncée fictive';}));a=await read();assert.equal(a.status,'pending');assert(a.opinions.vincent.stale);assert(a.opinions.ann_charlotte.stale);
 });
 await test('Private validators have no public execution privilege; hidden ownerContext rejected at presentation persistence',async()=>{
  const procedures=['fonciere_owner_schema()','validate_fonciere_owner_shape(jsonb,jsonb)','validate_fonciere_payload(uuid,jsonb)','contains_fonciere_owner_context(jsonb)'];
  for(const signature of procedures){const row=(await sql.query("select has_function_privilege('authenticated',$1,'execute') a,has_function_privilege('anon',$1,'execute') b",['app_private.'+signature])).rows[0];assert.equal(row.a,false);assert.equal(row.b,false);}
  // Invoke actual trigger with a new draft shell; all statement data stays fictional.
  await assert.rejects(sql.query("insert into public.izord_projects(owner_id,title,status,payload) values($1,'Fictional hidden context','draft',$2)",[users.admin.id,{schema:'IZORD_PROJECT_V1',data:{importMeta:{nested:[{ownerContext:{secret:'HIDDEN_FICTITIOUS'}}]}}}]),e=>e.code==='22023'&&e.message==='presentation_owner_context_forbidden');
 });
 await test('New project has no inherited owner claims, negotiation or internal provenance',async()=>{
  const id=await ok(users.admin.client.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:payload('Second projet fictif sans héritage'),p_contact:'',p_agency_contact:''}));const c=(await ok(users.admin.client.from('fonciere_projects').select('payload').eq('id',id).single())).payload.data.ownerContext;assert.deepEqual(c,createOwnerContext());
 });
 writeFileSync(join(output,'owners-server-results.json'),JSON.stringify({passed:checks.length,checks,services:'Real local Auth/PostgREST/PostgreSQL',productionWrites:0},null,2));
}finally{await sql.end();}
