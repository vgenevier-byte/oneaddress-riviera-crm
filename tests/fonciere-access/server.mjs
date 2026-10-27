/** Actual loopback Auth/RPC/RLS/Storage matrix; no mail, AI or production endpoint. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { connect, sql, fixtureFile, directory, output, login, request, rpc, status, createFonciereData, createFonciereRepository, createGeneratorRepository, toPresentationData, anonymous, ok, denied } from './local.mjs';
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),users={},checks=[];
const test=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);writeFileSync(join(output,'server-progress.json'),JSON.stringify(checks,null,2));};
let admin;
async function adminData(){const result=await rpc('crm_admin_users',admin.token);assert.equal(result.status,200);return result.data;}
async function change(name,overrides={},extra={}){
 const data=await adminData(),current=data.users.find(user=>user.id===fixture.users[name].id);assert(current);
 const args={p_user:current.id,p_revision:current.revision,p_active:current.active,p_general_admin:current.generalAdmin,p_grants:{...current.modules,...overrides},p_izord_role:current.izordRole,p_assignments:current.assignments,p_fonciere_assignments:current.fonciereAssignments,...extra};
 const result=await rpc('crm_admin_save',admin.token,args);assert.equal(result.status,200,'Admin save '+name+': '+JSON.stringify(result.data));return result.data;
}
const grant=level=>({level,sensitive:{}});
async function projectRows(name){return ok(users[name].client.from('fonciere_projects').select('id').order('id'));}
async function presentationRows(name){return ok(users[name].client.from('izord_projects').select('id').order('id'));}
async function assetAccess(name,allowed){const result=await users[name].client.storage.from('fonciere-documents').download(fixture.asset.object_path);if(allowed){assert.equal(result.error,null,result.error?.message);assert(result.data.size>0);}else assert(result.error,'Private Storage denies '+name);}
async function taskResolve(name,refs){const result=await rpc('crm_task_targets_resolve',users[name].token,{p_refs:refs});assert.equal(result.status,200,'Task resolver '+name);return result.data;}
await connect();
try {
 for(const [name,user] of Object.entries(fixture.users))users[name]=await login(user);admin=users.admin;
 await test('Administration returns two independent assignment catalogues and separates connected user IDs from CRM contacts',async()=>{
  const data=await adminData();assert(data.fonciereProjects.some(row=>row.id===fixture.projects.assigned));assert(data.projects.some(row=>row.id===fixture.presentations.assigned));assert(!data.projects.some(row=>row.id===fixture.projects.assigned));assert(!data.fonciereProjects.some(row=>row.id===fixture.presentations.assigned));
  const row=data.users.find(user=>user.id===users.clement.id);assert(row.fonciereAssignments.includes(fixture.projects.assigned));assert(row.assignments.includes(fixture.presentations.assigned));assert.notEqual(row.id,'contact-fictitious-independent');
  for(const name of ['projectsOnly','presentationsOnly','both','neither','projectReader']){const r=await rpc('crm_admin_users',users[name].token);assert.notEqual(r.status,200);}
 });
 await test('Historical pending invitations keep their latent effective scope, including null role with existing active membership',async()=>{
  for(const [key,name,fonciere,presentation] of [['explicit','inviteRecipient',true,true],['nullMember','legacyNoGrant',true,true],['nullNoRole','denied',false,false]]){
   const pending=fixture.pendingInvitations[key],recipient=users[name];const accepted=await rpc('crm_invite_accept',recipient.token,{p_token:pending.token});assert.equal(accepted.status,204,'Accept legacy pending '+key);
   const snapshot=await ok(recipient.client.rpc('crm_access_snapshot'));assert.equal(Boolean(snapshot.modules.fonciere),fonciere,key+' latent Foncière module');assert.equal(Boolean(snapshot.modules.izord),presentation,key+' latent presentation module');
   if(key==='nullMember'){assert((await projectRows(name)).some(row=>row.id===fixture.projects.assigned));assert((await presentationRows(name)).some(row=>row.id===fixture.presentations.assigned));}
  }
 });
 await test('Real admin saves four independent Projets/Présentations combinations plus reader and insufficient-business-role profiles',async()=>{
  for(const [name,project,presentation] of [['projectsOnly','contribute','none'],['presentationsOnly','none','contribute'],['both','contribute','contribute'],['neither','none','none'],['projectReader','read','none'],['roleReader','contribute','none'],['contactsWriter','contribute','none']])await change(name,{fonciere:grant(project),izord:grant(presentation)});
  const data=await adminData(),row=data.users.find(u=>u.id===users.rolelessWriter.id);
  const rejected=await rpc('crm_admin_save',admin.token,{p_user:row.id,p_revision:row.revision,p_active:true,p_general_admin:false,p_grants:{fonciere:grant('contribute')},p_izord_role:null,p_assignments:[],p_fonciere_assignments:[]});assert.notEqual(rejected.status,200,'Business role required separately');
  await sql.query("insert into crm_module_grants(user_id,module,level,sensitive) values($1,'fonciere','contribute','{}') on conflict(user_id,module) do update set level='contribute'",[users.rolelessWriter.id]);
 });
 await test('RLS and direct RPC enforce module plus ownership/assignment and compatible role; contribution does not expose all dossiers',async()=>{
  for(const [name,project,presentation] of [['projectsOnly',true,false],['presentationsOnly',false,true],['both',true,true],['neither',false,false],['projectReader',true,false],['roleReader',true,false],['rolelessWriter',false,false]]){
   assert.equal((await projectRows(name)).some(row=>row.id===fixture.projects.assigned),project,name+' property scope');assert.equal((await presentationRows(name)).some(row=>row.id===fixture.presentations.assigned),presentation,name+' presentation scope');assert(!(await projectRows(name)).some(row=>row.id===fixture.projects.foreign),name+' unassigned private project hidden');
  }
  const saved=await createFonciereRepository(users.projectsOnly.client).loadProject(fixture.projects.assigned);
  for(const name of ['presentationsOnly','neither','projectReader','roleReader','rolelessWriter']){await assert.rejects(createFonciereRepository(users[name].client).saveProject({data:saved.data,previous:saved}),undefined,name+' direct write rejected');await denied(users[name].client.rpc('fonciere_register_asset',{p_project:saved.project.id,p_revision:saved.project.revision,p_kind:'pdf',p_size:20,p_mime:'application/pdf',p_name:'interdit.pdf'}));}
  for(const name of ['projectsOnly','both']){const created=await createFonciereRepository(users[name].client).saveProject({data:{...createFonciereData(),name:'Projet créé '+name},...(name==='projectsOnly'?{sourceFiles:[new File(['%PDF-1.4\nSource indépendante fictive\n%%EOF'],'source-projets-seul.pdf',{type:'application/pdf'})]}:{})});assert(created.project.id);if(name==='projectsOnly')assert.equal(created.sourceDocuments.length,1,'Source-only contribution can persist an actual private source attachment');}
  await denied(anonymous.from('fonciere_projects').select('*'));await denied(anonymous.rpc('fonciere_archive_project',{p_id:saved.project.id,p_expected_revision:saved.project.revision,p_archived:true}));
 });
 await test('Private project documents use the same independent permission boundaries',async()=>{
  for(const name of ['projectsOnly','both','projectReader','roleReader'])await assetAccess(name,true);
  for(const name of ['presentationsOnly','neither','rolelessWriter','denied'])await assetAccess(name,false);
  const deniedFile=await anonymous.storage.from('fonciere-documents').download(fixture.asset.object_path);assert(deniedFile.error);
 });
 await test('Existing guarded assignment RPC and admin save persist an assignment across real Auth reconnection, without granting all projects',async()=>{
  await change('clement',{fonciere:grant('read'),izord:grant('none')},{p_fonciere_assignments:[]});assert(!(await projectRows('clement')).some(row=>row.id===fixture.projects.assigned));
  await change('clement',{}, {p_fonciere_assignments:[fixture.projects.assigned]});
  users.clement=await login(fixture.users.clement);assert((await projectRows('clement')).some(row=>row.id===fixture.projects.assigned));assert(!(await projectRows('clement')).some(row=>row.id===fixture.projects.foreign));
  const forbidden=await users.projectsOnly.client.rpc('fonciere_assign_project',{p_project:fixture.projects.assigned,p_user:users.neither.id,p_assigned:true});assert(forbidden.error,'Non-admin business contributor cannot assign another user');
  const data=await adminData(),current=data.users.find(u=>u.id===users.clement.id);const legacy=await rpc('crm_admin_save',admin.token,{p_user:current.id,p_revision:current.revision,p_active:current.active,p_general_admin:current.generalAdmin,p_grants:Object.fromEntries(Object.entries(current.modules).filter(([key])=>key!=='fonciere')),p_izord_role:current.izordRole,p_assignments:current.assignments});assert.equal(legacy.status,200,'Old seven-argument administration save stays compatible when unaware of new key');
  const afterLegacy=(await adminData()).users.find(u=>u.id===users.clement.id);assert(afterLegacy.fonciereAssignments.includes(fixture.projects.assigned));assert.equal(afterLegacy.modules.fonciere.level,'read');
  const revision=afterLegacy.revision;
  const nativeRevoke=await rpc('fonciere_assign_project',admin.token,{p_project:fixture.projects.assigned,p_user:users.clement.id,p_assigned:false});assert.equal(nativeRevoke.status,204);const afterRevoke=(await adminData()).users.find(u=>u.id===users.clement.id);assert.equal(afterRevoke.revision,revision+1,'Native assignment revoke invalidates active views');assert(!(await projectRows('clement')).some(row=>row.id===fixture.projects.assigned));
  assert.equal((await rpc('fonciere_assign_project',admin.token,{p_project:fixture.projects.assigned,p_user:users.clement.id,p_assigned:false})).status,204);assert.equal((await adminData()).users.find(u=>u.id===users.clement.id).revision,revision+1,'No-op assignment does not invent a new revision');
  assert.equal((await rpc('fonciere_assign_project',admin.token,{p_project:fixture.projects.assigned,p_user:users.clement.id,p_assigned:true})).status,204);assert.equal((await adminData()).users.find(u=>u.id===users.clement.id).revision,revision+2);
 });
 await test('Task target search/resolution checks independent source modules and private document permissions on every call',async()=>{
  const refs=[{type:'fonciere_project',id:fixture.projects.assigned},{type:'presentation',id:fixture.presentations.assigned},{type:'document',id:fixture.asset.id,context:{catalog:'fonciere',projectId:fixture.projects.assigned}}];
  for(const [name,states] of [['projectsOnly',['available','inaccessible','available']],['presentationsOnly',['inaccessible','available','inaccessible']],['both',['available','available','available']],['neither',['inaccessible','inaccessible','inaccessible']]])assert.deepEqual((await taskResolve(name,refs)).map(row=>row.state),states,name+' task reference boundaries');
  const search=await rpc('crm_task_targets_search',users.projectsOnly.token,{p_query:'Villa affectée',p_type:'fonciere_project',p_offset:0,p_limit:40});assert.equal(search.status,200);assert(search.data.items.some(item=>item.ref.id===fixture.projects.assigned));
 });
 await test('Contacts remain independent; source-only contributor cannot read/create contacts, while separate Contacts grant can create then link canonically',async()=>{
  for(const name of ['projectsOnly','presentationsOnly','both']){const r=await rpc('crm_read_module',users[name].token,{p_module:'contacts'});assert.notEqual(r.status,200);await assert.rejects(createFonciereRepository(users[name].client).searchContacts('Camille'));}
  const repository=createFonciereRepository(users.contactsWriter.client),created=await repository.createContact({entityType:'person',name:'Fictif '+randomUUID(),firstName:'Camille',companyName:'',phone:'',city:'',postalAddress:'',email:'retour-'+randomUUID()+'@example.invalid'});assert(created.id);
  const saved=await repository.loadProject(fixture.projects.assigned),linked=await repository.saveProject({data:{...saved.data,agentContactId:created.id},previous:saved});assert.equal(linked.data.agentContactId,created.id);
  const hidden=await createFonciereRepository(users.projectsOnly.client).loadProject(fixture.projects.assigned);assert.equal(hidden.data.agentContactId,'');
 });
 await test('Creating or refreshing a presentation from a source requires both modules, while historical presentation snapshot survives source revocation',async()=>{
  const source=await createFonciereRepository(users.both.client).loadProject(fixture.projects.assigned),generator=createGeneratorRepository(users.both.client),presentation=await generator.createProject('Instantané source indépendant fictif');
  let saved=await generator.saveProject({project:presentation,data:toPresentationData(source.data,{id:source.project.id,revision:source.project.revision})});
  const before=structuredClone(saved.data),revision=saved.project.revision;
  const storedBefore=(await sql.query('select payload from izord_projects where id=$1',[presentation.id])).rows[0].payload;
  await change('both',{fonciere:grant('none')});
  assert(!(await projectRows('both')).some(row=>row.id===source.project.id));const retained=await generator.loadProject(presentation.id);assert.deepEqual(retained.data,before);assert.equal(retained.project.revision,revision);
  assert.deepEqual((await sql.query('select payload from izord_projects where id=$1',[presentation.id])).rows[0].payload,storedBefore);
  const changed=structuredClone(retained.data);changed.importMeta.fonciereSource.revision=source.project.revision+1;
  await assert.rejects(generator.saveProject({project:retained.project,data:changed,previous:retained}));
  // Independent presentation edit retains the historical source snapshot and its own ACL.
  const edited=structuredClone(retained.data);edited.state.project='Présentation conservée sans accès source';saved=await generator.saveProject({project:retained.project,data:edited,previous:retained});assert.equal(saved.data.state.project,edited.state.project);
  await assert.rejects(createGeneratorRepository(users.projectsOnly.client).createProject('Création présentation interdite'));
  await change('both',{fonciere:grant('contribute')});
 });
 await test('Module revocation immediately denies stale-session project RPC, private storage and task resolution without altering the historical data',async()=>{
  const repository=createFonciereRepository(users.projectsOnly.client),saved=await repository.loadProject(fixture.projects.assigned),before=JSON.stringify((await sql.query('select * from fonciere_projects where id=$1',[saved.project.id])).rows[0]);
  await change('projectsOnly',{fonciere:grant('none')});assert.deepEqual(await projectRows('projectsOnly'),[]);await assert.rejects(repository.loadProject(saved.project.id));await assert.rejects(repository.saveProject({data:saved.data,previous:saved}));await assetAccess('projectsOnly',false);
  assert.equal((await taskResolve('projectsOnly',[{type:'fonciere_project',id:saved.project.id}]))[0].state,'inaccessible');assert.equal(JSON.stringify((await sql.query('select * from fonciere_projects where id=$1',[saved.project.id])).rows[0]),before);
  await change('projectsOnly',{fonciere:grant('contribute')});
 });
 await test('Real local invitation prepare/accept retains independent grants and distinct assignments without sending an invitation',async()=>{
  for(const [kind,projects,presentations] of [['fonciere',true,false],['izord',false,true]]){
   const email='fonciere-invite-'+kind+'-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('hex');const created=await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true});assert.equal(created.status,200);const recipient=await login({id:created.data.id,email,password});
   const prepared=await rpc('crm_invite_prepare',admin.token,{p_email:email,p_grants:{[kind]:grant('read')},p_izord_role:'reader',p_assignments:presentations?[fixture.presentations.assigned]:[],p_fonciere_assignments:projects?[fixture.projects.assigned]:[]});assert.equal(prepared.status,200,'Prepare local '+kind+' invitation');
   const accepted=await rpc('crm_invite_accept',recipient.token,{p_token:prepared.data.token});assert.equal(accepted.status,204,'Accept local '+kind+' invitation');
   const signed=await login({id:created.data.id,email,password}),snapshot=await ok(signed.client.rpc('crm_access_snapshot'));assert.equal(Boolean(snapshot.modules.fonciere),projects);assert.equal(Boolean(snapshot.modules.izord),presentations);
   assert.equal((await ok(signed.client.from('fonciere_projects').select('id'))).some(row=>row.id===fixture.projects.assigned),projects);assert.equal((await ok(signed.client.from('izord_projects').select('id'))).some(row=>row.id===fixture.presentations.assigned),presentations);
  }
 });
 await test('Admin and all other historical module rights remain intact after targeted account edits; no anonymous privileged access',async()=>{
  const full=await ok(users.legacyFull.client.rpc('crm_access_snapshot'));assert.equal(full.fullAccess,true);assert.equal(full.generalAdmin,true);assert.equal((await adminData()).canAssignFonciere,true);
  const anon=await rpc('crm_admin_users',null);assert.notEqual(anon.status,200);
  const source=readFileSync(join(directory,'fonciere-access-before.private.json'),'utf8');const old=JSON.parse(source).crm_module_grants.filter(row=>row.user_id===users.legacyFull.id);const now=(await sql.query("select * from crm_module_grants where user_id=$1 and module<>'fonciere' order by 1,2",[users.legacyFull.id])).rows;assert.equal(createHash('sha256').update(JSON.stringify(now)).digest('hex'),createHash('sha256').update(JSON.stringify(old)).digest('hex'));
 });
 // Browser changes the fictional Clément account from no module/no assignment, proving an actual admin save.
 await change('clement',{fonciere:grant('none'),izord:grant('none')},{p_fonciere_assignments:[]});
 writeFileSync(fixtureFile,JSON.stringify({...fixture,serverComplete:true}),{mode:0o600});
 writeFileSync(join(output,'server-results.json'),JSON.stringify({passed:checks.length,checks,evidence:'Actual disposable loopback Auth/PostgREST/RPC/RLS/Storage, fictional identities only',productionRequests:0,realMailSends:0,paidAiCalls:0},null,2));
}finally{await sql.end();}
