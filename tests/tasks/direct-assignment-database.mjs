/** Direct Tasks assignment follow-up; real fictitious Auth/HTTP RPC on the
 * existing disposable loopback bench only. No reset, existing-data overwrite,
 * Production API, invitation email, or migration-history repair is permitted.
 * Published base: aeadd4c / canonical Tasks SQL SHA32160066611932453e25fc4a6b1314b6b484e66c9db10eeccf59f5bf0c588951.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {assertTasksTarget} from './local-target.mjs';

const migrationFile='supabase/migrations/20261007132122_tasks_direct_account_assignment.sql';
const source=readFileSync(migrationFile,'utf8');
const fixture=JSON.parse(readFileSync(process.env.TASKS_FIXTURE_FILE||'/private/tmp/oar-tasks-fixture.private.json','utf8'));
const status=JSON.parse(readFileSync(process.env.TASKS_STATUS_FILE||fixture.statusFile,'utf8'));
assertTasksTarget({api:status.API_URL,database:status.DB_URL,acknowledgement:process.env.TASKS_TEST_ACK});
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const run=randomUUID(),users={},taskIds=[],archives=[],results=[];
const output=process.env.TASKS_DIRECT_RESULTS||'/private/tmp/oar-tasks-direct-assignment-results.json';
const privateFixture=process.env.TASKS_DIRECT_FIXTURE||'/private/tmp/oar-tasks-direct-fixture.private.json';
const base=fixture.users,localPassword='Fictitious-Direct-Tasks-2026!';

async function request(path,user,body,method){
 const r=await fetch(status.API_URL+path,{method:method||(body===undefined?'GET':'POST'),headers:{apikey:status.ANON_KEY,
  ...(user?.token?{Authorization:'Bearer '+user.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
  body:body===undefined?undefined:JSON.stringify(body),redirect:'error'});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:r.status,data};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const reject=(r,code='42501')=>{assert(r.status>=400,JSON.stringify(r));assert.equal(r.data.code,code,JSON.stringify(r.data));};
const rpc=(name,user,args={})=>request('/rest/v1/rpc/'+name,user,args);
const read=async(user,id)=>ok(await rpc('crm_tasks_read',user,id?{p_id:id}:{}));
const mutate=(user,task,patch,extra={})=>rpc('crm_tasks_mutate',user,{p_request_id:randomUUID(),p_id:task.id,p_revision:task.revision,p_patch:patch,...extra});
async function create(user,patch){const id='direct-task-'+randomUUID();taskIds.push(id);return ok(await mutate(user,{id,revision:null},{title:'Tâche fictive affectation directe',...patch}));}
async function login(user){const data=ok(await request('/auth/v1/token?grant_type=password',null,{email:user.email,password:user.password}));user.token=data.access_token;return user;}
const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const selected=(table,order)=>sql.query('select * from '+table+' order by '+order).then(r=>r.rows);
const preservedTables={
 'public.crm_workspace_state':'workspace_id','public.crm_backups':'id','public.crm_tasks':'id',
 'public.crm_document_scopes':'provider,resource_id','public.crm_document_shares':'provider,resource_id,user_id',
 'public.crm_permission_events':'id','app_private.task_transition_backup':'source','app_private.task_legacy_archive':'source,task_id',
 'app_private.task_records':'id','app_private.task_assignments':'task_id,user_id','app_private.task_events':'id',
 'app_private.task_requests':'actor_id,request_id','app_private.task_identity_links':'user_id',
 'public.crm_access_profiles':'user_id','public.crm_module_grants':'user_id,module','public.app_memberships':'user_id,workspace_id'};
const before={};for(const[table,order]of Object.entries(preservedTables))before[table]=await selected(table,order);
const existingAuthIds=(await sql.query('select id from auth.users')).rows.map(r=>r.id);
const documentOid=(await sql.query("select 'app_private.document_allowed(text,text,boolean,boolean)'::regprocedure::oid oid")).rows[0].oid;
const ownerBody=(await sql.query("select prosrc from pg_proc where oid='app_private.tasks_recovery_owner()'::regprocedure")).rows[0].prosrc;

async function provision(key,options={}){
 const email=options.email||'direct-'+key+'-'+run+'@example.invalid';
 const user=ok(await request('/auth/v1/admin/users',{token:status.SERVICE_ROLE_KEY},{email,password:localPassword,email_confirm:options.confirmed!==false,user_metadata:options.metadata||{}}));
 const value={id:user.id,email,password:localPassword};users[key]=value;
 if(options.profile!==false)await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,$2,$3)',[user.id,options.active!==false,!!options.admin]);
 if(options.profile!==false){
  await sql.query('insert into public.app_memberships(user_id,workspace_id,role,status) values($1,$2,$3,$4)',[user.id,options.space||'oar',options.space==='izord'?'reader':'member',options.membershipStatus||'active']);
  if(options.grant!==false)await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'tasks',$2,$3)",[user.id,options.level||'contribute',options.sensitive||{delete:true,export:true}]);
 }
 if(options.banned)await sql.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1",[user.id]);
 if(options.anonymous)await sql.query('update auth.users set is_anonymous=true where id=$1',[user.id]);
 if(options.pending)await sql.query("insert into public.crm_access_invitations(email,token_hash,grants,assignments,created_by) values($1,$2,$3,'{}',$4)",[email,createHash('sha256').update(randomUUID()).digest(),{tasks:{level:'contribute',sensitive:{}}},base.creator.id]);
 return value;
}
async function removeAuth(user){
 await sql.query('delete from public.crm_module_grants where user_id=$1',[user.id]);
 await sql.query('delete from public.app_memberships where user_id=$1',[user.id]);
 await sql.query('delete from public.crm_access_profiles where user_id=$1',[user.id]);
 ok(await request('/auth/v1/admin/users/'+user.id,{token:status.SERVICE_ROLE_KEY},undefined,'DELETE'));
}
async function seedArchive(){
 const original={id:'direct-legacy-'+randomUUID(),title:'Historique fictif à gérer',status:'Terminé',notes:'Original historique intact',createdAt:'2021-01-01T00:00:00Z',completedAt:'2021-01-02T00:00:00Z',dueDate:'2021-01-02',linkedTo:'tasks-lead-fixture'};
 const sourceName='direct-review:'+run;taskIds.push(original.id);archives.push({source:sourceName,id:original.id,original});
 await sql.query('insert into app_private.task_legacy_archive(source,task_id,original) values($1,$2,$3)',[sourceName,original.id,original]);
 return ok(await rpc('crm_tasks_legacy_read',base.creator)).find(x=>x.source===sourceName&&x.taskId===original.id);
}
const recover=(entry,manager,assignees,user=base.creator)=>rpc('crm_tasks_legacy_recover',user,{p_source:entry.source,p_id:entry.taskId,p_revision:entry.revision,p_assignee_ids:assignees.map(u=>u.id),p_manager_id:manager.id,p_request_id:randomUUID()});

try{
 // The exact delivered migration runs once on this already-populated LOCAL stack.
 const hasLabel=(await sql.query("select to_regprocedure('app_private.task_account_label(uuid)') is not null present")).rows[0].present;
 if(!hasLabel||process.argv.includes('--apply-migration'))await sql.query(source);
 const definitions=['app_private.task_eligible(uuid)','app_private.task_account_label(uuid)','public.crm_tasks_directory()','public.crm_tasks_mutate(uuid,text,bigint,jsonb,boolean)','public.crm_tasks_legacy_recover(text,text,text,uuid[],uuid,uuid)','public.crm_tasks_legacy_manager(text,bigint,uuid,uuid)'];
 for(const signature of definitions){
  const name=signature.split('(')[0],marker=source.includes('create function '+name+'(')?'create function '+name+'(':'create or replace function '+name+'(';
  const start=source.indexOf(marker),end=source.indexOf('$$;',start)+3,body=source.slice(start,end).match(/\$\$([\s\S]*?)\$\$/)[1];
  const row=(await sql.query('select prosrc from pg_proc where oid=$1::regprocedure',[signature])).rows[0];assert.equal(row.prosrc,body,'Exact delivered function '+signature);
 }
 for(const[table,order]of Object.entries(preservedTables))assert.deepEqual(await selected(table,order),before[table],'Migration rewrote '+table);
 assert.equal((await sql.query("select prosrc from pg_proc where oid='app_private.tasks_recovery_owner()'::regprocedure")).rows[0].prosrc,ownerBody);
 assert.equal((await sql.query("select 'app_private.document_allowed(text,text,boolean,boolean)'::regprocedure::oid oid")).rows[0].oid,documentOid);
 for(const user of[base.creator,base.fullOther,base.contributor])await login(user);
 await provision('creator',{metadata:{full_name:'Nora Sans Liaison Fictive',verified_owner:true,general_admin:true,organization_member:true,contact_id:'invented'}});
 await provision('contributor',{metadata:{full_name:'Camille Homonyme Fictive'}});
 await provision('reader',{level:'read',sensitive:{},metadata:{display_name:'Camille Homonyme Fictive'}});
 await provision('email',{metadata:{full_name:'   ',name:{forged:'object'}}});
 await provision('long',{metadata:{full_name:'<b>Nom affiché</b>'+'x'.repeat(400),verified_owner:true}});
 await provision('longEmail',{email:'direct-'+run+'@'+'a'.repeat(55)+'.'+'b'.repeat(55)+'.example.invalid'});
 await provision('noTasks',{level:'none',admin:true,metadata:{verified_owner:true,general_admin:true,organization_member:true}});
 await provision('noGrant',{grant:false,pending:true});
 await provision('pending',{pending:true});
 await provision('inactive',{active:false});
 await provision('membershipInactive',{membershipStatus:'revoked'});
 await provision('otherSpace',{space:'izord'});
 await provision('noProfile',{profile:false});
 await provision('unconfirmed',{confirmed:false});
 await provision('banned',{banned:true});
 await provision('anonymous',{anonymous:true});
 await provision('deleted',{});await removeAuth(users.deleted);
 await login(users.creator);await login(users.contributor);await login(users.reader);
 await sql.query("notify pgrst,'reload schema'");

 await test('eligible unlinked accounts appear with only minimal confirmed account directory fields',async()=>{
  const directory=ok(await rpc('crm_tasks_directory',users.creator));
  for(const key of['creator','contributor','reader','email','long','longEmail']){
   const user=users[key],entry=directory.find(x=>x.userId===user.id);assert(entry,key+' missing');
   assert.deepEqual(Object.keys(entry).sort(),['access','detail','email','label','userId']);assert.equal(entry.email,user.email);assert.equal(entry.detail,user.email);
   assert.equal((await sql.query('select count(*)::int n from app_private.task_identity_links where user_id=$1',[user.id])).rows[0].n,0);
  }
  assert.equal(directory.find(x=>x.userId===users.creator.id).label,'Nora Sans Liaison Fictive');
  assert.equal(directory.find(x=>x.userId===users.email.id).label,users.email.email);
  assert.equal(directory.find(x=>x.userId===users.long.id).label.length,160);
  assert(users.longEmail.email.length>160);assert.equal(directory.find(x=>x.userId===users.longEmail.id).label,users.longEmail.email,'Fallback email remains complete');
  assert.equal(directory.find(x=>x.userId===base.contributor.id).label,base.contributor.label,'Confirmed label stays preferred');
  const homonyms=directory.filter(x=>[users.reader.id,users.contributor.id].includes(x.userId));assert.equal(homonyms.length,2);assert.equal(homonyms[0].label,homonyms[1].label);assert.notEqual(homonyms[0].email,homonyms[1].email);
  assert(directory.some(x=>x.userId===base.external.id),'Existing active OAR account with Client Contact now qualifies');
 });
 await test('inactive, deleted, banned, anonymous, unconfirmed, invited and no-Tasks accounts reject forged assignment IDs',async()=>{
  const directory=ok(await rpc('crm_tasks_directory',users.creator));
  for(const key of['noTasks','noGrant','pending','inactive','membershipInactive','otherSpace','noProfile','unconfirmed','banned','anonymous','deleted']){
   assert(!directory.some(x=>x.userId===users[key].id),key+' exposed');
   const id='direct-rejected-'+randomUUID();taskIds.push(id);reject(await mutate(users.creator,{id,revision:null},{title:'Affectation refusée',assigneeIds:[users[key].id]}));
   assert.equal((await sql.query('select count(*)::int n from app_private.task_records where id=$1',[id])).rows[0].n,0);
  }
 });
 let shared;
 await test('new creator and multiple recipients work without identity links, including a recipient with no login session',async()=>{
  assert.equal((await sql.query('select count(*)::int n from auth.sessions where user_id=$1',[users.email.id])).rows[0].n,0);
  shared=await create(users.creator,{notes:'Notes fictives directes',dueDate:'2026-11-01',priority:'urgent',assigneeIds:[users.contributor.id,users.reader.id,users.email.id]});
  assert.equal(shared.createdBy,users.creator.id);assert.equal(shared.createdByLabel,'Nora Sans Liaison Fictive');assert(shared.createdAt);
  assert.deepEqual(shared.assignees.map(x=>x.userId).sort(),[users.contributor.id,users.reader.id,users.email.id].sort());
  assert(shared.assignees.every(x=>x.active));assert.equal((await read(users.reader,shared.id))[0].id,shared.id);
  const createdAt=shared.createdAt;shared=ok(await mutate(users.creator,shared,{assigneeIds:[users.reader.id,users.email.id]}));
  reject(await rpc('crm_tasks_read',users.contributor,{p_id:shared.id}));
  shared=ok(await mutate(users.creator,shared,{assigneeIds:[users.contributor.id,users.reader.id,users.email.id]}));assert.equal(shared.createdAt,createdAt);
 });
 await test('contributor/reader/creator restrictions and nonparticipant administrator privacy remain server enforced',async()=>{
  shared=ok(await mutate(users.contributor,shared,{notes:'Note responsable fictive',status:'En cours'}));
  reject(await mutate(users.reader,shared,{notes:'Interdit'}));reject(await mutate(users.contributor,shared,{priority:'normal'}));
  reject(await mutate(users.contributor,shared,{}, {p_delete:true}));
  reject(await rpc('crm_tasks_read',base.fullOther,{p_id:shared.id}));assert(!(await read(base.fullOther)).some(x=>x.id===shared.id));
  reject(await mutate(base.fullOther,shared,{notes:'Admin hors participants'}));reject(await rpc('crm_tasks_history',base.fullOther,{p_id:shared.id}));
  assert(!ok(await rpc('crm_tasks_export',base.fullOther)).some(x=>x.id===shared.id));
  reject(await mutate(users.creator,shared,{createdBy:base.creator.id}),'22023');reject(await mutate(users.creator,shared,{createdAt:'2000-01-01T00:00:00Z'}),'22023');
  reject(await rpc('crm_tasks_legacy_read',users.creator));reject(await rpc('crm_tasks_legacy_read',base.fullOther));
 });
 await test('optional identity link and Contact classification no longer decide ordinary access or assignment',async()=>{
  const user=users.contributor;
  await sql.query('insert into app_private.task_identity_links(user_id,contact_id,label,confirmed_by) values($1,$2,$3,$4)',[user.id,'direct-unused-contact-'+run,'Libellé explicitement confirmé fictif',base.creator.id]);
  try{
   const entry=ok(await rpc('crm_tasks_directory',users.creator)).find(x=>x.userId===user.id);assert.equal(entry.label,'Libellé explicitement confirmé fictif');
   shared=ok(await mutate(users.creator,shared,{assigneeIds:[user.id,users.reader.id]}));
   assert.equal(shared.assignees.find(x=>x.userId===user.id).label,entry.label);
   await sql.query('delete from app_private.task_identity_links where user_id=$1',[user.id]);
   assert.equal(ok(await rpc('crm_tasks_directory',users.creator)).find(x=>x.userId===user.id).label,'Camille Homonyme Fictive');
   shared=ok(await mutate(user,shared,{notes:'Accès conservé sans liaison'}));assert.equal(shared.assignees.find(x=>x.userId===user.id).active,true);
   reject(await rpc('crm_tasks_legacy_read',user));
  }finally{await sql.query('delete from app_private.task_identity_links where user_id=$1',[user.id]);}
 });
 await test('grant/profile/membership/session revocation applies immediately and idempotent replay cannot bypass it',async()=>{
  const requestId=randomUUID(),originalArgs={p_request_id:requestId,p_id:shared.id,p_revision:shared.revision,p_patch:{status:'Terminé'}};
  shared=ok(await rpc('crm_tasks_mutate',users.contributor,originalArgs));const completedAt=shared.completedAt;assert(completedAt);
  try{
   await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='tasks'",[users.contributor.id]);
   reject(await rpc('crm_tasks_read',users.contributor,{p_id:shared.id}));reject(await rpc('crm_tasks_mutate',users.contributor,originalArgs));
   assert(!ok(await rpc('crm_tasks_directory',users.creator)).some(x=>x.userId===users.contributor.id));
   const own=(await read(users.creator,shared.id))[0];assert.equal(own.assignees.find(x=>x.userId===users.contributor.id).active,false);assert.equal(own.completedAt,completedAt);
  }finally{await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='tasks'",[users.contributor.id]);}
  assert.equal(ok(await rpc('crm_tasks_mutate',users.contributor,originalArgs)).revision,shared.revision);
  for(const [statement,restore]of[
   ["update public.crm_access_profiles set active=false where user_id=$1","update public.crm_access_profiles set active=true where user_id=$1"],
   ["update public.app_memberships set status='revoked' where user_id=$1 and workspace_id='oar'","update public.app_memberships set status='active' where user_id=$1 and workspace_id='oar'"]]){
   try{await sql.query(statement,[users.contributor.id]);reject(await rpc('crm_tasks_read',users.contributor,{p_id:shared.id}));}finally{await sql.query(restore,[users.contributor.id]);}
  }
  const sessionId=JSON.parse(Buffer.from(users.contributor.token.split('.')[1],'base64url').toString()).session_id;
  const old=(await sql.query('select not_after from auth.sessions where id=$1',[sessionId])).rows[0].not_after;
  try{await sql.query("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1",[sessionId]);reject(await rpc('crm_tasks_read',users.contributor,{p_id:shared.id}));}finally{await sql.query('update auth.sessions set not_after=$2 where id=$1',[sessionId,old]);}
 });
 await test('private verified-owner recovery accepts unlinked manager/assignees and preserves unknown author and historical originals',async()=>{
  const entry=await seedArchive();
  reject(await recover(entry,users.contributor,[users.contributor,users.reader],base.fullOther));
  ok(await recover(entry,users.contributor,[users.contributor,users.reader]));
  let task=(await read(users.contributor,entry.taskId))[0];assert.equal(task.createdBy,null);assert.equal(task.createdAt,'2021-01-01T00:00:00+00:00');
  assert.equal(task.managerId,users.contributor.id);assert.equal(task.managerLabel,'Camille Homonyme Fictive');assert.equal(task.managerActive,true);
  const archived=(await sql.query('select original from app_private.task_legacy_archive where source=$1 and task_id=$2',[entry.source,entry.taskId])).rows[0].original;
  assert.deepEqual(archived,archives.find(x=>x.id===entry.taskId).original);
  task=ok(await mutate(users.contributor,task,{priority:'important',dueDate:'2026-11-03'}));reject(await mutate(users.reader,task,{priority:'normal'}));
  reject(await rpc('crm_tasks_legacy_manager',base.fullOther,{p_id:task.id,p_revision:task.revision,p_manager_id:users.email.id,p_request_id:randomUUID()}));
  ok(await rpc('crm_tasks_legacy_manager',base.creator,{p_id:task.id,p_revision:task.revision,p_manager_id:users.email.id,p_request_id:randomUUID()}));
  await login(users.email);task=(await read(users.email,task.id))[0];assert.equal(task.managerId,users.email.id);assert.equal(task.managerLabel,users.email.email);
  assert(task.assignees.some(x=>x.userId===users.contributor.id),'Previous manager remains an assignee');
  try{await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='tasks'",[users.email.id]);
   const other=(await read(users.reader,task.id))[0];assert.equal(other.managerId,users.email.id);assert.equal(other.managerActive,false);
   reject(await mutate(users.contributor,other,{title:'Pas de transfert implicite'}));reject(await rpc('crm_tasks_read',users.email,{p_id:task.id}));
  }finally{await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='tasks'",[users.email.id]);}
  task=(await read(users.email,task.id))[0];assert.equal(task.createdBy,null);assert.equal(task.createdAt,'2021-01-01T00:00:00+00:00');
 });
 await test('task document scope, raw payload and raw table restrictions stay closed for nonparticipant accounts',async()=>{
  const resource='direct-doc-'+run;
  await sql.query("insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,folder,title) values('google-drive',$1,'tasks','tasks',$2,'documents','Pièce fictive')",[resource,shared.id]);
  try{
   const scope=await request('/rest/v1/crm_document_scopes?resource_id=eq.'+resource,base.fullOther);assert(scope.status>=400||scope.data.length===0,'Private document metadata exposed');
   const classify=await rpc('crm_classify_document',base.fullOther,{p_provider:'google-drive',p_resource:resource,p_collection:'leads',p_record:'tasks-lead-fixture',p_title:'Réclassification fictive',p_bank:false});reject(classify);
   const patch=await request('/rest/v1/crm_document_scopes?resource_id=eq.'+resource,base.fullOther,{module:'documents',collection:'documents'},'PATCH');assert(patch.status>=400);
   const raw=await request('/rest/v1/crm_tasks',users.creator);assert(raw.status>=400);
   const table=await request('/rest/v1/task_records',users.creator);assert(table.status>=400);
   const workspace=await request('/rest/v1/crm_workspace_state?select=payload',base.fullOther);assert.equal(workspace.status,200);assert(workspace.data.every(x=>!Object.hasOwn(x.payload,'tasks')));
  }finally{await sql.query("delete from public.crm_document_scopes where provider='google-drive' and resource_id=$1",[resource]);}
  const helper=(await sql.query("select has_function_privilege('anon','app_private.task_account_label(uuid)','execute') anon,has_function_privilege('authenticated','app_private.task_account_label(uuid)','execute') app")).rows[0];assert.deepEqual(helper,{anon:false,app:false});
 });
}finally{
 // Cleanup only this run's Tasks/archives. Existing historical IDs, audit and
 // unrelated collections are never reset or rewritten, even after a failure.
 if(taskIds.length){for(const table of['task_requests','task_events','task_assignments'])await sql.query('delete from app_private.'+table+' where task_id=any($1::text[])',[taskIds]);await sql.query('delete from app_private.task_records where id=any($1::text[])',[taskIds]);}
 for(const entry of archives)await sql.query('delete from app_private.task_legacy_archive where source=$1 and task_id=$2',[entry.source,entry.id]);
 for(const user of Object.values(users))await sql.query('delete from app_private.task_identity_links where user_id=$1',[user.id]);
 const uiKeys=['creator','contributor','reader','email'];
 for(const[key,user]of Object.entries(users))if(!uiKeys.includes(key)){
  await sql.query('delete from public.crm_access_invitations where email=$1',[user.email]);
  if((await sql.query('select count(*)::int n from auth.users where id=$1',[user.id])).rows[0].n)await removeAuth(user);
 }
 const preserved={};
 for(const[table,order]of Object.entries(preservedTables)){
  let after=await selected(table,order);
  if(['public.crm_access_profiles','public.crm_module_grants','public.app_memberships'].includes(table))after=after.filter(r=>existingAuthIds.includes(r.user_id));
  assert.deepEqual(after,before[table],'Existing data changed during direct-assignment tests: '+table);preserved[table]={rows:before[table].length,sha256:hash(before[table]),unchanged:true};
 }
 const uiUsers=Object.fromEntries(uiKeys.filter(k=>users[k]).map(k=>[k,users[k]]));
 writeFileSync(privateFixture,JSON.stringify({actualLocalAuth:true,disposableLocalOnly:true,statusFile:fixture.statusFile,app:'http://127.0.0.1:3198',users:uiUsers,existingVerifiedOwner:base.creator},null,2)+'\n',{mode:0o600});
 writeFileSync(output,JSON.stringify({results,passed:results.length===8&&results.every(r=>r.passed),actualLocalAuth:true,externalCalls:0,productionQueries:0,migrationFile,migrationSha256:createHash('sha256').update(source).digest('hex'),preserved,privateFixturePath:privateFixture},null,2)+'\n',{mode:0o600});
 await sql.end();
}
console.log('Direct-assignment local Auth/RPC checks: '+results.length+' passed. Existing rows preserved.');
