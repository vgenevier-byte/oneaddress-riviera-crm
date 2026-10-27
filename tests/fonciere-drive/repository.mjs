/** Real loopback Auth/RPC/Storage and actual API handlers. Google is never called. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);require('../i18n/register-typescript.cjs');
const {createFonciereRepository}=require('../../lib/fonciere/repository');
const {createFonciereData}=require('../../lib/fonciere/model');
const {createFonciereDriveStatusHandler,createFonciereDriveFolderHandler,createFonciereDriveWorkerHandler}=require('../../lib/server/fonciereDriveHandlers');
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
const file=process.env.FONCIERE_DRIVE_STATUS_FILE;assert(file);
const status=JSON.parse(readFileSync(file,'utf8'));
for(const key of ['API_URL','DB_URL'])assert.equal(new URL(status[key]).hostname,'127.0.0.1');
assert.equal(new URL(status.API_URL).port,'56031');assert.equal(new URL(status.DB_URL).port,'56032');
const fixture=JSON.parse(readFileSync(join(dirname(file),'fonciere-drive-fixture.private.json'),'utf8'));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const checks=[];
const ok=async value=>{const r=await value;assert.equal(r.error,null,r.error?.message);return r.data;};
try{
 const clients={};
 for(const [name,user] of Object.entries(fixture.users)){
  const client=createClient(status.API_URL,status.ANON_KEY,options);
  const session=await ok(client.auth.signInWithPassword({email:user.email,password:user.password}));
  clients[name]={client,token:session.session.access_token};
 }
 const writer=clients.writer;
 const originalFetch=fetch;let dropCreate=true,dropFinal=false,creationKey=randomUUID();
 const replayClient=createClient(status.API_URL,status.ANON_KEY,{...options,global:{headers:{Authorization:'Bearer '+writer.token},fetch:async(input,init)=>{
  const response=await originalFetch(input,init);
  if(dropCreate&&String(input).endsWith('/rest/v1/rpc/fonciere_create_project')){dropCreate=false;assert(response.ok);await response.text();throw new TypeError('Simulated lost create response after database commit');}
  if(dropFinal&&String(input).endsWith('/rest/v1/rpc/fonciere_save_project')){dropFinal=false;assert(response.ok);await response.text();throw new TypeError('Simulated lost final save response after database commit');}
  return response;
 }}});
 const repo=createFonciereRepository(replayClient),data={...createFonciereData(),name:'Fictional replay with two original plans'};
 const files=[0,1].map(i=>new File(['%PDF-1.4\nDifferent private original '+i+'\n%%EOF'],'homonyme.pdf',{type:'application/pdf'}));
 await assert.rejects(repo.saveProject({data,creationKey,sourceFiles:files,sourceFileCategories:['plans','other']}));
 const first=(await sql.query('select id,project_reference from fonciere_projects where creation_key=$1',[creationKey])).rows[0];assert(first);
 dropFinal=true;
 await assert.rejects(repo.saveProject({data,creationKey,sourceFiles:files,sourceFileCategories:['plans','other']}));
 const saved=await repo.saveProject({data,creationKey,sourceFiles:files,sourceFileCategories:['plans','other']});
 assert.equal(saved.project.id,first.id);assert.equal(saved.project.project_reference,first.project_reference);
 assert.equal(Number((await sql.query('select count(*) from fonciere_projects where creation_key=$1',[creationKey])).rows[0].count),1);
 assert.equal(saved.sourceDocuments.length,2);
 const stored=(await sql.query('select a.id,a.drive_category,a.object_path from fonciere_assets a where a.id=any($1::uuid[]) order by a.drive_category',[saved.sourceDocuments])).rows;
 assert.deepEqual(stored.map(a=>a.drive_category),['other','plans']);
 const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
 for(const a of stored){const blob=await ok(service.storage.from('fonciere-documents').download(a.object_path));const i=a.drive_category==='plans'?0:1;assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),createHash('sha256').update(Buffer.from(await files[i].arrayBuffer())).digest('hex'));}
 await assert.rejects(repo.saveProject({data:{...data,notes:'Newer local correction must remain a draft'},creationKey,sourceFiles:files,sourceFileCategories:['plans','other']}),/brouillon est conservé/);
 assert.equal(Number((await sql.query('select count(*) from fonciere_assets where project_id=$1',[first.id])).rows[0].count),2);
 checks.push('Lost creation AND final save responses after real server commits replay to the same UUID/reference and two original assets; homonyms retain distinct bytes/categories; changed drafts are not silently overwritten');
 const jobsBefore=(await sql.query("select * from app_private.fonciere_drive_jobs where project_id=$1 and job_type='file' order by id",[first.id])).rows;
 const beforePayload=structuredClone(saved.project.payload);
 const edited=await repo.saveProject({data:{...saved.data,notes:'Text-only save'},previous:saved});
 assert.deepEqual(edited.project.payload.sourceDocuments,beforePayload.sourceDocuments);
 assert.deepEqual((await sql.query("select * from app_private.fonciere_drive_jobs where project_id=$1 and job_type='file' order by id",[first.id])).rows,jobsBefore);
 assert.equal(Number((await sql.query('select count(*) from fonciere_assets where project_id=$1',[first.id])).rows[0].count),2);
 checks.push('A real text-only repository save preserves assets and file outbox rows exactly without downloading or copying originals');
 process.env.NEXT_PUBLIC_SUPABASE_URL=status.API_URL;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;
 const get=createFonciereDriveStatusHandler();
 const request=(token,project=first.id,method='GET')=>new Request('http://127.0.0.1:56031/api/fonciere/drive'+(method==='GET'?'?project='+project:''),{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({projectId:project})}:{})});
 assert.equal((await get(request(null))).status,401);
 const permitted=await get(request(writer.token));assert.equal(permitted.status,200);const view=await permitted.json();assert.equal(view.canRetry,true);assert.equal(view.canOpen,false);assert.equal(view.files.length,2);
 assert.equal((await get(request(clients.stranger.token))).status,403);
 assert.equal((await get(request(clients.reader.token,fixture.projects.assigned,'POST'))).status,403);
 const open=createFonciereDriveFolderHandler({fetchDrive:()=>{throw new Error('Unauthorized route must not contact Google');}});
 assert.equal((await open(new Request('http://127.0.0.1:56031/api/fonciere/drive/folder?project='+first.id,{headers:{authorization:'Bearer '+writer.token}}))).status,403);
 assert.equal((await createFonciereDriveWorkerHandler()(new Request('http://127.0.0.1:56031/api/fonciere/drive/worker',{headers:{authorization:'Bearer '+writer.token}}))).status,401);
 await sql.query('update crm_access_profiles set active=false where user_id=$1',[fixture.users.writer.id]);
 assert.equal((await get(request(writer.token))).status,403);
 await sql.query('update crm_access_profiles set active=true where user_id=$1',[fixture.users.writer.id]);
 checks.push('Actual API handlers and local Auth enforce project scope, reader/contributor separation, export denial, worker-secret isolation and revocation with the same still-valid JWT');
 writeFileSync('/private/tmp/fonciere-drive-evidence/repository-results.json',JSON.stringify({passed:checks.length,checks,realLocalAuthStorage:true,actualGoogleCopies:0,productionRequests:0},null,2));
 console.log(checks.map(c=>'PASS '+c).join('\n'));
}finally{await sql.end();}
