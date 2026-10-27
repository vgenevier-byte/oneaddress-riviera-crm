/** Real isolated Auth/RPC/Storage and durable queue; only Google transport is simulated. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
require('../i18n/register-typescript.cjs');
const Module=require('node:module'),load=Module._load;
Module._load=function(id,parent,main){if(id==='server-only')return {};return load.call(this,id,parent,main);};
const {processFonciereDriveJobs}=require('../../lib/server/fonciereDrive');
const {createFonciereDriveStore}=require('../../lib/server/fonciereDriveSupabase');
const {createFonciereDriveStatusHandler}=require('../../lib/server/fonciereDriveHandlers');
const {createFonciereData}=require('../../lib/fonciere/model');

assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
const statusPath=process.env.FONCIERE_RELIABILITY_STATUS_FILE;
assert(statusPath,'Explicit owned isolated-stack status is required');
const status=JSON.parse(readFileSync(statusPath,'utf8'));
assert.equal(new URL(status.API_URL).hostname,'127.0.0.1');assert.equal(new URL(status.API_URL).port,'56031');
assert.equal(new URL(status.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(status.DB_URL).port,'56032');
const fixture=JSON.parse(readFileSync(join(dirname(statusPath),'fonciere-drive-fixture.private.json'),'utf8'));
const output=process.env.FONCIERE_RELIABILITY_OUTPUT||'/private/tmp/fonciere-reliability-evidence';mkdirSync(output,{recursive:true});
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),admin=createClient(status.API_URL,status.ANON_KEY,options);
const ok=async promise=>{const result=await promise;assert.equal(result.error,null,result.error?.message);return result.data;};
const authenticated=await ok(admin.auth.signInWithPassword({email:fixture.users.admin.email,password:fixture.users.admin.password}));
const token=authenticated.session.access_token;
process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;
process.env.PREPAID_HOURS_TEST_ACK='PREPAID_HOURS_LOCAL_ONLY';process.env.LOCAL_AUTH_INVITE_KEY=status.SERVICE_ROLE_KEY;
const store=createFonciereDriveStore(),config=await store.call('get_config');
assert(config.enabled&&config.root_folder_id&&config.shared_drive_id);
assert.match(config.shared_drive_id,/fake|fixture|test/i,'Only an isolated fixture Drive configuration may be used');
process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID=config.shared_drive_id;
const FOLDER='application/vnd.google-apps.folder',checks=[],runId=randomUUID(),createdProjects=[];
const rateResponse=reason=>Response.json({error:{code:403,errors:[{domain:'usageLimits',reason,message:'Fictional Google quota incident'}]}},{status:403});
const permissionResponse=()=>Response.json({error:{code:403,errors:[{reason:'insufficientFilePermissions',message:'Fictional permission refusal'}]}},{status:403});
function googleTransport(){
 let generated=0,sessionNumber=0;
 const files=new Map(),sessions=new Map(),calls=[],successfulCreates=[];
 const folder=(id,parent,name=id)=>({id,name,mimeType:FOLDER,driveId:config.shared_drive_id,parents:parent?[parent]:[],trashed:false,capabilities:{canAddChildren:true,canListChildren:true,canEdit:true}});
 files.set(config.shared_drive_id,folder(config.shared_drive_id,null));files.set(config.root_folder_id,folder(config.root_folder_id,config.root_parent_id,'Projets'));
 const state={issue:null};
 const fetchDrive=async(input,init={})=>{
  const url=new URL(input),method=init.method||'GET';let metadata;
  if(method==='POST'&&typeof init.body==='string')metadata=JSON.parse(init.body);
  calls.push({path:url.pathname,method,id:metadata?.id,projectId:metadata?.appProperties?.projectId,folderKind:metadata?.appProperties?.folderKind});
  if(state.issue){const response=await state.issue(url,init,metadata);if(response)return response;}
  if(url.pathname.endsWith('/generateIds'))return Response.json({ids:[`reliability-reserved-${++generated}`]});
  if(url.pathname==='/drive/v3/files'&&method==='POST'){
   if(files.has(metadata.id))return Response.json({},{status:409});
   assert(files.has(metadata.parents[0]),'Parent belongs to this simulated Drive');
   files.set(metadata.id,{...folder(metadata.id,metadata.parents[0],metadata.name),appProperties:metadata.appProperties});successfulCreates.push(metadata.id);return Response.json({id:metadata.id});
  }
  if(url.pathname==='/upload/drive/v3/files'&&method==='POST'){
   if(files.has(metadata.id))return Response.json({},{status:409});
   const session=`reliability-session-${++sessionNumber}`;sessions.set(session,{metadata,chunks:[]});
   return new Response(null,{headers:{location:`https://www.googleapis.com/upload/drive/v3/files/${session}`}});
  }
  if(url.pathname.startsWith('/upload/drive/v3/files/')&&method==='PUT'){
   const session=sessions.get(url.pathname.split('/').at(-1));assert(session);
   session.chunks.push(Buffer.from(init.body));const range=init.headers['content-range'].match(/bytes (\d+)-(\d+)\/(\d+)/);assert(range);
   if(Number(range[2])+1<Number(range[3]))return new Response(null,{status:308});
   const content=Buffer.concat(session.chunks),data=session.metadata;files.set(data.id,{...data,driveId:config.shared_drive_id,trashed:false,size:String(content.length),md5Checksum:createHash('md5').update(content).digest('hex'),content});successfulCreates.push(data.id);return Response.json({id:data.id});
  }
  const id=url.pathname.split('/').at(-1);
  if(method==='PATCH'){
   if(!files.has(id))return Response.json({},{status:404});Object.assign(files.get(id),JSON.parse(init.body));return Response.json(files.get(id));
  }
  if(method==='GET')return files.has(id)?Response.json(files.get(id)):Response.json({},{status:404});
  throw Error('Unexpected simulated Google operation');
 };
 return {fetchDrive,state,files,calls,successfulCreates};
}
const google=googleTransport();
const row=async project=>(await sql.query("select * from app_private.fonciere_drive_jobs where project_id=$1 and job_type='folder'",[project])).rows[0];
const fileRow=async project=>(await sql.query("select * from app_private.fonciere_drive_jobs where project_id=$1 and job_type='file'",[project])).rows[0];
const folderRow=async project=>(await sql.query("select * from app_private.fonciere_drive_folders where project_id=$1 and category='project'",[project])).rows[0];
const run=async()=>processFonciereDriveJobs(store,google.fetchDrive,{maxJobs:1});
const makeDue=async project=>sql.query('update app_private.fonciere_drive_jobs set next_attempt_at=clock_timestamp() where project_id=$1',[project]);
async function createProject(label,withFile=false){
 const data=createFonciereData();data.name=`Fiabilité Drive ${runId} ${label}`;delete data.agentContactId;delete data.agencyContactId;for(const role of ['main','view','inside','operation'])data.presentationData.photos[role]='';
 const initial={schema:'FONCIERE_PROPERTY_V1',data,sourceDocuments:[]};
 initial.creationIntentHash=createHash('sha256').update(JSON.stringify(initial)).digest('hex');
 const id=await ok(admin.rpc('fonciere_create_project',{p_creation_key:randomUUID(),p_payload:initial,p_contact:'',p_agency_contact:''}));createdProjects.push(id);
 let original;
 if(withFile){
  original=Buffer.from(`%PDF-1.4\nFictional original ${label} ${runId}\n%%EOF`);
  const path=await ok(admin.rpc('fonciere_register_asset',{p_project:id,p_revision:1,p_kind:'pdf',p_size:original.length,p_mime:'application/pdf',p_name:'original-fiabilite.pdf',p_category:'plans'}));
  await ok(admin.storage.from('fonciere-documents').upload(path,original,{upsert:false,contentType:'application/pdf'}));await ok(admin.rpc('fonciere_finalize_asset',{p_asset:path.split('/')[1]}));
  const project=await ok(admin.from('fonciere_projects').select('*').eq('id',id).single()),saved=structuredClone(project.payload);saved.sourceDocuments.push(path.split('/')[1]);
  await ok(admin.rpc('fonciere_save_project',{p_id:id,p_expected_revision:project.revision,p_payload:saved,p_contact:'',p_agency_contact:''}));
 }
 return {id,original};
}
async function diagnostic(project,lang){
 const response=await createFonciereDriveStatusHandler()(new Request(`http://fixture.invalid/api/fonciere/drive?project=${project}`,{headers:{Authorization:`Bearer ${token}`,'Accept-Language':lang}}));
 assert.equal(response.status,200);return response.json();
}
const unrelated=(await sql.query('select id,status,next_attempt_at::text,lease_until::text from app_private.fonciere_drive_jobs')).rows;
try{
 assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count),0,'Owned fictional accounts only');
 // Other checks have completed. Fence their existing jobs during this campaign,
 // then restore their exact scheduling state; no fixture history is deleted.
 await sql.query("update app_private.fonciere_drive_jobs set next_attempt_at=clock_timestamp()+interval '1 day',lease_until=case when status='processing' then clock_timestamp()+interval '1 day' else lease_until end where status<>'synced'");

 const limited=await createProject('débit dossier');let limitedOnce=false;
 google.state.issue=async(url,init,metadata)=>{if(!limitedOnce&&init.method==='POST'&&url.pathname==='/drive/v3/files'&&metadata?.appProperties?.projectId===limited.id){limitedOnce=true;return rateResponse('rateLimitExceeded');}};
 assert.equal((await run()).failed,1);const waiting=await row(limited.id),reserved=await folderRow(limited.id);
 assert.equal(waiting.status,'retry');assert.equal(waiting.permanent,false);assert.equal(waiting.error,'drive_rate_limited');assert(new Date(waiting.next_attempt_at)>new Date());assert.equal(reserved.status,'creating');assert(reserved.drive_folder_id);
 assert.equal((await run()).processed,0,'Backoff prevents immediate automatic retry');
 assert.match((await diagnostic(limited.id,'fr')).error,/limite temporairement/);assert.match((await diagnostic(limited.id,'en')).error,/temporarily limiting/);
 await makeDue(limited.id);assert.equal((await run()).synced,1);assert.equal((await row(limited.id)).status,'synced');assert.equal((await folderRow(limited.id)).drive_folder_id,reserved.drive_folder_id);assert.equal(google.successfulCreates.filter(id=>id===reserved.drive_folder_id).length,1);
 checks.push('Real Auth/create RPC + worker + durable SQL: 403 rateLimitExceeded persists retry/nonpermanent/backoff; automatic recovery uses the same reserved folder ID; FR/EN diagnostics identify throttling');

 const fileLimited=await createProject('débit fichier',true);google.state.issue=null;assert.equal((await run()).synced,1);
 let fileLimitedOnce=false;
 google.state.issue=async(url,init,metadata)=>{if(!fileLimitedOnce&&init.method==='POST'&&url.pathname==='/upload/drive/v3/files'&&metadata?.appProperties?.projectId===fileLimited.id){fileLimitedOnce=true;return rateResponse('userRateLimitExceeded');}};
 assert.equal((await run()).failed,1);const fileWaiting=await fileRow(fileLimited.id);assert.equal(fileWaiting.status,'retry');assert.equal(fileWaiting.permanent,false);assert.equal(fileWaiting.error,'drive_rate_limited');assert(fileWaiting.reserved_file_id);assert(new Date(fileWaiting.next_attempt_at)>new Date());
 await makeDue(fileLimited.id);assert.equal((await run()).synced,1);const fileSynced=await fileRow(fileLimited.id);assert.equal(fileSynced.status,'synced');assert.equal(fileSynced.drive_file_id,fileWaiting.reserved_file_id);assert.equal(fileSynced.reserved_file_id,fileWaiting.reserved_file_id);assert.deepEqual(google.files.get(fileSynced.drive_file_id).content,fileLimited.original);assert.equal(google.successfulCreates.filter(id=>id===fileWaiting.reserved_file_id).length,1);
 checks.push('Real private Storage original + persisted file queue: 403 userRateLimitExceeded recovers automatically with the same reserved Drive file ID and exact original PDF bytes');

 const permission=await createProject('permission');google.state.issue=async(url,init,metadata)=>init.method==='POST'&&metadata?.appProperties?.projectId===permission.id?permissionResponse():undefined;
 assert.equal((await run()).failed,1);const stopped=await row(permission.id);assert.equal(stopped.status,'retry');assert.equal(stopped.permanent,true);assert.equal(stopped.error,'drive_access_denied');const callsBefore=google.calls.length;
 await makeDue(permission.id);assert.equal((await run()).processed,0);assert.equal((await row(permission.id)).attempts,stopped.attempts);assert.equal(google.calls.length,callsBefore);
 checks.push('True insufficientFilePermissions persists intervention-required retry/permanent=true; subsequent automatic worker invocation makes no Google attempt');

 const interrupted=await createProject('création interrompue');let interruptedOnce=false;const interruptedIds=[];
 google.state.issue=async(url,init,metadata)=>{if(init.method==='POST'&&url.pathname==='/drive/v3/files'&&metadata?.appProperties?.projectId===interrupted.id&&metadata?.appProperties?.folderKind==='project'){interruptedIds.push(metadata.id);if(!interruptedOnce){interruptedOnce=true;throw Error('Fictional connection interruption before Google creation');}}};
 assert.equal((await run()).failed,1);const interruptedJob=await row(interrupted.id),interruptedFolder=await folderRow(interrupted.id);
 assert.equal(interruptedJob.status,'retry');assert.equal(interruptedJob.permanent,false);assert.equal(interruptedJob.error,'drive_folder_creation_unconfirmed');assert.equal(interruptedFolder.status,'creating');assert(interruptedFolder.drive_folder_id);assert.equal(google.files.has(interruptedFolder.drive_folder_id),false);
 assert.equal((await run()).processed,0);await makeDue(interrupted.id);assert.equal((await run()).synced,1);assert.deepEqual(interruptedIds,[interruptedFolder.drive_folder_id,interruptedFolder.drive_folder_id]);assert.equal((await folderRow(interrupted.id)).drive_folder_id,interruptedFolder.drive_folder_id);assert.equal(google.successfulCreates.filter(id=>id===interruptedFolder.drive_folder_id).length,1);
 checks.push('Interrupted folder POST before creation + GET404 persists creating/reserved identity and delayed retry; automatic worker replay creates exactly one folder with that same ID');

 for(const http of [404,403]){
  google.state.issue=null;const confirmed=await createProject(`dossier confirmé ${http}`);assert.equal((await run()).synced,1);const confirmedFolder=await folderRow(confirmed.id);assert.equal(confirmedFolder.status,'ready');
  const record=await ok(admin.from('fonciere_projects').select('*').eq('id',confirmed.id).single()),renamed=structuredClone(record.payload);renamed.data.name+=' renommé';await ok(admin.rpc('fonciere_save_project',{p_id:confirmed.id,p_expected_revision:record.revision,p_payload:renamed,p_contact:'',p_agency_contact:''}));
  google.state.issue=async(url,init)=>(!init.method||init.method==='GET')&&url.pathname.endsWith('/'+confirmedFolder.drive_folder_id)?(http===403?permissionResponse():Response.json({},{status:404})):undefined;
  const before=google.calls.filter(call=>call.method==='POST').length;assert.equal((await run()).failed,1);const failed=await row(confirmed.id);assert.equal(failed.status,'retry');assert.equal(failed.permanent,true);assert.equal((await folderRow(confirmed.id)).drive_folder_id,confirmedFolder.drive_folder_id);assert.equal(google.calls.filter(call=>call.method==='POST').length,before);
  await makeDue(confirmed.id);assert.equal((await run()).processed,0);assert.equal((await row(confirmed.id)).attempts,failed.attempts);
  checks.push(`Confirmed ready folder HTTP${http} persists intervention-required error, retains its ID and produces no replacement POST or automatic retry loop`);
 }
 const evidence={actualAuth:true,actualRPC:true,actualPrivateStorage:true,actualQueueDatabase:true,googleTransport:'simulated only',actualGoogleCopies:0,productionRequests:0,checks,passed:checks.length,createdFictionalProjects:createdProjects.length};
 writeFileSync(join(output,'drive-persistence-results.json'),JSON.stringify(evidence,null,2));console.log(checks.map(check=>'PASS '+check).join('\n'));
}finally{
 for(const original of unrelated)await sql.query('update app_private.fonciere_drive_jobs set status=$2,next_attempt_at=$3,lease_until=$4 where id=$1',[original.id,original.status,original.next_attempt_at,original.lease_until]);
 await sql.end();
}
