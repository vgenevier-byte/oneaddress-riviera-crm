/** Real local PG/Auth/PostgREST test. Never loads a repository .env or a remote target. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Client} from 'pg';
const path=process.env.CONTACT_COMPANY_STATUS;
assert(path?.startsWith('/private/tmp/'),'Explicit private temporary local status required');
assert.equal(process.env.CONTACT_COMPANY_ACK,'CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY');
const status=JSON.parse(readFileSync(path,'utf8'));
assert.equal(new URL(status.API_URL).origin,'http://127.0.0.1:55931');
const dbURL=new URL(status.DB_URL);assert.equal(dbURL.hostname,'127.0.0.1');assert.equal(dbURL.port,'55932');
const sql=new Client({connectionString:status.DB_URL});
const checks=[],accounts={},installedDefinitionHashes={};const run=randomUUID().slice(0,8),prefix='relation-'+run+'-';
const migration='supabase/migrations/20261024081258_contact_company_relations.sql';
async function request(path,token,body,method){const response=await fetch(status.API_URL+path,{method:method??(body===undefined?'GET':'POST'),redirect:'error',headers:{apikey:status.ANON_KEY,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});let data;const text=await response.text();try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};}
const rpc=(name,profile,args={})=>request('/rest/v1/rpc/'+name,typeof profile==='string'?accounts[profile]?.token:profile,args);
async function ok(name,profile,args={}){const r=await rpc(name,profile,args);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
async function read(profile='contributor'){return ok('crm_read_module',profile,{p_module:'contacts'});}
async function bundle(contact,person=null,existing=null,profile='contributor',revision){return rpc('crm_save_contact_bundle',profile,{p_contact:contact,p_person:person,p_existing_person_id:existing,p_revision:revision??(await read(profile)).revision});}
async function mutate(id,patch={},remove=false,profile='contributor'){return rpc('crm_mutate_record',profile,{p_module:'contacts',p_collection:'contacts',p_id:id,p_patch:patch,p_revision:(await read(profile)).revision,p_delete:remove});}
async function saveBundle(...args){const r=await bundle(...args);assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.data.workspaceRevision);return r.data;}
async function refused(label,operation,expected){const before=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;const r=await operation();assert.ok(r.status>=400,JSON.stringify(r));if(expected)assert.match(String(r.data.message),expected);assert.deepEqual((await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload,before,label+' rollback');checks.push(label);}
const id=s=>prefix+s;const company=s=>({id:id(s),entityType:'company',companyName:'Agence fictive '+s,name:'',kind:'Client'});const person=s=>({id:id(s),entityType:'person',name:'Fictif '+s,firstName:'Camille',kind:'Client'});
await sql.connect();
try{
 assert.equal((await sql.query("select count(*)::int n from auth.users where email not like '%@example.invalid'")).rows[0].n,0,'Fictional local stack only');
 for(const [profile,level]of Object.entries({owner:'contribute',contributor:'contribute',reader:'read',none:'none'})){
  const email='contact-company-'+profile+'-'+run+'@example.invalid',password=randomBytes(24).toString('hex');
  const created=await request('/auth/v1/admin/users',status.SERVICE_ROLE_KEY,{email,password,email_confirm:true});assert.equal(created.status,200,JSON.stringify(created));
  const login=await request('/auth/v1/token?grant_type=password',null,{email,password});assert.equal(login.status,200,JSON.stringify(login));
  const claims=JSON.parse(Buffer.from(login.data.access_token.split('.')[1],'base64url'));assert(claims.session_id);
  accounts[profile]={id:created.data.id,email,password,token:login.data.access_token,sessionId:claims.session_id};
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role,status) values($1,'oar','member','active')",[created.data.id]);
  await sql.query('insert into public.crm_access_profiles(user_id,active,general_admin) values($1,true,$2)',[created.data.id,profile==='owner']);
  const modules=profile==='owner'?['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats']:['contacts'];
  for(const moduleId of modules)await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)',[created.data.id,moduleId,level,profile==='owner'?{delete:true,export:true,bank_read:true,bank_write:true,payment:true}:{delete:profile==='contributor'}]);
 }
 // A historical unlinked company exists before the new rule, with its fields
 // and unrelated workspace data preserved by the additive migration.
 await sql.query("select set_config('request.jwt.claim.sub',$1,false)",[accounts.owner.id]);
 await sql.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:accounts.owner.id,session_id:accounts.owner.sessionId})]);
 const legacy=company('legacy');legacy.notes='Historical company, no invented person';
 const installed=(await sql.query("select to_regprocedure('app_private.guard_contact_company_relations()') f")).rows[0].f;
 if(!installed)await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',coalesce(payload->'contacts','[]')||$1::jsonb) where workspace_id='oneaddress-riviera'",[JSON.stringify([legacy])]);
 const before=(await sql.query("select to_jsonb(w) w from public.crm_workspace_state w where workspace_id='oneaddress-riviera'")).rows[0].w;
 const acl=(await sql.query("select md5(coalesce(jsonb_agg(to_jsonb(d) order by provider,resource_id)::text,'')) hash from public.crm_document_scopes d")).rows[0].hash;
 if(!installed)await sql.query(readFileSync(migration,'utf8'));
 assert.deepEqual((await sql.query("select to_jsonb(w) w from public.crm_workspace_state w where workspace_id='oneaddress-riviera'")).rows[0].w,before);checks.push(installed?'existing workspace and revision preserved during setup':'additive migration preserves workspace and revision');
 const migrationSource=readFileSync(migration,'utf8');
 for(const name of ['app_private.guard_contact_company_relations','app_private.contact_bundle_row','public.crm_save_contact_bundle','app_private.project_record']){
  const offset=migrationSource.indexOf('function '+name+'(');assert(offset>=0);const bodyStart=migrationSource.indexOf('as $$',offset)+5,bodyEnd=migrationSource.indexOf('$$;',bodyStart);const expected=migrationSource.slice(bodyStart,bodyEnd);
  const [schema,procedure]=name.split('.');const definition=(await sql.query('select p.prosrc,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[schema,procedure])).rows[0];assert.equal(definition.prosrc,expected,'Installed function body must match exact tested migration: '+name);installedDefinitionHashes[name]=createHash('sha256').update(definition.definition).digest('hex');
 }
 const referenceDefinition=(await sql.query("select pg_get_functiondef('public.crm_reference_options(text)'::regprocedure) definition")).rows[0].definition;assert(referenceDefinition.includes("'companyId','primaryContactId','mergedIntoCompanyId','companyContactStatus'"));installedDefinitionHashes['public.crm_reference_options']=createHash('sha256').update(referenceDefinition).digest('hex');checks.push('installed SQL function bodies exactly match latest migration');
 await sql.query("notify pgrst,'reload schema'");
 // Reload is asynchronous; a bounded retry polls the API capability.
 for(let attempt=0;attempt<30;attempt++){const r=await rpc('crm_save_contact_bundle','none',{p_contact:{id:'probe'},p_revision:''});if(r.data?.code!=='PGRST202')break;await new Promise(resolve=>setTimeout(resolve,100));}
 const single=person('standalone');await saveBundle(single);checks.push('independent person persisted without company');
 await refused('new orphan company rejected by bundle',()=>bundle(company('orphan')),/contact_company_person_required/);
 await refused('new orphan company rejected by scoped mutation',()=>mutate(id('orphan'),{entityType:'company',companyName:'Orphan'}),/contact_company_person_required/);
 const a=company('a'),p1=person('p1');const created=await saveBundle(a,p1);assert.equal(created.collections.contacts.find(x=>x.id===p1.id).companyId,a.id);checks.push('atomic company plus first new person persisted');
 // A legacy unqualified row is never a genuine linked person merely because
 // it has a name. Explicit existing-person selection qualifies it atomically.
 const legacyPersonId=id('unqualified');let legacyResult=await mutate(legacyPersonId,{name:'Personne historique non qualifiée',firstName:'Camille'});assert.equal(legacyResult.status,200,JSON.stringify(legacyResult));
 await refused('unqualified legacy contact cannot link through scoped patch',()=>mutate(legacyPersonId,{companyId:a.id}),/contact_company_link_requires_person/);
 await refused('unqualified legacy contact cannot link through raw owner workspace',async()=>{const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;raw.contacts=raw.contacts.map(p=>p.id===legacyPersonId?{...p,companyId:a.id}:p);return request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:raw},'PATCH');},/contact_company_link_requires_person/);
 await saveBundle({id:a.id},null,legacyPersonId);const qualified=(await read()).collections.contacts.find(p=>p.id===legacyPersonId);assert.equal(qualified.entityType,'person');assert.equal(qualified.companyId,a.id);checks.push('explicit existing-person bundle qualifies and links selected legacy contact');
 // Return it to an independent qualified person so the existing last-person
 // protection scenarios retain exactly the intended two members.
 assert.equal((await mutate(legacyPersonId,{companyId:''})).status,200);
 const existing=person('existing');await saveBundle(existing);await saveBundle({id:a.id},null,existing.id);assert.equal((await read()).collections.contacts.filter(x=>x.id===existing.id).length,1);checks.push('existing person attached without duplicate identity');
 const fail=company('fail');await refused('failed child validation leaves no partial company',()=>bundle(fail,{id:id('bad'),entityType:'person',name:''}),/contact_name_required/);
 await refused('fake child type rejected',()=>bundle(company('wrong'),company('pretend-person')),/contact_bundle_new_person_invalid/);
 await refused('primary must belong to company',()=>bundle({id:a.id,primaryContactId:single.id}),/contact_company_primary_invalid/);
 assert.equal((await mutate(p1.id,{companyId:''})).status,200);assert.equal((await read()).collections.contacts.find(x=>x.id===a.id).primaryContactId,existing.id);checks.push('detaching primary among several chooses remaining person');
 await refused('last person cannot detach',()=>mutate(existing.id,{companyId:''}),/contact_company_person_required/);
 await refused('last person cannot be deleted',()=>mutate(existing.id,{},true),/record_referenced|contact_company_person_required/);
 await refused('person cannot link to person',()=>mutate(single.id,{companyId:p1.id}),/contact_company_reference_invalid/);
 await refused('company cannot masquerade as linked person',()=>mutate(a.id,{companyId:a.id}),/contact_company_link_requires_person/);
 const stale=(await read()).revision;await saveBundle({id:single.id,city:'Updated'});await refused('stale revision rejected',()=>bundle({id:single.id,city:'Stale'},null,null,'contributor',stale),/revision_conflict/);
 for(const profile of ['reader','none'])await refused(profile+' cannot save bundle',()=>rpc('crm_save_contact_bundle',profile,{p_contact:person(profile),p_revision:'not-disclosed'}),/module_forbidden/);
 await refused('anonymous cannot save bundle',()=>request('/rest/v1/rpc/crm_save_contact_bundle',null,{p_contact:person('anon'),p_revision:''}),/permission denied|module_forbidden/);
 // Both transactions start with the same module revision. The workspace row
 // lock serializes them and exactly one must lose with 40001.
 const raceRevision=(await read()).revision;
 const races=await Promise.all([bundle({id:single.id,city:'Concurrent A'},null,null,'contributor',raceRevision),bundle({id:single.id,city:'Concurrent B'},null,null,'contributor',raceRevision)]);
 assert.equal(races.filter(r=>r.status===200).length,1);const conflict=races.find(r=>r.status>=400);assert.equal(conflict.data.code,'40001');assert.match(conflict.data.message,/revision_conflict/);checks.push('simultaneous same-revision writes produce one commit and one conflict');
 await refused('forged needs-contact marker cannot create orphan',async()=>{const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;raw.contacts.push({...company('forged-legacy'),companyContactStatus:'needs_contact'});return request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:raw},'PATCH');},/contact_company_person_required/);
 const fields=await read();assert(fields.collections.contacts.find(x=>x.id===a.id).primaryContactId);assert(!JSON.stringify(fields).includes('supplierBankAccounts'));checks.push('authorized relation projection excludes private banking');
 if(!installed){const legacyRead=fields.collections.contacts.find(x=>x.id===legacy.id);assert.equal(legacyRead.companyContactStatus,'needs_contact');
  // Full owner workspace route: untouched legacy companies must not block a
  // different module update, but changing that company still requires a person.
  const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
  const unrelated=structuredClone(raw);unrelated.contactCompanyFixture={unchangedLegacy:true};
  const saved=await request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:unrelated},'PATCH');assert.equal(saved.status,204,JSON.stringify(saved));checks.push('owner unrelated workspace save preserves incomplete legacy company');
  await refused('legacy company edit requires actual person',()=>bundle({id:legacy.id,city:'Changed'}),/contact_company_person_required/);
  await saveBundle({id:legacy.id},person('legacy-first'));assert(!('companyContactStatus'in(await read()).collections.contacts.find(x=>x.id===legacy.id)));checks.push('legacy company regularized with distinct real person');
 }
 await refused('owner direct workspace orphan rejected',async()=>{const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;raw.contacts.push(company('direct-orphan'));return request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:raw},'PATCH');},/contact_company_person_required/);
 await refused('owner cannot detach last person through raw workspace',async()=>{const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;raw.contacts=raw.contacts.map(p=>p.id===existing.id?{...p,companyId:''}:p);return request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:raw},'PATCH');},/contact_company_person_required/);
 const b=company('b'),p2=person('p2');await saveBundle(b,p2);const raw=(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
 raw.contacts=raw.contacts.map(row=>row.id===p2.id?{...row,companyId:a.id}:row.id===b.id?{...row,mergedIntoCompanyId:a.id,primaryContactId:''}:row);
 assert.equal((await request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera',accounts.owner.token,{payload:raw},'PATCH')).status,204);const merged=(await read()).collections.contacts;assert(merged.some(x=>x.id===b.id&&x.mergedIntoCompanyId===a.id));assert(merged.some(x=>x.id===p2.id&&x.companyId===a.id));checks.push('company consolidation retains alias and separate people IDs');
 await refused('alias cannot receive new person',()=>bundle({id:b.id},person('alias-person')),/contact_bundle_company_required/);
 await refused('contributor cannot forge alias',()=>mutate(a.id,{mergedIntoCompanyId:b.id}),/field_forbidden_or_invalid/);
 assert.equal((await sql.query("select md5(coalesce(jsonb_agg(to_jsonb(d) order by provider,resource_id)::text,'')) hash from public.crm_document_scopes d")).rows[0].hash,acl);checks.push('document scopes and private document ownership unchanged');
 const persisted=await read();const sqlPeople=(await sql.query("select count(*)::int n from public.crm_workspace_state w cross join lateral jsonb_array_elements(w.payload->'contacts') p where p->>'companyId'=$1",[a.id])).rows[0].n;assert.equal(sqlPeople,2);assert.equal(persisted.collections.contacts.filter(x=>x.companyId===a.id).length,2);checks.push('reload and independent SQL read confirm persisted relations');
 const references=await ok('crm_reference_options','contributor',{p_module:'contacts'});assert.equal(references.contacts.find(x=>x.id===existing.id).companyId,a.id);assert.equal(references.contacts.find(x=>x.id===b.id).mergedIntoCompanyId,a.id);checks.push('reference selectors preserve canonical relation metadata');
 await sql.query('update public.crm_access_profiles set active=false,revision=revision+1 where user_id=$1',[accounts.reader.id]);
 await refused('revoked account rejected by fresh server permission check',()=>rpc('crm_save_contact_bundle','reader',{p_contact:person('revoked'),p_revision:''}),/module_forbidden/);
 // A revoked genuine session must fail even if the JWT has not expired.
 const sessionProbe=accounts.none;await sql.query("update public.crm_module_grants set level='contribute' where user_id=$1 and module='contacts'",[sessionProbe.id]);await sql.query('delete from auth.sessions where id=$1',[sessionProbe.sessionId]);
 await refused('deleted Auth session rejected for otherwise authorized account',()=>rpc('crm_save_contact_bundle','none',{p_contact:person('dead-session'),p_revision:''}),/module_forbidden/);
 await sql.query("update public.crm_module_grants set level='none' where user_id=$1 and module='contacts'",[sessionProbe.id]);
 await sql.query('update public.crm_access_profiles set active=true,revision=revision+1 where user_id=$1',[accounts.reader.id]);
 const bench={origin:status.API_URL,publishableKey:status.ANON_KEY,accounts:{...accounts,revoked:accounts.none},statusFile:path,directory:'/private/tmp/oar-relations-bench',acknowledgement:'CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY',fixtureContactIds:persisted.collections.contacts.map(c=>c.id),relationIds:{company:a.id,person:existing.id,standalone:single.id,alias:b.id}};
 writeFileSync('/private/tmp/oar-relations-bench/bench.private.json',JSON.stringify(bench,null,2),{mode:0o600});
 const result={passed:true,actualLocalPostgres:true,actualAuthSessions:4,actualPostgREST:true,remoteWrites:0,checks,migrationApplied:!installed,installedDefinitionHashes,migrationSHA256:createHash('sha256').update(readFileSync(migration)).digest('hex'),benchFile:'/private/tmp/oar-relations-bench/bench.private.json'};
 writeFileSync('/private/tmp/oar-relations-bench/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await sql.end();}
