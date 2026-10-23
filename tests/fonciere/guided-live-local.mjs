/** Actual loopback Auth -> RPC -> SQL validation, using only fictitious accounts.
 * Refuses remote endpoints. Does not reset, replace memberships, or touch real data. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url), {Client}=require('pg'),{createClient}=require('@supabase/supabase-js');
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.FONCIERE_PRIVATE_FIXTURE||'/private/tmp/fonciere-delivery/local-fixture.private.json','utf8'));
const api=new URL(status.API_URL), db=new URL(status.DB_URL);assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,'55931');assert.equal(db.hostname,'127.0.0.1');assert.equal(db.port,'55932');assert.equal(process.env.FONCIERE_TEST_ACK,'fictitious-local-only');
const compiled=process.env.FONCIERE_COMPILED||'/private/tmp/fonciere-guided-delivery/compiled';
const {createFonciereData,toPresentationData,FONCIERE_FIELDS}=require(join(compiled,'lib/fonciere/model.js'));
const {setGuidedField,readGuidedField,changeGuidedPropertyType}=require(join(compiled,'lib/fonciere/guided.js'));
const {createFonciereRepository}=require(join(compiled,'lib/fonciere/repository.js'));
const sql=new Client({connectionString:status.DB_URL}),users={},results=[],created=[];
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
async function ok(p){const r=await p;if(r.error)throw Object.assign(new Error(r.error.message),{cause:r.error});return r.data;}
async function test(name,run){await run();results.push({name,passed:true});console.log('PASS '+name);}
const create=(type)=>{let d=createFonciereData();d.name='Test guidé fictif '+type;return setGuidedField(d,'propertyType',type);};
async function rawSave(saved,data){const payload=structuredClone(saved.project.payload);payload.data={...payload.data,...data};return users.writer.client.rpc('fonciere_save_project',{p_id:saved.project.id,p_expected_revision:saved.project.revision,p_payload:payload,p_contact:'',p_agency_contact:''});}
try{
 await sql.connect();
 for(const name of ['writer','reader','denied','noContacts']){const credentials=fixture.users[name],client=createClient(api.href,status.ANON_KEY,options);await ok(client.auth.signInWithPassword({email:credentials.email,password:credentials.password}));users[name]={client,repo:createFonciereRepository(client)};}
 await test('house, apartment, land and mixed property actual save/reload through Auth and SQL',async()=>{
  for(const type of ['villa','apartment','land','mixed']){let data=create(type);data=setGuidedField(data,'askingPrice',1250000.75);data=setGuidedField(data,'area',133.5);data=setGuidedField(data,'equipment',['heating','alarm']);if(type==='land')data=setGuidedField(data,'servicing','to_confirm');if(type==='apartment')data=setGuidedField(data,'floor',6);if(type==='mixed')data=setGuidedField(data,'lots',25);if(type==='villa')data=setGuidedField(data,'bedrooms',14);const saved=await users.writer.repo.saveProject({data});created.push(saved.project.id);const loaded=await users.writer.repo.loadProject(saved.project.id);assert.equal(readGuidedField(loaded.data,'propertyType'),type);assert.equal(readGuidedField(loaded.data,'askingPrice'),1250000.75);assert.deepEqual(readGuidedField(loaded.data,'equipment'),['heating','alarm']);}
 });
 let saved=await users.writer.repo.loadProject(created[0]);
 await test('SQL rejects forged fields, identity keys, unknown options, exclusive None, fractional counts and bad source references',async()=>{
  for(const values of [{agentContactId:'forged'},{propertyType:'made_up'},{rooms:2.5},{area:-1},{equipment:['none','heating']},{fees:{inclusion:'included',agentContactId:'forged'}},{diagnostics:[{code:'dpe',status:'in_progress',grade:'A'}]},{pointsToVerify:[{code:'planning',status:'verified',documentId:'12345678-1234-4234-8234-123456789012'}]}]){const r=await rawSave(saved,{guided:{version:1,values,inactive:[],details:{}}});assert.ok(r.error,JSON.stringify(values));}
  const r=await rawSave(saved,{contactSources:{agent:{baseline:{agentContactId:'forged'}}}});assert.ok(r.error);const after=await users.writer.repo.loadProject(saved.project.id);assert.equal(after.project.revision,saved.project.revision);
 });
 await test('legacy free strings survive a real reload/resave with no content loss',async()=>{
  const d=createFonciereData();d.name='Projet historique fictif';for(const key of FONCIERE_FIELDS)if(!['agentContactId','agencyContactId','name'].includes(key))d[key]=`  ${key} : peut-être NON, 0 € ; valeur atypique\n🧾  `;
  const first=await users.writer.repo.saveProject({data:d});created.push(first.project.id);const loaded=await users.writer.repo.loadProject(first.project.id);const again=await users.writer.repo.saveProject({data:loaded.data,previous:loaded});for(const key of FONCIERE_FIELDS)assert.equal(again.data[key],d[key]);
 });
 await test('retained type-specific data persists inactive across SQL and is excluded from new presentation',async()=>{
  let d=saved.data;d=setGuidedField(d,'bedrooms',14);d=changeGuidedPropertyType(d,'land');saved=await users.writer.repo.saveProject({data:d,previous:saved});const loaded=await users.writer.repo.loadProject(saved.project.id);assert.equal(readGuidedField(loaded.data,'bedrooms'),14);assert.ok(loaded.data.guided.inactive.includes('bedrooms'));assert.ok(!String(toPresentationData(loaded.data).state.features).includes('chambres'));
 });
 await test('read-only, denied and anonymous users cannot save guided payloads',async()=>{
  const payload=saved.project.payload,args={p_id:saved.project.id,p_expected_revision:saved.project.revision,p_payload:payload,p_contact:'',p_agency_contact:''};for(const name of ['reader','denied'])assert.ok((await users[name].client.rpc('fonciere_save_project',args)).error);assert.ok((await createClient(api.href,status.ANON_KEY,options).rpc('fonciere_save_project',args)).error);
 });
 await test('permission boundaries and optimistic concurrency reject stale save without losing current values',async()=>{
  const noContact=await users.noContacts.repo.saveProject({data:create('commercial')});created.push(noContact.project.id);assert.equal(readGuidedField(noContact.data,'propertyType'),'commercial');const stale=saved;const fresh=await users.writer.repo.saveProject({data:setGuidedField(saved.data,'askingPrice',1400000),previous:saved});await assert.rejects(users.writer.repo.saveProject({data:stale.data,previous:stale}));const current=await users.writer.repo.loadProject(fresh.project.id);assert.equal(readGuidedField(current.data,'askingPrice'),1400000);
 });
 await test('evidence document links accept own finalized sources and reject foreign-property sources',async()=>{
  const owner=await users.writer.repo.loadProject(created[1]);const other=await users.writer.repo.loadProject(created[2]);const pdf=new File([new TextEncoder().encode('%PDF-1.4\nFictional source\n%%EOF')],'diagnostic-fictif.pdf',{type:'application/pdf'});const withDoc=await users.writer.repo.saveProject({data:owner.data,previous:owner,sourceFiles:[pdf]});const source=withDoc.sourceDocuments.at(-1);assert.ok(source);const linked=await users.writer.repo.saveProject({data:setGuidedField(withDoc.data,'pointsToVerify',[{code:'planning',status:'to_verify',documentId:source,detail:'Document à lire'}]),previous:withDoc});assert.equal(readGuidedField(linked.data,'pointsToVerify')[0].documentId,source);const rejected=await rawSave(other,{guided:{version:1,values:{pointsToVerify:[{code:'planning',status:'verified',documentId:source}]},inactive:[],details:{}}});assert.ok(rejected.error);assert.match(rejected.error.message,/forbidden/);
 });
 await test('new private validators cannot be called by anonymous or authenticated roles',async()=>{
  const privileges=await sql.query("select p.proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('fonciere_guided_catalog','validate_fonciere_guided_scalar','validate_fonciere_payload','validate_fonciere_payload_legacy_v1')");assert.equal(privileges.rowCount,4);for(const row of privileges.rows){assert.equal(row.anon,false);assert.equal(row.authenticated,false);}
 });
 const out=resolve(process.env.FONCIERE_ARTIFACTS||'/private/tmp/fonciere-guided-delivery');mkdirSync(out,{recursive:true});writeFileSync(join(out,'guided-server-results.json'),JSON.stringify({environment:'disposable-loopback-auth-rpc-sql',results,projectIds:created},null,2));console.log(`${results.length} guided real local server groups passed`);
}catch(e){console.error(e.message);if(e.cause?.message)console.error(e.cause.message);process.exitCode=1;}finally{await sql.end();}
