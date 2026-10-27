/** Baseline before sensitive flags: real Auth, private PDF and high-resolution JPEG. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {connect,sql,request,login,fixtureFile,directory,status,createFonciereData,createGeneratorRepository,toPresentationData,fullGrants,ok} from './local.mjs';
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const definitions={admin:{admin:true,full:true,role:'admin',level:'contribute',izord:'contribute',legacyExport:true},writer:{role:'contributor',level:'contribute'},reader:{role:'reader',level:'read'},moduleReader:{role:'contributor',level:'read'},roleReader:{role:'reader',level:'contribute'},partner:{role:'partner',level:'contribute'},unassigned:{role:'contributor',level:'contribute'},noAccess:{role:'contributor',level:'none'},inactive:{role:'contributor',level:'contribute',active:false},missingRole:{level:'contribute'},presentationsOnly:{role:'contributor',level:'none',izord:'contribute'},both:{role:'contributor',level:'contribute',izord:'contribute'},bothLegacyExport:{role:'contributor',level:'contribute',izord:'contribute',legacyExport:true},clement:{role:'contributor',level:'contribute'}};
await connect();
try{
 const fresh=(await sql.query("select to_regclass('public.crm_workspace_state') t")).rows[0].t===null;
 if(!fresh){
  assert.equal(process.env.FONCIERE_SENSITIVE_RESUME,'1','Explicit own incomplete setup resume required');
  assert.equal(Number((await sql.query('select count(*) from fonciere_projects')).rows[0].count),0);
  assert.equal(Number((await sql.query('select count(*) from izord_projects')).rows[0].count),0);
  assert.equal(Number((await sql.query("select count(*) from auth.users where email not like 'fonciere-sensitive-%@example.invalid'")).rows[0].count),0);
  await sql.query('delete from crm_module_grants; delete from crm_access_profiles; delete from app_memberships');
  for(const row of (await sql.query('select id from auth.users')).rows){const removed=await request('/auth/v1/admin/users/'+row.id,status.SERVICE_ROLE_KEY,undefined,'DELETE');assert.equal(removed.status,200);}
 }
 const baseline=readFileSync('tests/izord/sql-fixture.sql','utf8');if(fresh){await sql.query(baseline.slice(baseline.indexOf('create table public.crm_workspace_state'),baseline.indexOf('create schema storage;')));
 await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");}
 const split=process.env.FONCIERE_SENSITIVE_MIGRATION||readdirSync('supabase/migrations').find(name=>name.endsWith('_fonciere_sensitive_permissions.sql'));assert(split,'Final sensitive migration filename required');
 const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&name!==split).sort();
 if(fresh)for(const name of migrations){try{await sql.query(readFileSync(join('supabase/migrations',name),'utf8'));}catch(error){throw new Error('Baseline migration '+name+': '+error.message);}}
 const users={};
 for(const [name,def] of Object.entries(definitions)){
  const email='fonciere-sensitive-'+name.toLowerCase()+'@example.invalid',password=randomBytes(24).toString('hex');const result=await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true});assert.equal(result.status,200);const user={id:result.data.id,email,password};users[name]=user;
  await sql.query('insert into crm_access_profiles(user_id,active,general_admin) values($1,$2,$3)',[user.id,def.active!==false,def.admin??false]);
  await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member')",[user.id]);
  if(def.role)await sql.query("insert into app_memberships(user_id,workspace_id,role) values($1,'izord',$2)",[user.id,def.role]);
  const grants={...(def.full?fullGrants:{}),tasks:{level:'contribute',sensitive:{export:true,...(def.full?{delete:true}:{})}},fonciere:{level:def.level,sensitive:{}},izord:{level:def.izord??'none',sensitive:def.legacyExport?{export:true}:{}}};
  for(const [module,grant] of Object.entries(grants))await sql.query('insert into crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[user.id,module,grant.level,grant.sensitive]);
 }
 await sql.query("update crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[{contacts:[],leads:[],tasks:[],properties:[],vehicles:[],boats:[],quotes:[],vendorQuotes:[],vendorInvoices:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[],documents:[],planningEntries:[]}]);
 const admin=await login(users.admin);
 const data={...createFonciereData(),name:'Villa photo fictive',propertyAddress:'8 avenue fictive, Cannes',agencyReference:'FIXTURE-SENSITIVE'};delete data.agentContactId;delete data.agencyContactId;for(const role of ['main','view','inside','operation'])data.presentationData.photos[role]='';
 const created=await ok(admin.client.rpc('fonciere_save_project',{p_id:null,p_expected_revision:null,p_payload:{schema:'FONCIERE_PROPERTY_V1',data,sourceDocuments:[]},p_contact:'',p_agency_contact:''}));
 const foreignData={...createFonciereData(),name:'Dossier non affecté fictif'};delete foreignData.agentContactId;delete foreignData.agencyContactId;for(const role of ['main','view','inside','operation'])foreignData.presentationData.photos[role]='';
 const foreign=await ok(admin.client.rpc('fonciere_save_project',{p_id:null,p_expected_revision:null,p_payload:{schema:'FONCIERE_PROPERTY_V1',data:foreignData,sourceDocuments:[]},p_contact:'',p_agency_contact:''}));
 const jpeg=await sharp({create:{width:1800,height:1200,channels:3,background:{r:28,g:92,b:136}}}).jpeg({quality:92}).toBuffer();
 const pdf=Buffer.from('%PDF-1.4\nFictional sensitive private original\n%%EOF');
 const assets={};
 for(const [name,kind,bytes,mime] of [['photo','photo',jpeg,'image/jpeg'],['pdf','pdf',pdf,'application/pdf']]){
  const path=await ok(admin.client.rpc('fonciere_register_asset',{p_project:created,p_revision:1,p_kind:kind,p_size:bytes.length,p_mime:mime,p_name:name==='photo'?'photo-originale-fictive.jpg':'source-originale-fictive.pdf'}));const id=path.split('/')[1];await ok(admin.client.storage.from('fonciere-documents').upload(path,bytes,{upsert:false,contentType:mime,cacheControl:'0'}));await ok(admin.client.rpc('fonciere_finalize_asset',{p_asset:id}));assets[name]={id,object_path:path,sha256:hash(bytes),size:bytes.length,mime};
 }
 data.presentationData.photos.main=assets.photo.id;data.presentationData.importGallery=[{data:assets.photo.id,label:'Photo originale fictive',page:1,width:1800,height:1200,source:''}];
 await ok(admin.client.rpc('fonciere_save_project',{p_id:created,p_expected_revision:1,p_payload:{schema:'FONCIERE_PROPERTY_V1',data,sourceDocuments:[assets.pdf.id]},p_contact:'',p_agency_contact:''}));
 const photoData='data:image/jpeg;base64,'+jpeg.toString('base64'),presentationData=toPresentationData({...data,presentationData:{...data.presentationData,photos:{...createFonciereData().presentationData.photos,main:photoData},importGallery:[{data:photoData,label:'Instantané fictif',page:1,width:1800,height:1200}]}},{id:created,revision:2});
 const generator=createGeneratorRepository(admin.client),presentation=await generator.createProject('Présentation historique avec photo'),independent=structuredClone(presentationData);delete independent.importMeta.fonciereSource;
 const historical=await generator.saveProject({project:presentation,data:independent,sourceFiles:[new File([pdf],'copie-historique-fictive.pdf',{type:'application/pdf'})]});
 const historicalPayload=structuredClone(historical.project.payload);historicalPayload.data.importMeta={...historicalPayload.data.importMeta,fonciereSource:{id:created,revision:2}};
 await ok(admin.client.rpc('izord_save_generator',{p_id:historical.project.id,p_expected_revision:historical.project.revision,p_title:historical.project.title,p_payload:historicalPayload,p_status:historical.project.status}));
 for(const [name,def] of Object.entries(definitions))if(!['unassigned','missingRole'].includes(name)&&def.role){await sql.query('insert into fonciere_project_assignments(project_id,user_id) values($1,$2)',[created,users[name].id]);if(def.izord)await sql.query('insert into izord_project_assignments(project_id,user_id) values($1,$2)',[historical.project.id,users[name].id]);}
 const pendingInvitations={};
 for(const [name,role,level,recipient,state] of [['reader','reader','read','reader','pending'],['contributor','contributor','contribute','writer','pending'],['admin','admin','contribute','admin','pending'],['inherit',null,'contribute','clement','pending'],['accepted','reader','read',null,'accepted'],['revoked','contributor','contribute',null,'revoked'],['expired','admin','contribute',null,'expired']]){
  const token=randomBytes(32).toString('hex'),email=recipient?users[recipient].email:'fonciere-sensitive-invite-'+name+'@example.invalid';const inserted=await sql.query("insert into crm_access_invitations(email,token_hash,grants,izord_role,assignments,fonciere_assignments,created_by,accepted_at,revoked_at,expires_at) values($1,sha256(convert_to($2,'UTF8')),$3,$4,$5,$6,$7,case when $8='accepted' then now() end,case when $8='revoked' then now() end,case when $8='expired' then now()-interval '1 day' else now()+interval '7 days' end) returning id",[email,token,{fonciere:{level,sensitive:{}}},role,[],[created],users.admin.id,state]);pendingInvitations[name]={id:inserted.rows[0].id,token,recipient,state,role,level};
 }
 const tables=['app_memberships','crm_access_profiles','crm_module_grants','crm_access_invitations','fonciere_projects','fonciere_project_assignments','fonciere_project_contacts','fonciere_assets','izord_projects','izord_project_assignments','izord_project_versions','izord_assets','fonciere_presentation_sources','izord_generator_asset_refs','crm_workspace_state'];const before={};for(const table of tables)before[table]=(await sql.query('select * from public.'+table+' order by 1,2')).rows;
 const effective={};
 for(const [name,user] of Object.entries(users)){
  await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);effective[name]=(await sql.query("select app_private.module_allowed('fonciere') readable,app_private.can_fonciere_project($1,false) project_read,app_private.can_fonciere_project($1,true) project_write,app_private.can_fonciere_asset($2,false) metadata_read,app_private.can_fonciere_asset($2,false) original_read,app_private.can_project($3,false) presentation_read,app_private.task_target_export_allowed(jsonb_build_object('type','fonciere_project','id',$1)) task_export,app_private.full_access() full_access",[created,assets.photo.object_path,historical.project.id])).rows[0];await sql.query('rollback');
 }
 const fixture={api:status.API_URL,app:'http://127.0.0.1:3197',publicKey:status.ANON_KEY,users,definitions,projects:{assigned:created,foreign},presentations:{historical:historical.project.id},assets,pendingInvitations,effectiveBefore:effective,migrationFile:split};writeFileSync(fixtureFile,JSON.stringify(fixture),{mode:0o600});writeFileSync(join(directory,'fonciere-sensitive-before.private.json'),JSON.stringify(before),{mode:0o600});writeFileSync(join(directory,'fonciere-sensitive-photo.private.jpg'),jpeg,{mode:0o600});writeFileSync(join(directory,'fonciere-sensitive-pdf.private.pdf'),pdf,{mode:0o600});
 console.log('Prepared '+Object.keys(users).length+' fictional Auth accounts, real high-resolution JPEG and PDF, historical presentation snapshot and pre-migration permission/data backup.');
}finally{await sql.end();}
