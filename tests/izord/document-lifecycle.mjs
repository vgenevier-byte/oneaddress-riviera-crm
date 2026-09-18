/** Real Auth/Storage document lifecycle repro (--before) or corrected assertions (--after).
 * Uses an already guarded disposable local stack, isolated fictitious users and projects.
 * No Google call and no business operation with service_role. Never prints credentials.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertLocalTarget } from './local-target.mjs';
const require=createRequire(import.meta.url),{createClient}=require('@supabase/supabase-js');
const phase=process.argv.includes('--before')?'before':process.argv.includes('--after')?'after':null;
assert.ok(phase,'Explicit --before or --after required');
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE,'utf8'));
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
assert.equal(fixture.api,status.API_URL);
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const authAdmin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,opts);
const {Client}=require(process.env.IZORD_PG_MODULE||'pg'),sql=new Client({connectionString:status.DB_URL});
const clients=[];function clientFor(token){const c=createClient(status.API_URL,status.ANON_KEY,{...opts,global:{headers:{Authorization:`Bearer ${token}`}}});clients.push(c);return c;}
const administrator=clientFor(fixture.users.admin.token),partner=clientFor(fixture.users.partner.token);
const anon=createClient(status.API_URL,status.ANON_KEY,opts),checks=[],observations={};
let active='initialize';
function code(e){return /^[a-z0-9_-]{1,40}$/i.test(String(e?.code||''))?e.code:e?.name||'Error';}
async function ok(p,step='authorized operation'){const r=await p;if(r.error)throw Object.assign(Error('Authorized operation failed'),{code:code(r.error),step,reason:['row-level security','izord_immutable_document','permission denied','resource already exists'].find(x=>String(r.error.message).includes(x))||'unclassified',http:r.error.statusCode});return r.data;}
async function denied(p){const r=await p;assert.ok(r.error||Array.isArray(r.data)&&r.data.length===0,'Expected error or zero affected rows');return r;}
async function check(name,fn){active=name;await fn();checks.push(name);console.log(`PASS ${phase}: ${name}`);}
const store=c=>c.storage.from('izord-documents');
const ppt=bytes=>new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
const key=path=>path.split('/')[1];
async function actor(role){
 const email=`r1-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('hex');
 const created=await ok(authAdmin.auth.admin.createUser({email,password,email_confirm:true}));
 const c=createClient(status.API_URL,status.ANON_KEY,opts);clients.push(c);
 const signed=await ok(c.auth.signInWithPassword({email,password}));
 const invitation=await ok(administrator.rpc('izord_invite_izord',{p_email:email,p_role:role}));
 await ok(c.rpc('izord_accept_invitation',{p_token:invitation.token}));
 return{id:created.user.id,client:c,token:signed.session.access_token};
}
async function project(c){return ok(c.rpc('izord_create_project',{p_title:'R1 projet fictif '+randomUUID()}));}
async function register(c,id,revision=1){return ok(c.rpc('izord_register_asset',{p_project:id,p_revision:revision,p_kind:'presentation'}));}
const finalize=(c,path)=>c.rpc('izord_finalize_asset',{p_asset:key(path)});
const withdraw=(c,path)=>c.rpc('izord_withdraw_asset',{p_asset:key(path)});
async function read(c,path){return (await ok(store(c).download(path))).text();}
async function allow(path){return ok(partner.rpc('izord_allow_reader_download',{p_asset:key(path),p_allowed:true}));}
async function assign(id,user,assigned){return ok(administrator.rpc('izord_assign_project',{p_project:id,p_user:user.id,p_assigned:assigned}));}
function signedTTL(token){const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));return c.exp-c.iat;}
async function exists(path){return Number((await sql.query("select count(*) n from storage.objects where bucket_id='izord-documents' and name=$1",[path])).rows[0].n)===1;}
try{
 await sql.connect();
 const contributor=await actor('contributor'),reader=await actor('reader');
 const c=contributor.client,r=reader.client,id=await project(c);
 await assign(id,reader,true);
 if(phase==='before'){
  const path=await register(c,id);
  await check('R1 published object can be deleted and replaced under the same path',async()=>{
   await ok(store(c).upload(path,ppt('ORIGINAL FICTIONAL PRESENTATION')));await allow(path);
   assert.equal(await read(r,path),'ORIGINAL FICTIONAL PRESENTATION');
   assert.equal((await ok(store(c).remove([path]))).length,1);
   await ok(store(c).upload(path,ppt('REPLACED FICTIONAL PRESENTATION')));
   assert.equal(await read(r,path),'REPLACED FICTIONAL PRESENTATION');
   observations.publishedDeleteReupload=true;
  });
  await check('R1 approved project still permits contributor replacement and registration against old revision',async()=>{
   assert.equal(await ok(partner.rpc('izord_save_project',{p_id:id,p_expected_revision:1,p_title:'R1 approuvé',p_payload:{fictitious:true},p_status:'approved'})),2);
   assert.equal((await ok(store(c).remove([path]))).length,1);
   await ok(store(c).upload(path,ppt('REPLACED AFTER APPROVAL')));assert.equal(await read(r,path),'REPLACED AFTER APPROVAL');
   const old=await register(c,id,1);await ok(store(c).upload(old,ppt('NEW CONTENT OLD REVISION')));await allow(old);assert.equal(await read(r,old),'NEW CONTENT OLD REVISION');
   observations.approvedDeleteReupload=true;observations.oldRevisionAddition=true;
  });
  await check('signed upsert capability can overwrite a document after reader publication',async()=>{
   const draft=await project(c),path=await register(c,draft);await assign(draft,reader,true);
   const signed=await ok(store(c).createSignedUploadUrl(path,{upsert:true}));
   observations.signedUploadTtlSeconds=signedTTL(signed.token);
   await ok(store(c).upload(path,ppt('BEFORE SIGNED REPLACEMENT')));await allow(path);
   const upload=await store(anon).uploadToSignedUrl(path,signed.token,ppt('AFTER SIGNED REPLACEMENT'));
   observations.signedUpsertOverwritesPublished=!upload.error;
   if(!upload.error)assert.equal(await read(r,path),'AFTER SIGNED REPLACEMENT');
  });
  for(const lost of ['assignment','membership'])await check(`signed upload remains a capability after ${lost} removal`,async()=>{
   const writer=await actor('contributor'),draft=await project(c);await assign(draft,writer,true);
   const path=await register(writer.client,draft),signed=await ok(store(writer.client).createSignedUploadUrl(path));
   if(lost==='assignment')await assign(draft,writer,false);
   else await ok(administrator.rpc('izord_set_izord_member',{p_user:writer.id,p_role:'contributor',p_status:'revoked'}));
   assert.equal((await ok(writer.client.auth.getUser(writer.token))).user.id,writer.id);
   const upload=await store(anon).uploadToSignedUrl(path,signed.token,ppt('SIGNED AFTER LOSS'));
   observations[`signedUploadAfter_${lost}`]={accepted:!upload.error,objectExists:await exists(path)};
   await denied(store(writer.client).download(path));
   const result=await finalize(writer.client,path);assert.ok(result.error);observations.beforeFinalizationRPCAbsent=result.error.code==='PGRST202';
  });
 }else{
  const path=await register(c,id),original='FINALIZED ORIGINAL BYTES';
  await check('pending import is readable only by its authorized creator and cannot be published',async()=>{
   await denied(finalize(c,path));await denied(partner.rpc('izord_allow_reader_download',{p_asset:key(path),p_allowed:true}));
   await ok(store(c).upload(path,ppt(original)));
   const other=await actor('contributor');await assign(id,other,true);
   assert.equal(await read(c,path),original);
   for(const member of [r,partner,other.client])await denied(store(member).download(path));
   assert.deepEqual((await ok(store(c).list(id))).map(x=>x.name),[key(path)]);
   await ok(finalize(c,path));assert.equal(await read(c,path),original);await denied(finalize(c,path));
   await denied(store(r).download(path));await allow(path);assert.equal(await read(r,path),original);
  });
  await check('published bytes resist delete plus insert, ordinary upsert, update and move',async()=>{
   await store(c).remove([path]);assert.equal(await read(r,path),original);
   await denied(store(c).upload(path,ppt('REPLACEMENT')));await denied(store(c).upload(path,ppt('REPLACEMENT'),{upsert:true}));
   await denied(store(c).update(path,ppt('REPLACEMENT')));await denied(store(c).move(path,`${id}/${randomUUID()}`));
   await denied(withdraw(c,path));assert.equal(await read(r,path),original);
  });
  await check('signed upsert issued before finalization cannot change protected bytes afterward',async()=>{
   const draft=await project(c),asset=await register(c,draft);await assign(draft,reader,true);
   const signed=await ok(store(c).createSignedUploadUrl(asset,{upsert:true}),'issue signed upsert');observations.signedUploadTtlSeconds=signedTTL(signed.token);
   await ok(store(anon).uploadToSignedUrl(asset,signed.token,ppt('SIGNED ORIGINAL')),'initial signed upload');
   await denied(store(r).download(asset));await ok(finalize(c,asset));await allow(asset);
   const signedRead=await ok(store(r).createSignedUrl(asset,30));assert.equal(new URL(signedRead.signedUrl).origin,new URL(status.API_URL).origin);
   const versionBefore=(await sql.query("select version from storage.objects where bucket_id='izord-documents' and name=$1",[asset])).rows[0].version;
   await denied(store(anon).uploadToSignedUrl(asset,signed.token,ppt('SIGNED FORBIDDEN REPLACEMENT')));
   assert.equal(await read(r,asset),'SIGNED ORIGINAL');assert.equal(await read(c,asset),'SIGNED ORIGINAL');
   // Let Storage's asynchronous failed-upload cleanup run, then check the bytes again.
   await new Promise(resolve=>setTimeout(resolve,1500));
   assert.equal(await read(r,asset),'SIGNED ORIGINAL');assert.equal(await read(c,asset),'SIGNED ORIGINAL');
   const signedResponse=await fetch(signedRead.signedUrl,{redirect:'error'});assert.equal(signedResponse.ok,true);assert.equal(await signedResponse.text(),'SIGNED ORIGINAL');
   assert.equal((await sql.query("select version from storage.objects where bucket_id='izord-documents' and name=$1",[asset])).rows[0].version,versionBefore);
   observations.signedUpsertAfterFinalizationRefused=true;observations.originalBytesRetainedAfterSignedUpsert=true;observations.originalBytesRetainedAfterCleanupAndSignedRead=true;
   await ok(withdraw(partner,asset));await denied(store(anon).uploadToSignedUrl(asset,signed.token,ppt('WITHDRAWN REPLACEMENT')));
   await denied(store(c).download(asset));await denied(store(r).download(asset));
  });
  await check('withdrawal is permanent and a replacement has a new identity without inherited reader permission',async()=>{
   await ok(withdraw(partner,path));await denied(store(r).download(path));await denied(store(c).download(path));
   await denied(finalize(c,path));await denied(partner.rpc('izord_allow_reader_download',{p_asset:key(path),p_allowed:true}));
   await denied(store(c).upload(path,ppt('PATH REUSE')));
   const retired=(await sql.query("select lifecycle,reader_download,finalized_at is not null has_finalization from public.izord_assets where object_path=$1",[path])).rows[0];
   assert.deepEqual(retired,{lifecycle:'withdrawn',reader_download:false,has_finalization:true});assert.equal(await exists(path),true);
   const next=await register(c,id);assert.notEqual(next,path);await ok(store(c).upload(next,ppt('NEW IDENTITY')));await ok(finalize(c,next));
   await denied(store(r).download(next));await allow(next);assert.equal(await read(r,next),'NEW IDENTITY');
  });
  await check('retired pending paths reject even previously issued signed upload capabilities',async()=>{
   const draft=await project(c),asset=await register(c,draft),signed=await ok(store(c).createSignedUploadUrl(asset));
   await ok(withdraw(c,asset));await denied(store(anon).uploadToSignedUrl(asset,signed.token,ppt('RETIRED PENDING UPLOAD')));
   assert.equal(await exists(asset),false);await denied(finalize(c,asset));
  });
  await check('approved projects and old revisions reject document additions and late finalization',async()=>{
   const draft=await project(c),pending=await register(c,draft),approvedAsset=await register(c,draft);
   await ok(store(c).upload(pending,ppt('PENDING BEFORE APPROVAL')));
   await ok(store(c).upload(approvedAsset,ppt('APPROVED ORIGINAL')));await ok(finalize(c,approvedAsset));
   await assign(draft,reader,true);await allow(approvedAsset);
   assert.equal(await ok(partner.rpc('izord_save_project',{p_id:draft,p_expected_revision:1,p_title:'R1 approuvé',p_payload:{fictitious:true},p_status:'approved'})),2);
   await store(c).remove([approvedAsset]);assert.equal(await read(r,approvedAsset),'APPROVED ORIGINAL');
   await denied(store(c).upload(approvedAsset,ppt('APPROVED REPLACEMENT')));await denied(withdraw(c,approvedAsset));
   for(const member of [c,partner,administrator]){
    await denied(member.rpc('izord_register_asset',{p_project:draft,p_revision:1,p_kind:'presentation'}));
    await denied(member.rpc('izord_register_asset',{p_project:draft,p_revision:2,p_kind:'presentation'}));
    await denied(finalize(member,pending));
   }
   assert.equal(await ok(partner.rpc('izord_save_project',{p_id:draft,p_expected_revision:2,p_title:'R1 nouvelle révision',p_payload:{fictitious:true},p_status:'draft'})),3);
   await denied(c.rpc('izord_register_asset',{p_project:draft,p_revision:1,p_kind:'presentation'}));
   const next=await register(c,draft,3);await ok(store(c).upload(next,ppt('CURRENT REVISION')));await ok(finalize(c,next));assert.equal(await read(c,next),'CURRENT REVISION');
  });
  for(const lost of ['assignment','membership'])await check(`signed capability after ${lost} loss cannot finalize or publish`,async()=>{
   const writer=await actor('contributor'),draft=await project(c);await assign(draft,writer,true);await assign(draft,reader,true);
   const asset=await register(writer.client,draft),signed=await ok(store(writer.client).createSignedUploadUrl(asset));
   if(lost==='assignment')await assign(draft,writer,false);
   else await ok(administrator.rpc('izord_set_izord_member',{p_user:writer.id,p_role:'contributor',p_status:'revoked'}));
   assert.equal((await ok(writer.client.auth.getUser(writer.token))).user.id,writer.id);
   await denied(store(writer.client).upload(asset,ppt('ORDINARY JWT UPLOAD AFTER LOSS')));
   const upload=await store(anon).uploadToSignedUrl(asset,signed.token,ppt('SIGNED AFTER LOSS'));
   observations[`signedUploadAfter_${lost}`]={accepted:!upload.error,objectExists:await exists(asset),ttlSeconds:signedTTL(signed.token)};
   // The tested Storage version delegates an issued capability without a fresh membership check.
   assert.equal(!upload.error,true);assert.equal(await exists(asset),true);
   await denied(finalize(writer.client,asset));
   await denied(partner.rpc('izord_allow_reader_download',{p_asset:key(asset),p_allowed:true}));
   for(const member of [writer.client,r,c,partner])await denied(store(member).download(asset));
   assert.equal((await sql.query("select lifecycle from public.izord_assets where object_path=$1",[asset])).rows[0].lifecycle,'pending');
  });
  await check('finalization racing signed upsert leaves one stable finalized Storage version',async()=>{
   const draft=await project(c),asset=await register(c,draft),signed=await ok(store(c).createSignedUploadUrl(asset,{upsert:true}));
   await ok(store(c).upload(asset,ppt('RACE ORIGINAL')));
   const [finalized,upload]=await Promise.all([finalize(c,asset),store(anon).uploadToSignedUrl(asset,signed.token,ppt('RACE BEFORE FINALIZATION'))]);
   await ok(Promise.resolve(finalized));
   const finalBytes=await read(c,asset);assert.ok(['RACE ORIGINAL','RACE BEFORE FINALIZATION'].includes(finalBytes));
   const record=(await sql.query("select a.storage_object_id=o.id id_matches,a.storage_object_version=o.version version_matches from public.izord_assets a join storage.objects o on o.bucket_id='izord-documents' and o.name=a.object_path where a.object_path=$1",[asset])).rows[0];
   assert.deepEqual(record,{id_matches:true,version_matches:true});
   await denied(store(anon).uploadToSignedUrl(asset,signed.token,ppt('AFTER RACE FINALIZATION')));assert.equal(await read(c,asset),finalBytes);
   observations.concurrentSignedUploadAcceptedBeforeFinalization=!upload.error;
  });
 }
 const report={phase,passed:checks.length,failed:0,realLocalAuth:true,realLocalStorage:true,GoogleCalls:false,migrationSourceSHA256:createHash('sha256').update(readFileSync('supabase/migrations/20260916170445_module_access_foundation.sql')).digest('hex'),checks,observations};
 mkdirSync(process.env.IZORD_ARTIFACTS,{recursive:true});writeFileSync(join(process.env.IZORD_ARTIFACTS,`document-lifecycle-${phase}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({phase,passed:checks.length,observations}));
}catch(e){console.error(`FAIL ${phase}: ${active} (${code(e)}${e.step?'; '+e.step+'; '+e.reason+'; HTTP '+e.http:''})`);process.exitCode=1;}
finally{await sql.end().catch(()=>{});for(const c of clients)c.auth.stopAutoRefresh();authAdmin.auth.stopAutoRefresh();anon.auth.stopAutoRefresh();}
