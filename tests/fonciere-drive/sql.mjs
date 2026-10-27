/** Real owned PostgreSQL/Auth/Storage campaign. Google transport is not used. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);require('../i18n/register-typescript.cjs');
const {createFonciereData}=require('../../lib/fonciere/model');
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
const statusPath=process.env.FONCIERE_DRIVE_STATUS_FILE;assert(statusPath,'Owned status file required');
const status=JSON.parse(readFileSync(statusPath,'utf8'));
for(const value of [status.API_URL,status.DB_URL])assert.equal(new URL(value).hostname,'127.0.0.1');
assert.equal(new URL(status.API_URL).port,'56031');assert.equal(new URL(status.DB_URL).port,'56032');
const output=process.env.FONCIERE_DRIVE_OUTPUT||'/private/tmp/fonciere-drive-evidence';mkdirSync(output,{recursive:true});
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const checks=[],options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const ok=async promise=>{const r=await promise;assert.equal(r.error,null,r.error?.message);return r.data;};
const denied=async promise=>{const r=await promise;assert(r.error,'Expected server rejection');return r.error;};
const worker=(op,data={})=>ok(service.rpc('fonciere_drive_worker',{p_operation:op,p_data:data}));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payload=name=>{const data=createFonciereData();data.name=name;delete data.agentContactId;delete data.agencyContactId;for(const k of ['main','view','inside','operation'])data.presentationData.photos[k]='';return {schema:'FONCIERE_PROPERTY_V1',data,sourceDocuments:[]};};
let fixture,users={},historical=[],assets=[],before,fingerprints={},stableBefore;
const migration=readdirSync('supabase/migrations').find(name=>name.endsWith('_fonciere_numbering_drive_queue.sql'));assert(migration);
const preparedPath=join(dirname(statusPath),'fonciere-drive-prepared.private.json');
try {
 const fresh=(await sql.query("select to_regclass('public.crm_workspace_state') t")).rows[0].t===null;
 if(!fresh)assert.equal(process.env.FONCIERE_DRIVE_RESUME,'1','Fresh disposable stack or explicit owned-fixture resume required; never reset another stack');
 if(fresh){
 const base=readFileSync('tests/izord/sql-fixture.sql','utf8');await sql.query(base.slice(base.indexOf('create table public.crm_workspace_state'),base.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false);create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
 for(const name of readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&name<migration).sort())try{await sql.query(readFileSync(join('supabase/migrations',name),'utf8'));}catch(e){throw new Error(name+': '+e.message);}

 for(const [name,role,level,exportAllowed] of [['admin','admin','contribute',true],['writer','contributor','contribute',false],['reader','reader','read',true],['stranger','contributor','contribute',true]]){
  const password=randomBytes(24).toString('hex'),email='fonciere-drive-'+name+'@example.invalid';
  const user=await ok(service.auth.admin.createUser({email,password,email_confirm:true}));
  const id=user.user.id;await sql.query('insert into crm_access_profiles(user_id,active,general_admin) values($1,true,$2)',[id,name==='admin']);
  await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'izord',$2),($1,'oar','member')",[id,role]);
  for(const [module,grant] of Object.entries({fonciere:{level,sensitive:{export:exportAllowed,delete:level==='contribute'}},tasks:{level:'contribute',sensitive:{export:true}}}))await sql.query('insert into crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[id,module,grant.level,grant.sensitive]);
  const client=createClient(status.API_URL,status.ANON_KEY,options),session=await ok(client.auth.signInWithPassword({email,password}));users[name]={id,email,password,client,token:session.session.access_token};
 }
 const admin=users.admin.client;

 for(const [index,name] of ['Villa historique B','Villa historique A','Villa archivée'].entries()){
  const id=await ok(admin.rpc('fonciere_save_project',{p_id:null,p_expected_revision:null,p_payload:payload(name),p_contact:'',p_agency_contact:''}));historical.push(id);
  await sql.query('update fonciere_projects set created_at=$2,updated_at=$2 where id=$1',[id,index===2?'2019-01-01T00:00:00Z':'2020-01-01T00:00:00Z']);
 }
 await ok(admin.rpc('fonciere_archive_project',{p_id:historical[2],p_expected_revision:1,p_archived:true}));
 for(const who of ['writer','reader'])await sql.query('insert into fonciere_project_assignments(project_id,user_id) values($1,$2)',[historical[0],users[who].id]);

 for(let index=0;index<3;index++){
  const bytes=Buffer.from('%PDF-1.4\nFictional original '+index+'\n%%EOF'),path=await ok(admin.rpc('fonciere_register_asset',{p_project:historical[0],p_revision:1,p_kind:'pdf',p_size:bytes.length,p_mime:'application/pdf',p_name:index<2?'homonyme.pdf':'orphelin.pdf'}));
  await ok(admin.storage.from('fonciere-documents').upload(path,bytes,{upsert:false,contentType:'application/pdf'}));await ok(admin.rpc('fonciere_finalize_asset',{p_asset:path.split('/')[1]}));assets.push({id:path.split('/')[1],path,bytes:bytes.toString('base64')});
 }
 const saved=payload('Villa historique B');saved.sourceDocuments=assets.slice(0,2).map(a=>a.id);
 await ok(admin.rpc('fonciere_save_project',{p_id:historical[0],p_expected_revision:1,p_payload:saved,p_contact:'',p_agency_contact:''}));
 before=(await sql.query('select to_jsonb(p) r from fonciere_projects p order by created_at,id')).rows.map(x=>x.r);stableBefore=hash(before);
 const businessTables=['app_memberships','crm_access_profiles','crm_module_grants','fonciere_assets','fonciere_project_assignments','izord_projects','izord_project_versions','crm_workspace_state'];
 for(const table of businessTables)fingerprints[table]=hash((await sql.query('select to_jsonb(t) r from '+table+' t order by to_jsonb(t)::text')).rows);
 writeFileSync(join(dirname(statusPath),'fonciere-drive-pre-migration.private.json'),JSON.stringify({before,fingerprints}),{mode:0o600});
 writeFileSync(preparedPath,JSON.stringify({users:Object.fromEntries(Object.entries(users).map(([k,{client,...u}])=>[k,u])),historical,assets,before,fingerprints}),{mode:0o600});
 }else {
  const prepared=JSON.parse(readFileSync(preparedPath,'utf8'));({users,historical,assets,before,fingerprints}=prepared);stableBefore=hash(before);
  for(const user of Object.values(users)){user.client=createClient(status.API_URL,status.ANON_KEY,options);const session=await ok(user.client.auth.signInWithPassword({email:user.email,password:user.password}));user.token=session.session.access_token;}
 }
 const admin=users.admin.client;
 const businessTables=Object.keys(fingerprints);
 if(!(await sql.query("select to_regclass('app_private.fonciere_drive_jobs') t")).rows[0].t)await sql.query(readFileSync(join('supabase/migrations',migration),'utf8'));
 for(let attempt=0;attempt<30;attempt++){const ready=await service.rpc('fonciere_drive_worker',{p_operation:'get_config'});if(!ready.error)break;if(ready.error.code!=='PGRST202')throw new Error(ready.error.message);await new Promise(resolve=>setTimeout(resolve,100));}
 const numbered=(await sql.query('select * from fonciere_projects order by project_number')).rows;
 assert.deepEqual(numbered.map(p=>p.id),before.map(p=>p.id));assert.deepEqual(numbered.map(p=>p.project_reference),['PRJ-000001','PRJ-000002','PRJ-000003']);
 assert.equal(numbered[0].status,'archived');
 const after=(await sql.query("select to_jsonb(p)-'project_number'-'project_reference'-'creation_key' r from fonciere_projects p order by created_at,id")).rows.map(x=>x.r);assert.equal(hash(after),stableBefore);
 for(const table of businessTables)assert.equal(hash((await sql.query("select to_jsonb(t)"+(table==='fonciere_assets'?"-'drive_category'":'')+" r from "+table+' t order by to_jsonb(t)::text')).rows),fingerprints[table],table+' unchanged');
 const backup=(await sql.query('select original_row r from app_private.fonciere_numbering_backup order by project_number')).rows.map(x=>x.r);assert.deepEqual(backup,before);
 checks.push('Chronological backfill including archived rows, UUID tie-break, exact historical dates/payloads, private backup and mapping; all permission/business tables unchanged');
 const jobsBefore=Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs')).rows[0].count);assert.equal(jobsBefore,5);
 assert.equal(Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs where asset_id=$1',[assets[2].id])).rows[0].count),0);
 await worker('backfill');await worker('backfill');assert.equal(Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs')).rows[0].count),jobsBefore);
 checks.push('Backfill replay creates no duplicate jobs; only saved asset references, two distinct same-name documents and no finalized orphan');
 // Real network RPC concurrency and replay after a simulated lost creation response.
 const key=randomUUID(),args={p_creation_key:key,p_payload:payload('Projet rejoué'),p_contact:'',p_agency_contact:''};
 const ids=await Promise.all(Array.from({length:12},()=>ok(admin.rpc('fonciere_create_project',args))));assert.equal(new Set(ids).size,1);
 const parallel=await Promise.all(Array.from({length:6},(_,index)=>ok(admin.rpc('fonciere_create_project',{...args,p_creation_key:randomUUID(),p_payload:payload('Projet simultané '+index)}))));assert.equal(new Set(parallel).size,6);
 const numbers=(await sql.query('select project_number from fonciere_projects where id=any($1::uuid[])',[[ids[0],...parallel]])).rows.map(p=>p.project_number);assert.equal(new Set(numbers).size,7);
 await denied(users.writer.client.rpc('fonciere_create_project',args));
 await denied(admin.rpc('fonciere_save_project',{p_id:null,p_expected_revision:null,p_payload:payload('Création sans clé refusée'),p_contact:'',p_agency_contact:''}));
 checks.push('Twelve simultaneous retries create one UUID/reference; six concurrent independent creations remain distinct; another owner cannot replay the creation key');
 let immutable=false;try{await sql.query('update fonciere_projects set project_number=1000 where id=$1',[ids[0]]);}catch(e){immutable=e.code==='42501';}assert(immutable);
 const first=await ok(admin.from('fonciere_projects').select('*').eq('id',historical[0]).single());
 const rename=structuredClone(first.payload);rename.data.name='Villa renommée';await ok(admin.rpc('fonciere_save_project',{p_id:first.id,p_expected_revision:first.revision,p_payload:rename,p_contact:'',p_agency_contact:''}));
 await ok(admin.rpc('fonciere_archive_project',{p_id:first.id,p_expected_revision:first.revision+1,p_archived:true}));await ok(admin.rpc('fonciere_archive_project',{p_id:first.id,p_expected_revision:first.revision+2,p_archived:false}));
 const stable=await ok(admin.from('fonciere_projects').select('*').eq('id',first.id).single());assert.equal(stable.project_reference,first.project_reference);
 const countAfterRename=Number((await sql.query("select count(*) from app_private.fonciere_drive_jobs where job_type='file'")).rows[0].count);assert.equal(countAfterRename,2);
 const text=structuredClone(stable.payload);text.data.notes='Texte seul';await ok(admin.rpc('fonciere_save_project',{p_id:first.id,p_expected_revision:stable.revision,p_payload:text,p_contact:'',p_agency_contact:''}));assert.equal(Number((await sql.query("select count(*) from app_private.fonciere_drive_jobs where job_type='file'")).rows[0].count),2);
 const forged=structuredClone(text);forged.sourceDocuments.push(randomUUID());await denied(admin.rpc('fonciere_save_project',{p_id:first.id,p_expected_revision:stable.revision+1,p_payload:forged,p_contact:'',p_agency_contact:''}));
 assert.equal(Number((await sql.query("select count(*) from app_private.fonciere_drive_jobs where job_type='file'")).rows[0].count),2);
 checks.push('Reference survives rename/archive/restore; SQL rejects renumbering; text saves and denied saves export no new files');
 await sql.query('begin');const skipped=(await sql.query("select nextval('app_private.fonciere_project_number_seq') n")).rows[0].n;await sql.query('rollback');const gap=await ok(admin.rpc('fonciere_create_project',{...args,p_creation_key:randomUUID(),p_payload:payload('Après trou technique')}));assert(BigInt((await sql.query('select project_number from fonciere_projects where id=$1',[gap])).rows[0].project_number)>BigInt(skipped));
 checks.push('Rolled-back sequence allocation is never reused or renumbered');
 const adminProjection=await ok(admin.rpc('crm_admin_users'));assert(adminProjection.fonciereProjects.every(p=>p.project_reference&&p.project_number));
 await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[users.admin.id]);const resolved=(await sql.query("select app_private.task_target_resolve(jsonb_build_object('type','fonciere_project','id',$1::text)) r",[first.id])).rows[0].r;await sql.query('rollback');assert.equal(resolved.projectReference,first.project_reference);assert(resolved.searchFields.includes(first.project_reference));
 checks.push('Administration and Tasks RPC projections include the stable project reference and numeric search field');
 // No general Drive privilege or export capability is required for organizational copy.
 for(const original of assets.slice(0,2)){const actual=await ok(service.storage.from('fonciere-documents').download(original.path));assert.deepEqual(Buffer.from(await actual.arrayBuffer()),Buffer.from(original.bytes,'base64'));}
 await denied(users.writer.client.storage.from('fonciere-documents').download(assets[0].path));
 checks.push('Original private PDF bytes are reread exactly through the organization service; contributor without export cannot download those originals');
 const restrictedStatus=await ok(users.writer.client.rpc('fonciere_drive_status',{p_project:first.id}));assert.equal(restrictedStatus.can_retry,true);assert.equal(restrictedStatus.can_open,false);assert.equal(restrictedStatus.folder_id,null);
 await denied(users.writer.client.rpc('fonciere_drive_folder',{p_project:first.id}));await denied(users.reader.client.rpc('fonciere_drive_retry',{p_project:first.id}));
 await denied(users.stranger.client.rpc('fonciere_drive_status',{p_project:first.id}));await denied(users.writer.client.rpc('fonciere_drive_worker',{p_operation:'report'}));
 checks.push('Restricted Foncière contributor can inspect/retry own assigned copy without export/general Drive rights; readers cannot retry; strangers and direct worker calls are denied');
 await worker('configure',{shared_drive_id:'fake-shared-drive',root_folder_id:'fake-project-root',root_parent_id:'fake-shared-drive',enabled:true});
 // Finish folder jobs to isolate file leases; Google confirmation is simulated at worker boundary.
 let folderCount=0;
 for(;;){const batch=await worker('claim',{lease_token:randomUUID(),limit:5});if(!batch.length)break;for(const j of batch){if(j.job_type==='folder'){await worker('complete',{id:j.id,lease_token:j.lease_token});folderCount++;}else await worker('fail',{id:j.id,lease_token:j.lease_token,error:'temporary fixture failure'});}}
 await sql.query("update app_private.fonciere_drive_jobs set next_attempt_at=clock_timestamp() where job_type='file'");
 const claimed=(await Promise.all(Array.from({length:8},()=>worker('claim',{lease_token:randomUUID(),limit:1})))).flat();assert.equal(claimed.length,2);assert.equal(new Set(claimed.map(j=>j.id)).size,2);
 const job=claimed[0],second=claimed[1];assert.equal((await worker('asset_validate',{id:job.id,lease_token:job.lease_token})).valid,true);
 await worker('reserve_file',{id:job.id,lease_token:job.lease_token,file_id:'reserved-original-one'});
 await denied(service.rpc('fonciere_drive_worker',{p_operation:'reserve_file',p_data:{id:job.id,lease_token:job.lease_token,file_id:'wrong-new-id'}}));
 await denied(service.rpc('fonciere_drive_worker',{p_operation:'complete',p_data:{id:job.id,lease_token:job.lease_token,file_id:'unconfirmed-id'}}));
 // Simulated crash after Google has created the reserved identity, before durable completion.
 await sql.query("update app_private.fonciere_drive_jobs set lease_until=clock_timestamp()-interval '1 minute' where id=$1",[job.id]);
 const recovered=(await worker('claim',{lease_token:randomUUID(),limit:1}))[0];assert.equal(recovered.id,job.id);assert.equal(recovered.reserved_file_id,'reserved-original-one');
 await denied(service.rpc('fonciere_drive_worker',{p_operation:'complete',p_data:{id:job.id,lease_token:job.lease_token,file_id:'reserved-original-one'}}));
 await worker('complete',{id:recovered.id,lease_token:recovered.lease_token,file_id:recovered.reserved_file_id});
 const final=(await sql.query('select * from app_private.fonciere_drive_jobs where id=$1',[job.id])).rows[0];assert.equal(final.status,'synced');assert.equal(final.drive_file_id,'reserved-original-one');
 await worker('fail',{id:second.id,lease_token:second.lease_token,error:'Drive temporarily unavailable'});
 const retry=(await sql.query('select * from app_private.fonciere_drive_jobs where id=$1',[second.id])).rows[0];assert.equal(retry.status,'retry');assert(new Date(retry.next_attempt_at)>new Date());
 await ok(users.writer.client.rpc('fonciere_drive_retry',{p_project:first.id,p_asset:second.asset_id}));
 checks.push('Eight concurrent workers claim each asset once; durable reserved ID survives crash/lease expiration; stale workers and conflicting IDs are rejected; confirmation is persisted before synced');
 checks.push('Temporary failure is durably delayed; authorized user retry resumes without an open tab; file jobs retain original names, MIME, sizes and storage versions');
 const token=randomUUID(),folder=await worker('folder_claim',{project_id:first.id,category:'project',lease_token:token,parent_id:'fake-project-root'});assert.equal(folder.claimed,true);
 await worker('folder_reserve',{project_id:first.id,category:'project',lease_token:token,folder_id:'reserved-folder-one'});
 await worker('folder_ready',{project_id:first.id,category:'project',lease_token:token,folder_id:'reserved-folder-one'});
 const readerStatus=await ok(users.reader.client.rpc('fonciere_drive_status',{p_project:first.id}));assert.equal(readerStatus.folder_id,'reserved-folder-one');
 await denied(service.rpc('fonciere_drive_worker',{p_operation:'folder_claim',p_data:{project_id:first.id,category:'project',lease_token:randomUUID(),parent_id:'different-parent'}}));
 await denied(service.rpc('fonciere_drive_worker',{p_operation:'configure',p_data:{shared_drive_id:'fake-shared-drive',root_folder_id:'other-root',root_parent_id:'fake-shared-drive',enabled:true}}));
 await sql.query("update crm_module_grants set level='none' where user_id=$1 and module='fonciere'",[users.writer.id]);await denied(users.writer.client.rpc('fonciere_drive_retry',{p_project:first.id}));await denied(users.writer.client.rpc('fonciere_drive_status',{p_project:first.id}));
 checks.push('Managed folder ID and configured destination cannot be silently replaced; export controls folder visibility; current permissions/revocation apply on every status/retry call');
 const planProject=await ok(admin.from('fonciere_projects').select('*').eq('id',first.id).single()),planBytes=Buffer.from('%PDF-1.4\nFictional original plan\n%%EOF');
 const planPath=await ok(admin.rpc('fonciere_register_asset',{p_project:first.id,p_revision:planProject.revision,p_kind:'pdf',p_size:planBytes.length,p_mime:'application/pdf',p_name:'plan-original.pdf',p_category:'plans'}));
 await ok(admin.storage.from('fonciere-documents').upload(planPath,planBytes,{upsert:false,contentType:'application/pdf'}));await ok(admin.rpc('fonciere_finalize_asset',{p_asset:planPath.split('/')[1]}));
 assert.equal(Number((await sql.query('select count(*) from app_private.fonciere_drive_jobs where asset_id=$1',[planPath.split('/')[1]])).rows[0].count),0);
 const planPayload=structuredClone(planProject.payload);planPayload.sourceDocuments.push(planPath.split('/')[1]);await ok(admin.rpc('fonciere_save_project',{p_id:first.id,p_expected_revision:planProject.revision,p_payload:planPayload,p_contact:'',p_agency_contact:''}));
 assert.equal((await sql.query('select category from app_private.fonciere_drive_jobs where asset_id=$1',[planPath.split('/')[1]])).rows[0].category,'plans');
 assert.deepEqual(Buffer.from(await (await ok(service.storage.from('fonciere-documents').download(planPath))).arrayBuffer()),planBytes);
 checks.push('Known plans category persists before finalization and enters the queue only after successful project save; its original PDF bytes remain exact');
 const privateNames=['fonciere_numbering_backup','fonciere_drive_config','fonciere_drive_folders','fonciere_drive_jobs','fonciere_drive_events'];for(const name of privateNames){const p=(await sql.query("select has_table_privilege('authenticated',$1,'select') r,has_table_privilege('anon',$1,'select') a",['app_private.'+name])).rows[0];assert.equal(p.r,false);assert.equal(p.a,false);}
 checks.push('Backups, mapping, file reservations, queue leases and diagnostics are inaccessible to anonymous/authenticated table access');
 await sql.query("select setval('app_private.fonciere_project_number_seq',1000000,false)");
 const seven=await ok(admin.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:payload('Projet sept chiffres'),p_contact:'',p_agency_contact:''}));assert.equal((await ok(admin.from('fonciere_projects').select('project_reference').eq('id',seven).single())).project_reference,'PRJ-1000000');
 checks.push('Reference expands beyond six digits without truncation or sequence wrap');
 await sql.query("update crm_module_grants set level='contribute' where user_id=$1 and module='fonciere'",[users.writer.id]);
 fixture={statusPath,users:Object.fromEntries(Object.entries(users).map(([k,{client,...rest}])=>[k,rest])),projects:{assigned:first.id,archived:historical[2],replayed:ids[0]},assets};
 writeFileSync(join(dirname(statusPath),'fonciere-drive-fixture.private.json'),JSON.stringify(fixture),{mode:0o600});
 writeFileSync(join(output,'sql-results.json'),JSON.stringify({passed:checks.length,checks,actualGoogleCopies:0,productionRequests:0,simulatedWorkerConfirmations:true,migration},null,2));
 console.log(checks.map(c=>'PASS '+c).join('\n'));
}finally{await sql.end();}
