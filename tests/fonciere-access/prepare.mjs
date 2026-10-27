/** Prepare fictional historical access before the permission split is applied. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { connect, sql, request, rpc, login, fixtureFile, directory, status, createFonciereRepository, createGeneratorRepository, createFonciereData, fullGrants } from './local.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const definitions = {
 admin:{admin:true,full:true,role:'admin',level:'contribute',export:true}, legacyFull:{admin:true,full:true},
 legacyReader:{role:'reader',level:'contribute'}, legacyReadContributor:{role:'contributor',level:'read'},
 legacyPartner:{role:'partner',level:'read',export:true}, legacyContributor:{role:'contributor',level:'contribute',export:true},
 legacyNoRole:{level:'contribute'}, legacyInactive:{role:'contributor',level:'contribute',active:false},
 legacyInactiveMembership:{role:'contributor',level:'contribute',membershipActive:false}, legacyNoGrant:{role:'contributor'},
 projectsOnly:{role:'contributor',level:'contribute'}, presentationsOnly:{role:'contributor',level:'contribute'},
 both:{role:'contributor',level:'contribute'}, neither:{role:'contributor',level:'contribute'},
 projectReader:{role:'contributor',level:'contribute'}, roleReader:{role:'reader',level:'contribute'},
 rolelessWriter:{}, clement:{role:'contributor',level:'contribute'}, contactsWriter:{role:'contributor',level:'contribute',contacts:true},
 inviteRecipient:{}, denied:{}
};
await connect();
try {
 const fresh=(await sql.query("select to_regclass('public.crm_workspace_state') t")).rows[0].t===null;
 if(!fresh){
  assert.equal(process.env.FONCIERE_ACCESS_RESUME,'1','Fresh owned stack only, or explicit incomplete fixture setup resume');
  assert.equal(Number((await sql.query('select count(*) from fonciere_projects')).rows[0].count),0,'Cannot resume over business fixtures');
  assert.equal(Number((await sql.query('select count(*) from izord_projects')).rows[0].count),0,'Cannot resume over presentation fixtures');
  assert.equal(Number((await sql.query("select count(*) from auth.users where email not like 'fonciere-access-%@example.invalid'")).rows[0].count),0,'Only this runner’s incomplete fictional accounts may be replaced');
  await sql.query('delete from crm_module_grants; delete from crm_access_profiles; delete from app_memberships');
  for(const row of (await sql.query('select id from auth.users')).rows){const removed=await request('/auth/v1/admin/users/'+row.id,status.SERVICE_ROLE_KEY,undefined,'DELETE');assert.equal(removed.status,200);}
 }
 const baseline=readFileSync('tests/izord/sql-fixture.sql','utf8');
 if(fresh){await sql.query(baseline.slice(baseline.indexOf('create table public.crm_workspace_state'),baseline.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");}
 const split=process.env.FONCIERE_ACCESS_MIGRATION||'20261027131656_fonciere_module_permissions.sql';
 assert.match(split,/^\d+_fonciere_module_permissions\.sql$/);
 assert(readdirSync('supabase/migrations').includes(split),'The exact split migration must exist and stay excluded from the historical fixture baseline');
 const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&name!==split&&!name.includes('fonciere_module_access')&&!name.includes('fonciere_access_separation')).sort();
 if(fresh)for(const name of migrations) { try { await sql.query(readFileSync(join('supabase/migrations',name),'utf8')); } catch(error) { throw new Error('Baseline migration '+name+': '+error.message); } }
 const users={};
 for(const [name,def] of Object.entries(definitions)) {
  const email='fonciere-access-'+name.toLowerCase()+'@example.invalid',password=randomBytes(24).toString('hex');
  const created=await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true});assert.equal(created.status,200,'Create fictional Auth account');
  const user={id:created.data.id,email,password};users[name]=user;
  await sql.query('insert into crm_access_profiles(user_id,active,general_admin) values($1,$2,$3)',[user.id,def.active!==false,def.admin??false]);
  if(def.full||def.contacts)await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member')",[user.id]);
  if(def.role)await sql.query("insert into app_memberships(user_id,workspace_id,role,status) values($1,'izord',$2,$3)",[user.id,def.role,def.membershipActive===false?'revoked':'active']);
  const grants={...(def.full?fullGrants:{}),...(def.level?{izord:{level:def.level,sensitive:def.export?{export:true}:{}}}:{}),...(def.contacts?{contacts:{level:'contribute',sensitive:{}}}:{})};
  if(name==='admin')Object.assign(grants,{monthlyCharges:{level:'read',sensitive:{export:true}},publisher:{level:'read',sensitive:{}}});
  if(['projectsOnly','presentationsOnly','both','neither','projectReader','roleReader','clement','contactsWriter'].includes(name))grants.tasks={level:'contribute',sensitive:{}};
  for(const [module,grant] of Object.entries(grants))await sql.query('insert into crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[user.id,module,grant.level,grant.sensitive??{}]);
  if(grants.tasks&&!def.full&&!def.contacts)await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member') on conflict do nothing",[user.id]);
 }
 await sql.query("update crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[{contacts:[{id:'contact-fictitious-independent',name:'Contact indépendant',firstName:'Camille',entityType:'person',kind:'Client',email:'contact-only@example.invalid'}],leads:[],tasks:[],properties:[],vehicles:[],boats:[],quotes:[],vendorQuotes:[],vendorInvoices:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[],documents:[],planningEntries:[]}]);
 const admin=await login(users.admin),owner=await login(users.legacyContributor),readOwner=await login(users.legacyReadContributor);
 const project=await createFonciereRepository(owner.client).saveProject({data:{...createFonciereData(),name:'Villa affectée fictive'}});
 const foreign=await createFonciereRepository(admin.client).saveProject({data:{...createFonciereData(),name:'Dossier privé non affecté'}});
 // A legacy read-only contributor can own a historical record without current write permission.
 await sql.query('insert into fonciere_projects(owner_id,title,payload) values($1,$2,$3)',[readOwner.id,'Dossier historique lecture',project.project.payload]);
 const presentation=await createGeneratorRepository(owner.client).createProject('Présentation historique fictive');
 const ownPresentation=await createGeneratorRepository(admin.client).createProject('Présentation privée non affectée');
 const assignedNames=['legacyReader','projectsOnly','presentationsOnly','both','neither','projectReader','roleReader','clement','contactsWriter'];
 for(const name of [...assignedNames,'legacyNoGrant']){await sql.query('insert into fonciere_project_assignments(project_id,user_id) values($1,$2)',[project.project.id,users[name].id]);await sql.query('insert into izord_project_assignments(project_id,user_id) values($1,$2)',[presentation.id,users[name].id]);}
 // Storage HTTP is used by the server campaign. This source is an actual local private object.
 const rich=await createFonciereRepository(owner.client).saveProject({data:project.data,previous:project,sourceFiles:[new File(['%PDF-1.4\nFictional private source\n%%EOF'],'source-fictive.pdf',{type:'application/pdf'})]});
 const pendingInvitations={};
 for(const [key,user,role,level,assignments] of [['explicit',users.inviteRecipient,'reader','read',[presentation.id]],['nullMember',users.legacyNoGrant,null,'contribute',[]],['nullNoRole',users.denied,null,'contribute',[]]]){
  const token=randomBytes(32).toString('hex');
  const inserted=await sql.query("insert into crm_access_invitations(email,token_hash,grants,izord_role,assignments,created_by) values($1,sha256(convert_to($2,'UTF8')),$3,$4,$5,$6) returning id",[user.email,token,{izord:{level,sensitive:{}}},role,assignments,users.admin.id]);
  pendingInvitations[key]={id:inserted.rows[0].id,token,userId:user.id};
 }
 const snapshotTables=['app_memberships','crm_access_profiles','crm_module_grants','crm_access_invitations','fonciere_projects','fonciere_project_assignments','fonciere_project_contacts','fonciere_assets','izord_projects','izord_project_assignments','izord_project_versions','izord_assets','fonciere_presentation_sources','crm_workspace_state'];
 const baselineRows={};for(const table of snapshotTables)baselineRows[table]=(await sql.query('select * from public.'+table+' order by 1,2')).rows;
 const effective={};
 for(const [name,user] of Object.entries(users)){
  const session=await login(user);
  const [projects,presentations,assets,snapshot]=await Promise.all([session.client.from('fonciere_projects').select('id').order('id'),session.client.from('izord_projects').select('id').order('id'),session.client.from('fonciere_assets').select('id').order('id'),session.client.rpc('crm_access_snapshot')]);
  assert.equal(projects.error,null);assert.equal(presentations.error,null);assert.equal(assets.error,null);assert.equal(snapshot.error,null);
  await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);
  const probes=(await sql.query('select app_private.can_fonciere_project($1,false) project_read,app_private.can_fonciere_project($1,true) project_write,app_private.can_project($2,false) presentation_read,app_private.can_project($2,true) presentation_write,app_private.full_access() full_access',[rich.project.id,presentation.id])).rows[0];await sql.query('rollback');
  effective[name]={projects:projects.data,presentations:presentations.data,assets:assets.data,probes,otherModules:Object.fromEntries(Object.entries(snapshot.data.modules).filter(([key])=>key!=='fonciere'))};
 }
 const fixture={api:status.API_URL,app:'http://127.0.0.1:3197',publicKey:status.ANON_KEY,users,projects:{assigned:rich.project.id,foreign:foreign.project.id},presentations:{assigned:presentation.id,foreign:ownPresentation.id},asset:rich.assets.find(asset=>asset.kind==='pdf'),pendingInvitations,migrationFiles:migrations,effectiveBefore:effective};
 writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});writeFileSync(join(directory,'fonciere-access-before.private.json'),JSON.stringify(baselineRows),{mode:0o600});
 writeFileSync(join(directory,'fonciere-access-baseline-hashes.json'),JSON.stringify(Object.fromEntries(Object.entries(baselineRows).map(([table,rows])=>[table,hash(rows)])),null,2),{mode:0o600});
 console.log('Prepared '+Object.keys(users).length+' fictional Auth accounts and legacy effective permission snapshots; all baseline business rows privately backed up.');
} finally {await sql.end();}
