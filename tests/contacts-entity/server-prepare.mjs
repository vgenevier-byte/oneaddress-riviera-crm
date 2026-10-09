/** Fresh fictional schema + real Auth sessions; never reads repository .env. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Client} from 'pg';
import {ACK,ORIGIN,assertTarget} from './server-target.mjs';
const manifest=JSON.parse(readFileSync('/private/tmp/oar-contacts-entity-stack-manifest.json','utf8'));
const status=JSON.parse(readFileSync(manifest.statusFile,'utf8'));
assertTarget({origin:status.API_URL,database:status.DB_URL,acknowledgement:process.env.CONTACTS_ENTITY_ACK});
const sql=new Client({connectionString:status.DB_URL});
const evidence=resolve('../evidence/server'),directory=mkdtempSync('/private/tmp/oar-contacts-entity-fixtures-');
const accounts={},origin=ORIGIN,publishableKey=status.ANON_KEY;
async function request(path,body,token){
 const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert(r.ok,'Unexpected local response '+r.status+' '+String(data?.code||data?.error_code||''));return data;
}
await sql.connect();
try{
 const existing=(await sql.query("select to_regclass('public.crm_workspace_state') relation")).rows[0].relation;
 if(existing){
  assert(process.argv.includes('--resume-schema'),'Fresh disposable DB only; never reset a preexisting workspace');
  assert.equal((await sql.query('select count(*)::int n from public.crm_access_profiles')).rows[0].n,0,'Resume allowed only before fictional access profiles exist');
  assert.equal((await sql.query("select count(*)::int n from auth.users where email not like 'contacts-entity-%@example.invalid'")).rows[0].n,0,'Only abandoned fictional Auth setup users can be removed');
  assert.equal((await sql.query('select count(*)::int n from auth.sessions')).rows[0].n,0,'Never clear an active fictional bench session');
  await sql.query("delete from auth.users where email like 'contacts-entity-%@example.invalid'");
  assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload,{fixture:'unchanged'});
 }
 const fixture=readFileSync('tests/izord/sql-fixture.sql','utf8');
 const start=fixture.indexOf('create table public.crm_workspace_state'),end=fixture.indexOf('create schema storage;');
 assert(start>0&&end>start);
 // Only fictional historical app tables. Real Auth/Storage schemas remain intact.
 if(!existing){
  await sql.query(fixture.slice(start,end));
  await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false);create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents');");
 }
 const migrationFiles=readdirSync('supabase/migrations').filter(f=>/^\d{14}_.+\.sql$/.test(f)&&f<'20261008000000').sort();
 if(!existing)for(const file of migrationFiles)await sql.query(readFileSync('supabase/migrations/'+file,'utf8'));
 const installed=JSON.parse(readFileSync(resolve('../evidence/server/installed-functions.json'),'utf8'));
 const definitionChecks=[];
 for(const target of installed){
  const local=(await sql.query('select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 and pg_get_function_identity_arguments(p.oid)=$3',[target.schema,target.name,target.arguments])).rows[0]?.definition;
  assert(local,'Installed function signature missing locally: '+target.name);
  definitionChecks.push({schema:target.schema,name:target.name,sameDefinition:local===target.definition,localSha256:createHash('sha256').update(local).digest('hex'),installedSha256:createHash('sha256').update(target.definition).digest('hex')});
 }
 assert(definitionChecks.every(x=>x.sameDefinition),'Published local definitions must match actually installed functions');
 for(const profile of ['owner','contributor','reader','none','revoked']){
  const email=`contacts-entity-${profile}-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('hex');
  const created=await request('/auth/v1/admin/users',{email,password,email_confirm:true},status.SERVICE_ROLE_KEY);
  const login=await request('/auth/v1/token?grant_type=password',{email,password});
  const user=await request('/auth/v1/user',undefined,login.access_token);
  assert.equal(user.id,created.id);assert.equal(login.user.id,created.id);
  const claims=JSON.parse(Buffer.from(login.access_token.split('.')[1],'base64url').toString());
  assert(claims.session_id&&claims.sub===created.id);
  assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2',[claims.session_id,created.id])).rows[0].n,1);
  accounts[profile]={id:created.id,email,password,token:login.access_token,sessionId:claims.session_id};
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'oar','member','active')",[created.id]);
  await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,true,$2)',[created.id,profile==='owner']);
 }
 const modules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats'];
 for(const moduleId of modules)await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,'contribute',$3)",[accounts.owner.id,moduleId,{delete:true,export:true,bank_read:true,bank_write:true,payment:true}]);
 for(const [profile,level] of Object.entries({contributor:'contribute',reader:'read',none:'none',revoked:'contribute'}))await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[accounts[profile].id,'contacts',level,{delete:profile==='contributor',export:false,bank_read:false,bank_write:false,payment:false}]);
 await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'documents','read','{}')",[accounts.reader.id]);
 const stamp='2020-01-02T03:04:05Z';
 const baseContact={kind:'Client',firstName:'',civility:'',companyName:'',email:'',phone:'',city:'',postalAddress:'',budget:0,source:'',notes:'Note historique française',createdAt:stamp,createdBy:accounts.owner.id,updatedAt:stamp,updatedBy:accounts.owner.id};
 const contacts=[{...baseContact,id:'legacy-person',name:'Ancien',firstName:'Élodie',companyName:'Rattachement historique'},
  {...baseContact,id:'legacy-blank',name:'',firstName:'Guillaume historique',companyName:'Ancienne société non qualifiée'},
  {...baseContact,id:'homonym-one',name:'Martin',firstName:'Camille',companyName:'Même société'},
  {...baseContact,id:'homonym-two',name:'Martin',firstName:'Camille',companyName:'Même société'},
  {...baseContact,id:'historic-vendor',name:'Prestataire historique',kind:'Prestataire',supplierCategory:'Maison',supplierBankAccounts:[{id:'retained-bank',iban:'FR7600000000000000000000000',status:'Vérifié',accountHolder:'Prestataire fictif'}]}];
 const documents=Array.from({length:8},(_,i)=>({id:'retained-document-'+i,name:'Historique fictif '+i,storagePath:'entity-retained-'+i+'.pdf',isFolder:false,createdBy:accounts.owner.id,createdAt:stamp}));
 const payload={contacts,documents,leads:[{id:'historic-lead',contactName:'Élodie Ancien',status:'Nouveau',category:'Conciergerie',value:0,notes:'Historique inchangé'}],properties:[],vehicles:[],boats:[],quotes:[],planningEntries:[],vendorQuotes:[],vendorInvoices:[],houseTrackingHouses:[],houseTrackingWorkers:[],houseTimeEntries:[],housePayments:[],retained:{sentinel:'Aucun nettoyage ni reclassification'}};
 await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[payload]);
 for(let i=0;i<8;i++){
  await sql.query("insert into public.crm_document_scopes(provider,resource_id,module,collection,record_id,title) values('storage',$1,'documents','documents',$2,$3)",['entity-retained-'+i+'.pdf','retained-document-'+i,'Historique fictif '+i]);
  await sql.query("insert into public.crm_document_shares(provider,resource_id,user_id,created_by) values('storage',$1,$2,$3)",['entity-retained-'+i+'.pdf',accounts.reader.id,accounts.owner.id]);
 }
 await sql.query("notify pgrst,'reload schema'");
 const bench={origin,publishableKey,accounts,statusFile:manifest.statusFile,stackDirectory:manifest.directory,directory,acknowledgement:ACK,fixtureContactIds:contacts.map(x=>x.id)};
 const benchFile=join(directory,'bench.private.json');writeFileSync(benchFile,JSON.stringify(bench,null,2),{mode:0o600});
 writeFileSync('/private/tmp/oar-contacts-entity-bench-path.txt',benchFile+'\n',{mode:0o600});
 writeFileSync(join(evidence,'baseline-schema.json'),JSON.stringify({passed:true,realAuth:true,realSessions:5,fictionalUsersOnly:true,migrationFiles,definitionChecks,loopbackOnly:true,shares:8,fixtureContactIds:bench.fixtureContactIds},null,2)+'\n');
 console.log(JSON.stringify({ready:true,realAuth:true,origin,benchFile,profileNames:Object.keys(accounts),installedDefinitionsMatch:definitionChecks.length,retainedShares:8}));
}finally{await sql.end();}
