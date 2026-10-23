/** Actual Auth/PostgREST/PostgreSQL checks on the explicitly guarded fictitious local bench. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
const status=JSON.parse(readFileSync(process.env.ADDRESS_LOCAL_STATUS,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.ADDRESS_LOCAL_FIXTURE,'utf8'));
const api=new URL(status.API_URL),database=new URL(status.DB_URL);
assert.equal(process.env.ADDRESS_LOCAL_ACK,'fictitious-address-local-only');
assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,'55931');
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55932');
assert.equal(fixture.api,api.origin);
assert.ok(Object.values(fixture.users).every(user=>typeof user.email==='string'&&user.email.endsWith('@example.invalid')),'Only fictional local accounts may receive test grants');
const out=process.env.ADDRESS_ARTIFACTS||'/private/tmp/oar-address-evidence';mkdirSync(out,{recursive:true});
const sql=new Client({connectionString:status.DB_URL}),results=[];
const test=async(name,run)=>{await run();results.push({name,passed:true});console.log('PASS '+name);};
const ok=async promise=>{const result=await promise;if(result.error)throw Object.assign(new Error(result.error.message),{cause:result.error});return result.data;};
const snapshot=async()=>Object.fromEntries(await Promise.all(['crm_workspace_state','app_memberships','crm_access_profiles','crm_module_grants','crm_document_scopes','crm_document_shares','izord_project_versions','fonciere_presentation_sources'].map(async table=>[table,(await sql.query(`select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`)).rows])));
const tables=async()=>Object.fromEntries(await Promise.all(['izord_project_versions','fonciere_presentation_sources'].map(async table=>[table,(await sql.query(`select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`)).rows])));
await sql.connect();
try{
 await test('migration preserves all existing data, memberships, grants, policies, snapshots and original function identities',async()=>{
  const source=readFileSync('supabase/migrations/20261023105820_address_autocomplete_metadata.sql','utf8');
  const applied=(await sql.query("select to_regprocedure('app_private.validate_address_details(jsonb)') is not null applied")).rows[0].applied;
  if(applied)return;
  const before=await snapshot(),policies=(await sql.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  const funcs=(await sql.query("select oid,proacl,proconfig,prosecdef from pg_proc where oid in ('app_private.project_record(text,jsonb)'::regprocedure,'public.crm_reference_options(text)'::regprocedure,'app_private.validate_fonciere_payload(uuid,jsonb)'::regprocedure)")).rows;
  await sql.query(source);
  assert.deepEqual(await snapshot(),before);assert.deepEqual((await sql.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  for(const fn of funcs)assert.deepEqual((await sql.query('select oid,proacl,proconfig,prosecdef from pg_proc where oid=$1',[fn.oid])).rows[0],fn);
  const exposed=(await sql.query("select proname from pg_proc where pronamespace='app_private'::regnamespace and (proname like '%address%' or proname='reconcile_address_record') and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))")).rows;assert.deepEqual(exposed,[]);
  writeFileSync(out+'/migration-preservation.json',JSON.stringify({passed:true,migrationSha256:createHash('sha256').update(source).digest('hex'),preserved:Object.keys(before),policiesPreserved:true,functionOidsAndAclsPreserved:true,noNewCallablePrivateFunctions:true},null,2));
 });
 const grants=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats','izord','publisher','monthlyCharges'];
 await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'oar','member','active') on conflict(user_id,workspace_id) do update set status='active'",[fixture.users.admin.id]);
 await sql.query("insert into public.crm_access_profiles(user_id,general_admin) values($1,true) on conflict(user_id) do update set general_admin=true,active=true,revision=crm_access_profiles.revision+1",[fixture.users.admin.id]);
 for(const moduleId of grants)await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,'contribute',$3) on conflict(user_id,module) do update set level='contribute',sensitive=$3",[fixture.users.admin.id,moduleId,{delete:true,export:true,bank_read:true,bank_write:true,payment:true}]);
 for(const [name,moduleId,level]of [['writer','contacts','contribute'],['writer','houseTracking','contribute'],['reader','contacts','read'],['reader','houseTracking','read']]){
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'oar','member','active') on conflict(user_id,workspace_id) do update set status='active'",[fixture.users[name].id]);
  await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,'{\"export\":true}') on conflict(user_id,module) do update set level=$3,sensitive=crm_module_grants.sensitive||'{\"export\":true}'",[fixture.users[name].id,moduleId,level]);
 }
 const users={};for(const name of ['admin','writer','reader','denied','noContacts']){const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});await ok(client.auth.signInWithPassword({email:fixture.users[name].email,password:fixture.users[name].password}));users[name]=client;}
 assert.equal((await ok(users.admin.rpc('crm_access_snapshot'))).fullAccess,true);console.log('LOCAL_BROWSER_READY fictional admin full; writer contacts/house contribute; reader contacts/house read.');
 if(process.env.ADDRESS_PREPARE_ONLY==='1')process.exit(0);
 const immutable=await tables();
 const selected={houseNumber:'8',street:'Avenue du Petit Juas',line1:'8 Avenue du Petit Juas',complement:'Bâtiment test',postalCode:'06400',city:'Cannes',country:'France',countryCode:'FR',formattedAddress:'8 Avenue du Petit Juas\nBâtiment test\n06400 Cannes\nFrance',latitude:43.558,longitude:7.017,source:'ign',sourceId:'test-public-ign',precision:'address'};
 selected.fingerprint=selected.formattedAddress.normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
 const contactId='address-contact-'+randomUUID(),houseId='address-house-'+randomUUID();
 const read=(who,module)=>ok(users[who].rpc('crm_read_module',{p_module:module}));
 const mutate=async(who,module,collection,id,patch)=>{const before=await read(who,module);return users[who].rpc('crm_mutate_record',{p_module:module,p_collection:collection,p_id:id,p_patch:patch,p_revision:before.revision,p_delete:false});};
 await test('limited contributor creates Contact structured metadata; authenticated read/export and reference reuse retain every component',async()=>{
  await ok(mutate('writer','contacts','contacts',contactId,{entityType:'person',name:'Adresse fictive',firstName:'Test',kind:'Client',city:'Cannes',postalAddress:selected.formattedAddress,postalAddressDetails:selected}));
  for(const result of [await read('writer','contacts'),await read('reader','contacts'),await ok(users.writer.rpc('crm_export_module',{p_module:'contacts'})),await ok(users.reader.rpc('crm_export_module',{p_module:'contacts'}))])assert.deepEqual(result.collections.contacts.find(x=>x.id===contactId).postalAddressDetails,selected);
  const references=await ok(users.writer.rpc('crm_reference_options',{p_module:'contacts'}));assert.deepEqual(references.contacts.find(x=>x.id===contactId).postalAddressDetails,selected);
 });
 await test('full administrator state write retains metadata and limited House contribution saves/reloads without financial changes',async()=>{
  const current=(await ok(users.admin.from('crm_workspace_state').select('payload').eq('workspace_id','oneaddress-riviera').single())).payload;
  const finances={entries:current.houseTimeEntries,payments:current.housePayments};
  await ok(mutate('writer','houseTracking','houseTrackingHouses',houseId,{name:'Maison fictive adresse',address:selected.formattedAddress,addressDetails:selected}));
  assert.deepEqual((await read('writer','houseTracking')).collections.houseTrackingHouses.find(x=>x.id===houseId).addressDetails,selected);
  const full=(await ok(users.admin.from('crm_workspace_state').select('payload').eq('workspace_id','oneaddress-riviera').single())).payload;
  full.contacts=full.contacts.map(c=>c.id===contactId?{...c,notes:'Note fictive sauvegardée par le parcours complet'}:c);
  await ok(users.admin.from('crm_workspace_state').update({payload:full}).eq('workspace_id','oneaddress-riviera'));
  assert.deepEqual((await read('writer','contacts')).collections.contacts.find(x=>x.id===contactId).postalAddressDetails,selected);
  const after=(await ok(users.admin.from('crm_workspace_state').select('payload').eq('workspace_id','oneaddress-riviera').single())).payload;assert.deepEqual({entries:after.houseTimeEntries,payments:after.housePayments},finances);
 });
 await test('legacy primary-address and city patches invalidate previous geocode/provider/base while retaining complement',async()=>{
  await ok(mutate('writer','contacts','contacts',contactId,{postalAddress:'7 Nouvelle rue fictive\n98000 Monaco',city:'Monaco'}));
  let c=(await read('writer','contacts')).collections.contacts.find(x=>x.id===contactId);assert.equal(c.postalAddressDetails.source,'manual');assert.equal(c.postalAddressDetails.latitude,undefined);assert.equal(c.postalAddressDetails.sourceId,undefined);assert.equal(c.postalAddressDetails.postalCode,'');assert.equal(c.postalAddressDetails.complement,selected.complement);
  await ok(mutate('writer','contacts','contacts',contactId,{postalAddress:selected.formattedAddress,city:'Cannes',postalAddressDetails:selected}));
  await ok(mutate('writer','contacts','contacts',contactId,{city:'Luxembourg'}));c=(await read('writer','contacts')).collections.contacts.find(x=>x.id===contactId);assert.equal(c.postalAddressDetails.source,'manual');assert.equal(c.postalAddressDetails.longitude,undefined);
  await ok(mutate('writer','houseTracking','houseTrackingHouses',houseId,{address:'Adresse internationale fictive\nL-0010 Luxembourg'}));assert.equal((await read('reader','houseTracking')).collections.houseTrackingHouses.find(x=>x.id===houseId).addressDetails.source,'manual');
 });
 await test('nested unknown fields and invalid coordinates rejected; read-only, hidden module and anonymous writes refused',async()=>{
  for(const details of [{...selected,secret:'forbidden'},{...selected,latitude:91},{...selected,postalCode:6400}])assert.ok((await mutate('writer','contacts','contacts',contactId,{postalAddressDetails:details})).error);
  assert.ok((await mutate('reader','contacts','contacts',contactId,{postalAddress:selected.formattedAddress})).error);
  assert.ok((await users.denied.rpc('crm_read_module',{p_module:'contacts'})).error);assert.ok((await users.noContacts.rpc('crm_reference_options',{p_module:'contacts'})).error);
  assert.ok((await users.denied.rpc('crm_export_module',{p_module:'contacts'})).error);
  const anonymous=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false}});assert.ok((await anonymous.rpc('crm_read_module',{p_module:'contacts'})).error);
  assert.ok((await anonymous.rpc('crm_mutate_record',{p_module:'contacts',p_collection:'contacts',p_id:contactId,p_patch:{postalAddress:'Forbidden'},p_revision:'forged',p_delete:false})).error);
  assert.deepEqual(await tables(),immutable);
 });
 await test('Foncière repository saves/reloads structured property and independent agency address with all selected metadata',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const compiled=process.env.ADDRESS_COMPILED||'/private/tmp/address-persistence-compiled';
  const {createFonciereRepository}=require(compiled+'/lib/fonciere/repository.js');
  const {createFonciereData,toPresentationData}=require(compiled+'/lib/fonciere/model.js');
  const {selectPropertyAddress}=require(compiled+'/lib/fonciere/address.js');
  const repo=createFonciereRepository(users.writer);
  let data=selectPropertyAddress(createFonciereData(),selected);data.name='Propriété fictive adresse '+randomUUID();
  const agency={...selected,houseNumber:'2',street:'Rue fictive agence',line1:'2 Rue fictive agence',complement:'',postalCode:'06000',city:'Nice',formattedAddress:'2 Rue fictive agence\n06000 Nice\nFrance',latitude:43.7,longitude:7.26,sourceId:'agency-fixture'};
  agency.fingerprint=agency.formattedAddress.replace(/\s+/g,' ').trim().toLocaleLowerCase();
  data.agencyAddress=agency.formattedAddress;data.agencyAddressDetails=agency;
  const saved=await repo.saveProject({data});let loaded=await repo.loadProject(saved.project.id);
  assert.deepEqual(loaded.data.propertyAddressDetails,selected);assert.deepEqual(loaded.data.agencyAddressDetails,agency);
  assert.equal(loaded.data.propertyAddress,selected.line1+'\n'+selected.complement);assert.equal(loaded.data.postalCode,'06400');assert.equal(loaded.data.city,'Cannes');
  const presentation=toPresentationData(loaded.data);assert.deepEqual(presentation.addressDetails,selected);assert.equal(presentation.state.address,selected.formattedAddress);
  const legacy=structuredClone(loaded.project.payload);delete legacy.data.propertyAddressDetails;delete legacy.data.agencyAddressDetails;legacy.data.name+=' — titre corrigé par un ancien client';
  await ok(users.writer.rpc('fonciere_save_project',{p_id:loaded.project.id,p_expected_revision:loaded.project.revision,p_payload:legacy,p_contact:'',p_agency_contact:''}));
  loaded=await repo.loadProject(loaded.project.id);assert.deepEqual(loaded.data.propertyAddressDetails,selected);assert.deepEqual(loaded.data.agencyAddressDetails,agency);
  const row=structuredClone(loaded.project.payload);row.data.propertyAddress='Autre rue fictive';
  await ok(users.writer.rpc('fonciere_save_project',{p_id:loaded.project.id,p_expected_revision:loaded.project.revision,p_payload:row,p_contact:'',p_agency_contact:''}));
  const changed=(await ok(users.writer.from('fonciere_projects').select('payload').eq('id',loaded.project.id).single())).payload;
  assert.equal(changed.data.propertyAddressDetails.source,'manual');assert.equal(changed.data.propertyAddressDetails.latitude,undefined);assert.equal(changed.data.guided.values.coordinates,null);assert.deepEqual(changed.data.agencyAddressDetails,agency);
 });
 await test('native IZORD repository save/reload keeps address metadata and new revision snapshot; historical versions stay unchanged',async()=>{
  const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
  const compiled=process.env.ADDRESS_COMPILED||'/private/tmp/address-persistence-compiled';
  const {createGeneratorRepository}=require(compiled+'/lib/izord/repository.js');const {createProjectData}=require(compiled+'/lib/izord/model.js');
  const repo=createGeneratorRepository(users.writer),project=await repo.createProject('Présentation fictive adresse');
  const data=createProjectData();data.state.project=project.title;data.state.address=selected.formattedAddress;data.addressDetails=selected;
  const saved=await repo.saveProject({project,data});const loaded=await repo.loadProject(saved.project.id);assert.deepEqual(loaded.data.addressDetails,selected);
  const version=(await sql.query('select payload from izord_project_versions where project_id=$1 and revision=$2',[saved.project.id,saved.project.revision])).rows[0];assert.deepEqual(version.payload.data.addressDetails,selected);
  const next=structuredClone(saved.project.payload);next.data.state.address='Adresse manuelle internationale\nL-0010 Luxembourg';
  await ok(users.writer.rpc('izord_save_generator',{p_id:saved.project.id,p_expected_revision:saved.project.revision,p_title:project.title,p_payload:next,p_status:saved.project.status}));
  const changed=await repo.loadProject(saved.project.id);assert.equal(changed.data.addressDetails.source,'manual');assert.equal(changed.data.addressDetails.latitude,undefined);
  assert.deepEqual((await sql.query('select payload from izord_project_versions where project_id=$1 and revision=$2',[saved.project.id,saved.project.revision])).rows[0],version);
  const after=await tables();for(const [table,rows]of Object.entries(immutable))for(const row of rows)assert.ok(after[table].some(current=>JSON.stringify(current)===JSON.stringify(row)),'Historical snapshot retained '+table);
 });
 writeFileSync(out+'/persistence-results.json',JSON.stringify({passed:true,actualLocalAuthRpcDatabase:true,productionWrites:0,results},null,2));
}finally{await sql.end();}
