/** New fictitious dossiers on the retained disposable loopback Auth/DB/Storage
 * bench only. Creates no Production records and never reads repository .env. */
require('../i18n/register-typescript.cjs');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
const sharp=require('sharp');
const {createProjectData}=require('../../lib/izord/model.ts');
const out='/private/tmp/oar-task-link-corrections';mkdirSync(out,{recursive:true});
const prior=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const status=JSON.parse(readFileSync('/private/tmp/oar-relations-bench/status.private.json','utf8'));
const api=new URL(status.API_URL),db=new URL(status.DB_URL);
if(process.env.TASK_LINK_CORRECTIONS_ACK!=='TASK_LINK_CORRECTIONS_DISPOSABLE_LOCAL_ONLY'||api.origin!=='http://127.0.0.1:55931'||db.hostname!=='127.0.0.1'||db.port!=='55932')throw Error('Explicit isolated photo-regression bench required');
const rawFetch=global.fetch;global.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.origin!==api.origin)throw Error('Non-local photo fixture fetch blocked');return rawFetch(input,{...init,redirect:'error'});};
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const owner=createClient(status.API_URL,status.ANON_KEY,opts),admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,opts);
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const photos=payload=>({photos:payload.data.photos,importGallery:payload.data.importGallery,photoGalleryRoles:payload.data.photoGalleryRoles,importMeta:payload.data.importMeta,sourceDocuments:payload.sourceDocuments});
const ok=async action=>{const r=await action;if(r.error)throw Error('Fictitious local operation rejected: '+(r.error.code||r.error.status||'unknown'));return r.data;};
(async()=>{const sql=new Client({connectionString:status.DB_URL});await sql.connect();try{
 await ok(owner.auth.signInWithPassword({email:prior.users.full.email,password:prior.password}));
 const user=await ok(owner.auth.getUser());assert.equal(user.user.id,prior.users.full.id);
 const readerEmail='photo-reader-'+randomUUID()+'@example.invalid';
 const created=await ok(admin.auth.admin.createUser({email:readerEmail,password:prior.password,email_confirm:true}));
 const reader={id:created.user.id,email:readerEmail,password:prior.password};
 await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,true,false)',[reader.id]);
 await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'izord','reader','active')",[reader.id]);
 await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'izord','read','{}')",[reader.id]);
 const readerClient=createClient(status.API_URL,status.ANON_KEY,opts);await ok(readerClient.auth.signInWithPassword({email:reader.email,password:reader.password}));
 const projects=[];
 async function upload(projectId,revision,kind,buffer,name,mime){
  const blob=new Blob([buffer],{type:mime});const path=await ok(owner.rpc('izord_register_generator_asset',{p_project:projectId,p_revision:revision,p_kind:kind,p_size:buffer.length,p_mime:mime,p_name:name}));
  const signed=await ok(owner.storage.from('izord-documents').createSignedUploadUrl(path,{upsert:false}));
  await ok(owner.storage.from('izord-documents').uploadToSignedUrl(path,signed.token,blob));
  const id=path.split('/')[1];await ok(owner.rpc('izord_finalize_asset',{p_asset:id}));
  const received=await ok(owner.storage.from('izord-documents').download(path));assert.equal(hash(Buffer.from(await received.arrayBuffer())),hash(buffer));
  return{id,path,kind,bytes:buffer.length,sha256:hash(buffer)};
 }
 for(const [index,name]of ['A','B'].entries()){
  const title='Présentation photos fictives '+name+' '+randomUUID().slice(0,8);
  const id=await ok(owner.rpc('izord_create_project',{p_title:title}));
  const assets=[];
  for(let n=0;n<6;n++){
   const buffer=await sharp({create:{width:320+n*10,height:180+n*5,channels:3,background:{r:35+index*70+n*19,g:50+n*25,b:180-index*40-n*18}}}).jpeg({quality:88}).toBuffer();
   assets.push(await upload(id,1,'photo',buffer,'photo-fictive-'+name+'-'+(n+1)+'.jpg','image/jpeg'));
  }
  const source=await upload(id,1,'pdf',Buffer.from('%PDF-1.4\n% Source documentaire fictive '+name+'\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),'source-fictive-'+name+'.pdf','application/pdf');assets.push(source);
  const data=createProjectData();data.state.project=title;data.state.address='Adresse fictive '+name;data.state.features='Texte historique fictif '+name;
  data.photos=Object.fromEntries(['main','view','inside','operation'].map((role,n)=>[role,assets[n].id]));
  data.importGallery=assets.slice(4,6).map((asset,n)=>({data:asset.id,label:'Photothèque fictive '+name+' '+(n+1),source:'Source fictive '+name,page:n+1,width:360+n*10,height:200+n*5}));
  data.photoGalleryRoles={main:0,view:1,inside:0,operation:1};
  data.importMeta={source:'Source fictive '+name,fictitious:true,roles:{...data.photoGalleryRoles},preservedNote:'Provenance indépendante '+name};
  const historicalPayload={schema:'IZORD_GENERATOR_V1',data:structuredClone(data),sourceDocuments:[source.id]};
  assert.equal(await ok(owner.rpc('izord_save_generator',{p_id:id,p_expected_revision:1,p_title:title,p_payload:historicalPayload,p_status:'draft'})),2);
  data.state.features='Texte courant fictif '+name;
  const payload={schema:'IZORD_GENERATOR_V1',data,sourceDocuments:[source.id]};
  assert.equal(await ok(owner.rpc('izord_save_generator',{p_id:id,p_expected_revision:2,p_title:title,p_payload:payload,p_status:'draft'})),3);
  await ok(owner.rpc('izord_assign_project',{p_project:id,p_user:reader.id,p_assigned:true}));
  const stored=(await sql.query('select * from public.izord_projects where id=$1',[id])).rows[0];
  const versions=(await sql.query('select revision,title,payload,status,author_id from public.izord_project_versions where project_id=$1 order by revision',[id])).rows;
  const refs=(await sql.query('select slot,asset_id from public.izord_generator_asset_refs where project_id=$1 and project_revision=3 order by slot',[id])).rows;
  const assetRows=(await sql.query('select * from public.izord_assets where project_id=$1 order by id',[id])).rows;
  assert.deepEqual(stored.payload,payload);assert.equal(refs.length,7);assert(assetRows.every(asset=>asset.lifecycle==='finalized'));
  const denied=await readerClient.rpc('izord_save_generator',{p_id:id,p_expected_revision:3,p_title:title,p_payload:payload,p_status:'draft'});assert(denied.error);assert.equal(denied.error.code,'42501');
  const forbiddenPhoto=await readerClient.storage.from('izord-documents').download(assets[0].path);assert(forbiddenPhoto.error);
  assert.equal((await ok(readerClient.from('izord_projects').select('id').eq('id',id))).length,1);
  projects.push({id,title,currentRevision:3,historicalRevision:2,assets,baseline:{payload,photoState:photos(payload),photoStateHash:hash(photos(payload)),payloadHash:hash(payload),versions,refs,assetRows},editedText:'Texte seul modifié, photographies conservées '+name});
 }
 const fixture={api:status.API_URL,statusFile:'/private/tmp/oar-relations-bench/status.private.json',owner:{id:prior.users.full.id,email:prior.users.full.email,password:prior.password},reader,projects};
 writeFileSync(out+'/photo-fixture.private.json',JSON.stringify(fixture,null,2),{mode:0o600});
 const result={actualAuth:true,actualRpc:true,actualStorage:true,actualDatabase:true,loopbackOnly:true,projects:projects.map(p=>({id:p.id,title:p.title,revision:p.currentRevision,historicalRevision:p.historicalRevision,photoStateHash:p.baseline.photoStateHash,photoAssets:6,sourceDocuments:1,finalizedAssets:7,referenceSlots:7,readerSaveDenied:true,readerPhotoDownloadDenied:true}))};
 writeFileSync(out+'/photo-setup-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({projects:2,finalizedPhotos:12,finalizedSources:2,readerChecks:'passed',fixture:out+'/photo-fixture.private.json'}));
 await readerClient.auth.stopAutoRefresh();
}finally{await sql.end();await owner.auth.stopAutoRefresh();await admin.auth.stopAutoRefresh();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
