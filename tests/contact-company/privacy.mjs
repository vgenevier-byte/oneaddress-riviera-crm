/** Real local private-document ACL + Storage bytes; company linkage grants no share. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
assert.equal(process.env.CONTACT_COMPANY_ACK,'CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY');
const benchPath=process.env.CONTACT_COMPANY_BENCH||'/private/tmp/oar-relations-bench/bench.private.json';
assert(benchPath.startsWith('/private/tmp/'));
const bench=JSON.parse(readFileSync(benchPath)),status=JSON.parse(readFileSync(bench.statusFile));
assert.equal(new URL(status.API_URL).origin,'http://127.0.0.1:55931');assert.equal(new URL(status.DB_URL).port,'55932');
const app=process.env.CONTACT_COMPANY_APP;if(app){const url=new URL(app);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');}
const sql=new Client({connectionString:status.DB_URL});const owner=bench.accounts.owner,reader=bench.accounts.reader;
assert(owner.email.endsWith('@example.invalid')&&reader.email.endsWith('@example.invalid'));
const checks=[];const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const headers=(user,type='application/json')=>({apikey:status.ANON_KEY,Authorization:'Bearer '+user.token,'Content-Type':type});
async function rpc(user,name,args={}){const r=await fetch(status.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(user),body:JSON.stringify(args)});const text=await r.text();const data=text?JSON.parse(text):null;return {status:r.status,data};}
async function ok(user,name,args={}){const result=await rpc(user,name,args);assert.ok([200,204].includes(result.status),JSON.stringify(result));return result.data;}
async function save(contact,person=null,existing=null){const rev=(await ok(owner,'crm_read_module',{p_module:'contacts'})).revision;return ok(owner,'crm_save_contact_bundle',{p_contact:contact,p_person:person,p_existing_person_id:existing,p_revision:rev});}
const pdf=Buffer.from('%PDF-1.4\n% fictional Contacts privacy test\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
async function document(contact,title){const operation=randomUUID();const reserved=await ok(owner,'crm_contact_document_begin',{p_operation:operation,p_contact:contact,p_title:title,p_type:'Autre',p_filename:'fictitious-private.pdf',p_mime:'application/pdf',p_size:pdf.length,p_revision:null});assert.equal(reserved.lifecycle,'pending');
const upload=await fetch(status.API_URL+'/storage/v1/object/crm-documents/'+reserved.resource_id,{method:'POST',headers:{...headers(owner,'application/pdf'),'x-upsert':'false'},body:pdf});assert.equal(upload.status,200,await upload.text());const active=await ok(owner,'crm_contact_document_complete',{p_operation:operation});assert.equal(active.lifecycle,'active');return active;}
await sql.connect();
try{
 await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'documents','read','{}') on conflict(user_id,module) do update set level='read'",[reader.id]);
 const personId=randomUUID(),companyId=randomUUID();await save({id:personId,entityType:'person',firstName:'Camille',name:'Confidentialité '+personId.slice(0,6),kind:'Client'});
 const personal=await document(personId,'Document personnel fictif');
 assert.equal((await rpc(reader,'crm_contact_document_file',{p_resource:personal.resource_id})).status,403);checks.push('unshared genuine personal document denied before company link');
 await save({id:companyId,entityType:'company',companyName:'Agence confidentialité '+companyId.slice(0,6),kind:'Client'},null,personId);
 const general=await document(companyId,'Document entreprise fictif');await ok(owner,'crm_share_contact_document',{p_resource:general.resource_id,p_user:reader.id});
 assert.equal((await ok(reader,'crm_contact_document_file',{p_resource:general.resource_id})).resource_id,general.resource_id);checks.push('explicit company-document share is readable');
 const forbidden=await rpc(reader,'crm_contact_document_file',{p_resource:personal.resource_id});assert.equal(forbidden.status,403);assert(!JSON.stringify(forbidden.data).includes(personal.file_name));checks.push('company share plus person link does not grant personal document metadata');
 const personList=await ok(reader,'crm_contact_documents',{p_contact:personId});assert(!personList.documents.some(row=>row.resource_id===personal.resource_id));const companyList=await ok(reader,'crm_contact_documents',{p_contact:companyId});assert(companyList.documents.some(row=>row.resource_id===general.resource_id));assert(!companyList.documents.some(row=>row.resource_id===personal.resource_id));checks.push('authorized company and person document catalogues remain separate');
 const direct=await fetch(status.API_URL+'/storage/v1/object/authenticated/crm-documents/'+personal.resource_id,{headers:headers(reader)});assert.ok(direct.status>=400);checks.push('private Storage bytes remain unavailable directly');
 await ok(owner,'crm_contact_document_file',{p_resource:personal.resource_id});assert.equal((await sql.query("select record_id from public.crm_document_scopes where provider='storage' and resource_id=$1",[personal.resource_id])).rows[0].record_id,personId);checks.push('personal document keeps original person ownership');
 if(app){
  const target=resource=>app+'/api/contact-documents/file?resource='+encodeURIComponent(resource);
  const ownerBytes=await fetch(target(personal.resource_id),{headers:{Authorization:'Bearer '+owner.token}});assert.equal(ownerBytes.status,200);assert.equal(ownerBytes.headers.get('cache-control'),'private, no-store');assert.equal(hash(Buffer.from(await ownerBytes.arrayBuffer())),hash(pdf));
  const sharedBytes=await fetch(target(general.resource_id),{headers:{Authorization:'Bearer '+reader.token}});assert.equal(sharedBytes.status,200);assert.equal(hash(Buffer.from(await sharedBytes.arrayBuffer())),hash(pdf));
  const deniedBytes=await fetch(target(personal.resource_id),{headers:{Authorization:'Bearer '+reader.token}});assert.equal(deniedBytes.status,403);const deniedText=await deniedBytes.text();assert(!deniedText.includes('Document personnel fictif'));checks.push('actual Next proxy returns shared company bytes and refuses linked private person bytes');
 }
 const result={passed:true,actualLocalAuth:true,actualStorageUpload:true,actualPostgREST:true,actualNextProxy:Boolean(app),remoteWrites:0,checks};writeFileSync('/private/tmp/oar-relations-bench/privacy-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await sql.end();}
