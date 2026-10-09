/** Real GoTrue password login → JWT → PostgREST → installed CRM RPC tests.
 * Every URL/database is checked before client construction. No mocked responses.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {getBench,setContactLevel} from './server-control.mjs';
const {bench,status}=getBench(),sql=new Client({connectionString:status.DB_URL});
const results=[],createdIds=[],requests=[];
const same=(a,b)=>assert.deepEqual(a,b);
async function request(path,profile='contributor',body,method=body===undefined?'GET':'POST',headers={}){
 assert(/^\/(?:auth\/v1\/(?:token\?grant_type=password|user)|rest\/v1\/(?:rpc\/[A-Za-z0-9_]+|crm_workspace_state(?:\?.*)?))$/.test(path),'Only local Auth and relevant app endpoints');
 const account=typeof profile==='string'?bench.accounts[profile]:profile;
 requests.push({method,path:path.split('?')[0],profile:typeof profile==='string'?profile:'fresh-auth'});
 const r=await fetch(bench.origin+path,{method,redirect:'error',headers:{apikey:bench.publishableKey,...(account?{Authorization:'Bearer '+account.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};
}
const rpc=(name,profile,args)=>request('/rest/v1/rpc/'+name,profile,args);
function ok(r){assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function error(r,message,code){assert(r.status>=400&&r.status<600,JSON.stringify(r));if(message)assert.equal(r.data.message,message);if(code)assert.equal(r.data.code,code);return r;}
const read=async(profile='contributor')=>ok(await rpc('crm_read_module',profile,{p_module:'contacts'}));
const mutate=(profile,id,patch,revision,deleting=false)=>rpc('crm_mutate_record',profile,{p_module:'contacts',p_collection:'contacts',p_id:id,p_patch:patch,p_revision:revision,p_delete:deleting});
async function create(profile,patch,id='entity-'+randomUUID()){
 const before=await read(profile);const result=ok(await mutate(profile,id,patch,before.revision));createdIds.push(id);const row=result.collections.contacts.find(x=>x.id===id);assert(row);return row;
}
async function update(profile,id,patch){const before=await read(profile);const result=ok(await mutate(profile,id,patch,before.revision));return result.collections.contacts.find(x=>x.id===id);}
async function refuse(profile,patch,message,code='22023',id='refused-'+randomUUID()){
 const before=await read(profile);error(await mutate(profile,id,patch,before.revision),message,code);same(await read(profile),before);
}
const globalRead=async()=>ok(await request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&select=payload,updated_at,updated_by','owner'))[0];
const globalSave=(snapshot,payload)=>request('/rest/v1/crm_workspace_state?workspace_id=eq.oneaddress-riviera&updated_at=eq.'+encodeURIComponent(snapshot.updated_at)+'&select=payload,updated_at,updated_by','owner',{payload,updated_by:bench.accounts.none.id},'PATCH',{Prefer:'return=representation'});
const test=async(name,run)=>{await run();results.push({name,passed:true});console.log('PASS '+name);};
await sql.connect();
try{
 assert.equal((await sql.query("select count(*)::int n from auth.users where email not like 'contacts-entity-%@example.invalid'")).rows[0].n,0);
 // A rerun restores only its known named legacy fixture, before test snapshots.
 // This is local fixture setup, not a tested product mutation or classification.
 const legacy=(await sql.query("select r from public.crm_workspace_state w cross join lateral jsonb_array_elements(w.payload->'contacts') r where workspace_id='oneaddress-riviera' and r->>'id'='legacy-person'")).rows[0].r;
 if(Object.hasOwn(legacy,'entityType')){
  delete legacy.entityType;
  await sql.query('begin');
  try{
   await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',(select jsonb_agg(r) from jsonb_array_elements(payload->'contacts') r where r->>'id'<>'legacy-person')) where workspace_id='oneaddress-riviera'");
   await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{contacts}',(payload->'contacts')||jsonb_build_array($1::jsonb)) where workspace_id='oneaddress-riviera'",[legacy]);await sql.query('commit');
  }catch(error){await sql.query('rollback');throw error;}
 }
 const retainedShares=(await sql.query('select to_jsonb(s) value from public.crm_document_shares s order by provider,resource_id,user_id')).rows;
 const retainedScopes=(await sql.query('select to_jsonb(s) value from public.crm_document_scopes s order by provider,resource_id')).rows;
 const retainedPayload=(await globalRead()).payload;
 const retainedOther={...retainedPayload};delete retainedOther.contacts;
 let company,guillaume,person;
 await test('five fictional profiles use real existing Auth sessions and verified local JWTs',async()=>{
  for(const [profile,account] of Object.entries(bench.accounts)){const user=ok(await request('/auth/v1/user',profile));assert.equal(user.id,account.id);assert.equal(user.email,account.email);assert.equal((await sql.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2',[account.sessionId,account.id])).rows[0].n,1);}
  assert.equal(ok(await rpc('crm_access_snapshot','owner',{})).fullAccess,true);assert.equal(ok(await rpc('crm_access_snapshot','contributor',{})).fullAccess,false);
 });
 await test('owner and limited contributor create companyName-only and Guillaume-only companies, with server confirmation and fresh-login reload',async()=>{
  for(const profile of ['owner','contributor'])for(const firstName of ['', 'Guillaume']){
   const row=await create(profile,{entityType:'company',companyName:'Société fictive '+profile+' '+randomUUID(),firstName,name:'',kind:'Client'});
   assert.equal(row.entityType,'company');assert.equal(row.name,'');assert.equal(row.firstName,firstName);assert.equal(row.createdBy,bench.accounts[profile].id);assert.equal(row.updatedBy,bench.accounts[profile].id);assert(row.createdAt&&row.updatedAt);
   const fresh=ok(await request('/auth/v1/token?grant_type=password',null,{email:bench.accounts[profile].email,password:bench.accounts[profile].password}));
   const reread=await read({token:fresh.access_token});same(reread.collections.contacts.find(x=>x.id===row.id),row);
   if(profile==='contributor'&&!firstName)company=row;if(profile==='contributor'&&firstName)guillaume=row;
  }
 });
 await test('person requires a last name even with a company; last name without first name is accepted',async()=>{
  person=await create('contributor',{entityType:'person',name:'Nom seul',firstName:'',companyName:'Rattachement conservé',kind:'Client'});assert.equal(person.name,'Nom seul');assert.equal(person.entityType,'person');
  await refuse('contributor',{entityType:'person',name:'',firstName:'Guillaume'},'contact_name_required');
  await refuse('owner',{entityType:'person',name:'',companyName:'Ne remplace pas un nom'},'contact_name_required');
 });
 await test('company requires companyName even when a named interlocutor exists',async()=>{
  for(const companyName of ['', '   '])await refuse('contributor',{entityType:'company',companyName,firstName:'Guillaume',name:'Nom interlocuteur'},'contact_company_name_required');
 });
 await test('PostgreSQL emptiness matches ECMAScript trim for every current whitespace code point; normal v/t/n/r/f are not whitespace',async()=>{
  const spaces=[9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279];
  for(const cp of spaces){const value=String.fromCodePoint(cp);assert.equal(value.trim(),'');assert.equal((await sql.query('select app_private.contact_identity_blank($1::jsonb) value',[JSON.stringify(value)])).rows[0].value,true);}
  for(const value of ['v','t','n','r','f','\\','\u200b','\u0085']){assert.notEqual(value.trim(),'');assert.equal((await sql.query('select app_private.contact_identity_blank($1::jsonb) value',[JSON.stringify(value)])).rows[0].value,false);}
  await refuse('contributor',{entityType:'person',name:'\t\n\u00a0\u202f\ufeff'},'contact_name_required');
  await refuse('owner',{entityType:'company',companyName:'\t\n\u00a0\u202f\ufeff'},'contact_company_name_required');
  const padded=await create('contributor',{entityType:'company',companyName:'  Nom réel fictif  ',name:''});assert.equal(padded.companyName,'  Nom réel fictif  ','Validation does not normalize stored identity');
 });
 await test('null, empty, unknown, padded or wrongly typed entityType is explicitly rejected without data/revision change',async()=>{
  for(const entityType of [null,'','Company','company ','unknown',0,true,{},[]])await refuse('contributor',{entityType,name:'Nom valable',companyName:'Société valable'},'contact_entity_type_invalid');
 });
 await test('partial phone patch retains typed identity and server creation metadata, with verified update author',async()=>{
  const before=guillaume;guillaume=await update('contributor',guillaume.id,{phone:'+330000005583'});assert.equal(guillaume.id,before.id);assert.equal(guillaume.entityType,'company');assert.equal(guillaume.companyName,before.companyName);assert.equal(guillaume.name,'');assert.equal(guillaume.firstName,'Guillaume');assert.equal(guillaume.createdAt,before.createdAt);assert.equal(guillaume.createdBy,before.createdBy);assert.equal(guillaume.updatedBy,bench.accounts.contributor.id);
  guillaume=await update('contributor',guillaume.id,{name:'Interlocuteur ajouté'});assert.equal(guillaume.id,before.id);assert.equal(guillaume.firstName,'Guillaume');
 });
 await test('explicit type changes validate final merged state and retain all unmentioned personal/company fields',async()=>{
  const before=await read();error(await mutate('contributor',company.id,{entityType:'person'},before.revision),'contact_name_required','22023');same(await read(),before);
  person=await update('contributor',person.id,{entityType:'company'});assert.equal(person.name,'Nom seul');assert.equal(person.companyName,'Rattachement conservé');
  person=await update('contributor',person.id,{entityType:'person'});assert.equal(person.name,'Nom seul');assert.equal(person.companyName,'Rattachement conservé');
 });
 await test('unqualified legacy records stay unqualified, including historically blank name on unrelated edits',async()=>{
  const legacy=await update('contributor','legacy-blank',{phone:'+330000000077'});assert(!Object.hasOwn(legacy,'entityType'));assert.equal(legacy.name,'');assert.equal(legacy.firstName,'Guillaume historique');
  const named=await update('contributor','legacy-person',{phone:'+330000000088'});assert(!Object.hasOwn(named,'entityType'));assert.equal(named.companyName,'Rattachement historique');
  await refuse('contributor',{firstName:'Prénom modifié'},'contact_name_required','22023','legacy-blank');
  await refuse('contributor',{name:''},'contact_name_required','22023','legacy-person');
  const oldClient=await create('contributor',{name:'Ancien client nommé',companyName:'Entreprise de rattachement'});assert(!Object.hasOwn(oldClient,'entityType'));
  await refuse('contributor',{companyName:'Ancien client sans nom'},'contact_name_required');
 });
 await test('qualified legacy edit keeps ID/history and unknown omitted values; homonyms remain distinct IDs',async()=>{
  const before=(await globalRead()).payload.contacts.find(x=>x.id==='legacy-person');const row=await update('contributor','legacy-person',{entityType:'person'});assert.equal(row.id,before.id);assert.equal(row.createdAt,before.createdAt);assert.equal(row.createdBy,before.createdBy);assert.equal(row.companyName,before.companyName);
  const contacts=(await read()).collections.contacts;assert.equal(contacts.filter(x=>x.name==='Martin'&&x.firstName==='Camille').length,2);
 });
 await test('authorized reference projection returns explicit type without new global access or private notes/bank data',async()=>{
  const refs=ok(await rpc('crm_reference_options','contributor',{p_module:'contacts'}));assert.equal(refs.contacts.find(x=>x.id===company.id).entityType,'company');
  const projection=await read();assert(!Object.hasOwn(projection.collections.contacts.find(x=>x.id==='historic-vendor'),'supplierBankAccounts'));assert(!Object.hasOwn(projection.collections.contacts.find(x=>x.id==='legacy-person'),'notes'));
  same(ok(await request('/rest/v1/crm_workspace_state?select=payload','contributor')),[]);
 });
 await test('only full owner can write existing private scalar notes; limited clients cannot write/read/export these fields',async()=>{
  const notes={notes:'Note privée propriétaire',preferences:'Préférences privées',importantNotes:'Important privé',supplierPriceNotes:'Prix privé',supplierCommissionNotes:'Commission privée'};
  await update('owner',company.id,notes);const stored=(await globalRead()).payload.contacts.find(x=>x.id===company.id);for(const [key,value] of Object.entries(notes))assert.equal(stored[key],value);
  const scoped=(await read()).collections.contacts.find(x=>x.id===company.id);const refs=ok(await rpc('crm_reference_options','contributor',{p_module:'contacts'})).contacts.find(x=>x.id===company.id);
  for(const key of Object.keys(notes)){assert(!Object.hasOwn(scoped,key));assert(!Object.hasOwn(refs,key));const before=await read();error(await mutate('contributor',company.id,{[key]:'Interdit'},before.revision),'field_forbidden_or_invalid:'+key,'22023');same(await read(),before);}
 });
 await test('read-only/no-rights profiles and retained JWT after grant revocation cannot write or broaden reads',async()=>{
  const revision=(await read()).revision;
  error(await mutate('reader','forbidden-reader',{entityType:'company',companyName:'Interdit'},revision),undefined,'42501');
  error(await mutate('none','forbidden-none',{entityType:'company',companyName:'Interdit'},revision),undefined,'42501');
  error(await rpc('crm_read_module','none',{p_module:'contacts'}),undefined,'42501');
  const old=await setContactLevel('revoked','none');
  try{error(await rpc('crm_read_module','revoked',{p_module:'contacts'}),undefined,'42501');error(await mutate('revoked','forbidden-revoked',{entityType:'company',companyName:'Interdit'},revision),undefined,'42501');}finally{await setContactLevel('revoked',old);}
 });
 await test('old owner global save omitting type preserves existing person/company and omitted identity fields; author is stamped server-side',async()=>{
  const before=await globalRead(),payload=structuredClone(before.payload);
  for(const row of payload.contacts)delete row.entityType;
  const row=payload.contacts.find(x=>x.id===company.id);delete row.name;delete row.companyName;delete row.firstName;delete row.civility;row.phone='+330000005584';
  const r=await globalSave(before,payload);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data[0].updated_by,bench.accounts.owner.id);
  const after=await globalRead();assert.notEqual(after.updated_at,before.updated_at);
  const saved=after.payload.contacts.find(x=>x.id===company.id);assert.equal(saved.entityType,'company');assert.equal(saved.name,'');assert.equal(saved.companyName,company.companyName);
  assert.equal(after.payload.contacts.find(x=>x.id===person.id).entityType,'person');
 });
 await test('old global normalizer dropping blank-name company is rejected as conflict, not silently reinserted/deleted',async()=>{
  const before=await globalRead();const payload={...before.payload,contacts:before.payload.contacts.filter(x=>x.id!==company.id)};
  error(await globalSave(before,payload),'contact_company_legacy_client_unsafe','40001');same(await globalRead(),before);
 });
 await test('existing owner global banking CAS keeps optional company identity and private notes without expanding limited banking rights',async()=>{
  const before=await globalRead(),payload=structuredClone(before.payload),row=payload.contacts.find(x=>x.id===guillaume.id);delete row.entityType;
  row.supplierBankAccounts=[{id:'company-local-bank',iban:'FR7600000000000000000000001',accountHolder:'Société fictive',status:'À vérifier',isPrimary:true}];
  const reply=await globalSave(before,payload);assert.equal(reply.status,200,JSON.stringify(reply.data));const saved=(await globalRead()).payload.contacts.find(x=>x.id===guillaume.id);assert.equal(saved.entityType,'company');assert.equal(saved.companyName,guillaume.companyName);assert.equal(saved.firstName,'Guillaume');same(saved.supplierBankAccounts,row.supplierBankAccounts);
  assert(!Object.hasOwn((await read()).collections.contacts.find(x=>x.id===guillaume.id),'supplierBankAccounts'));
  const revision=(await read()).revision;error(await mutate('contributor',guillaume.id,{supplierBankAccounts:[]},revision),'field_forbidden_or_invalid:supplierBankAccounts','22023');
 });
 await test('owner global final-state validation rejects invalid person/company/type and permits legacy nonidentity update',async()=>{
  for(const [patch,message] of [[{entityType:'company',companyName:''},'contact_company_name_required'],[{entityType:'person',name:''},'contact_name_required'],[{entityType:null},'contact_entity_type_invalid']]){
   const before=await globalRead(),payload=structuredClone(before.payload);Object.assign(payload.contacts.find(x=>x.id===company.id),patch);error(await globalSave(before,payload),message,'22023');same(await globalRead(),before);
  }
  const before=await globalRead(),payload=structuredClone(before.payload);payload.contacts.find(x=>x.id==='legacy-blank').city='Ville fictive';assert.equal((await globalSave(before,payload)).status,200);assert(!Object.hasOwn((await globalRead()).payload.contacts.find(x=>x.id==='legacy-blank'),'entityType'));
 });
 await test('stale/concurrent submissions and retry keep one stable record ID; creation metadata remains unchanged',async()=>{
  const before=await read(),id='retry-'+randomUUID(),patch={entityType:'company',companyName:'Double clic fictif',name:''};
  const replies=await Promise.all([mutate('contributor',id,patch,before.revision),mutate('contributor',id,patch,before.revision)]);assert.equal(replies.filter(x=>x.status===200).length,1);assert.equal(replies.filter(x=>x.data.code==='40001').length,1);createdIds.push(id);
  const created=(await read()).collections.contacts.find(x=>x.id===id);const retry=await update('contributor',id,patch);assert.equal(retry.createdAt,created.createdAt);assert.equal(retry.createdBy,created.createdBy);assert.equal((await read()).collections.contacts.filter(x=>x.id===id).length,1);
  error(await mutate('contributor',id,{phone:'Interdit conflit'},before.revision),'revision_conflict','40001');
 });
 await test('delayed consumption of an actual successful HTTP response keeps one send and is re-readable before consumption',async()=>{
  const before=await read(),id='pending-'+randomUUID();let sends=0;const pending=(async()=>{sends++;const response=await mutate('contributor',id,{entityType:'company',companyName:'Réponse réelle retenue',name:''},before.revision);await new Promise(r=>setTimeout(r,200));return response;})();
  const response=await pending;ok(response);assert.equal(sends,1);createdIds.push(id);assert.equal((await read()).collections.contacts.filter(x=>x.id===id).length,1);
 });
 await test('other collection name checks and closed legacy Tasks mutation API remain intact',async()=>{
  const props=ok(await rpc('crm_read_module','owner',{p_module:'properties'}));error(await rpc('crm_mutate_record','owner',{p_module:'properties',p_collection:'properties',p_id:'invalid-property',p_patch:{name:''},p_revision:props.revision,p_delete:false}),'name_required');
  error(await rpc('crm_mutate_record','owner',{p_module:'tasks',p_collection:'tasks',p_id:'legacy-tasks-attempt',p_patch:{title:'Interdit'},p_revision:null,p_delete:false}),'canonical_tasks_api_required','42501');
  assert.equal((await sql.query("select has_function_privilege('authenticated','app_private.tasks_previous_mutate_record(text,text,text,jsonb,text,boolean)','execute') allowed")).rows[0].allowed,false);
 });
 await test('intentional scoped company deletion passes unchanged permission/reference guards; bank history still blocks deletion',async()=>{
  const row=await create('contributor',{entityType:'company',companyName:'Suppression fictive autorisée',name:''});let before=await read();ok(await mutate('contributor',row.id,{},before.revision,true));assert(!(await read()).collections.contacts.some(x=>x.id===row.id));
  before=await read('owner');error(await mutate('owner','historic-vendor',{},before.revision,true),'bank_history_requires_archiving','42501');
 });
 await test('eight retained shares, document metadata, RIBs, other collections and historical labels remain exact',async()=>{
  same((await sql.query('select to_jsonb(s) value from public.crm_document_shares s order by provider,resource_id,user_id')).rows,retainedShares);
  same((await sql.query('select to_jsonb(s) value from public.crm_document_scopes s order by provider,resource_id')).rows,retainedScopes);
  const after=(await globalRead()).payload;const others={...after};delete others.contacts;same(others,retainedOther);
  same(after.contacts.find(x=>x.id==='historic-vendor'),retainedPayload.contacts.find(x=>x.id==='historic-vendor'));
  assert.equal(retainedShares.length,8);
 });
 const final=await read();const report={passed:true,tests:results,groups:results.length,actualGoTrueAuthJWTPostgREST:true,mockedSuccesses:0,localOrigin:bench.origin,createdRecordCount:createdIds.length,retainedShares:8,requestCount:requests.length,requests,finalProjectionHash:createHash('sha256').update(JSON.stringify(final)).digest('hex'),boundary:'Isolated loopback Supabase PG17/GoTrue/PostgREST, fictional users/contacts/shares. Local setup SQL seeds published app schema; all acceptance/refusal cases use real JWT HTTP RPC or owner PostgREST CAS. No Production data, accounts, writes or migration; no physical-device proof. Browser reload/UI focus/contrast are covered separately.'};
 writeFileSync(resolve('../evidence/server/real-auth-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,groups:results.length,requestCount:requests.length,actualAuth:true,retainedShares:8}));
}finally{await sql.end();}
