/** Exercises the actual Next private proxy with real local JWTs and Storage bytes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {assertLocalTarget} from '../izord/local-target.mjs';
const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
const fixture=JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_FIXTURE||'/private/tmp/oar-contact-evolution-fixture.private.json','utf8'));
const manifest=JSON.parse(readFileSync(process.env.CONTACT_EVOLUTION_MANIFEST,'utf8'));
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
assert.equal(manifest.app,'http://127.0.0.1:3190');assert.equal(manifest.status,'ready');
const api=new URL(status.API_URL).origin;
const headers=user=>({apikey:status.ANON_KEY,Authorization:'Bearer '+user.token,'Content-Type':'application/json'});
async function rpc(user,name,args){const response=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(user),body:JSON.stringify(args)});assert.ok(response.ok);const text=await response.text();return text?JSON.parse(text):null;}
const documents=(await rpc(fixture.users.depositor,'crm_contact_documents',{p_contact:fixture.contacts.demo.id})).documents;
const document=documents.find(d=>d.personal_contact&&d.lifecycle==='active');assert.ok(document);
const endpoint=manifest.app+'/api/contact-documents/file?resource='+encodeURIComponent(document.resource_id);
// A previous interrupted run may have confirmed the share before its response
// was read. Reset only this dedicated fictional grant before the denial check.
await rpc(fixture.users.owner,'crm_revoke_document_share',{p_provider:'storage',p_resource:document.resource_id,p_user:fixture.users.other.id});
const results=[];async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await test('Owner and enabled depositor proxy read actual private Storage bytes with no-store and no signed/public URL',async()=>{
 const expectedResponse=await fetch(api+'/storage/v1/object/authenticated/crm-documents/'+document.resource_id,{headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+status.SERVICE_ROLE_KEY}});
 assert.ok(expectedResponse.ok);const expected=Buffer.from(await expectedResponse.arrayBuffer());
 for(const user of [fixture.users.owner,fixture.users.depositor]){
  const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+user.token}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-type'),document.mime_type);assert.match(response.headers.get('content-disposition'),/^inline;/);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(expected));
  const download=await fetch(endpoint+'&download=1',{headers:{Authorization:'Bearer '+user.token}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(expected));
 }
});
await test('Anonymous, forged-session, unshared collaborator and malformed targets disclose no metadata or bytes',async()=>{
 for(const authorization of [undefined,'Bearer invalid-local-session','Bearer '+fixture.users.other.token]){
  const response=await fetch(endpoint,{headers:authorization?{Authorization:authorization}:{}});assert.ok(response.status>=400);const body=await response.text();assert.ok(!body.includes(document.file_name));assert.ok(!body.includes(document.title));assert.ok(!body.includes(document.resource_id));
 }
 for(const resource of ['../documents/secret','contact-private/not-a-uuid','https://example.invalid/private']){const response=await fetch(manifest.app+'/api/contact-documents/file?resource='+encodeURIComponent(resource),{headers:{Authorization:'Bearer '+fixture.users.owner.token}});assert.equal(response.status,400);}
});
await test('Permission Export is separate from preview and applies on the real proxy after explicit share and revocation',async()=>{
 const sql=new Client({connectionString:status.DB_URL});await sql.connect();
 const oldGrant=(await sql.query("select sensitive from crm_module_grants where user_id=$1 and module='contacts'",[fixture.users.other.id])).rows[0].sensitive;
 await sql.query("update crm_module_grants set sensitive=sensitive-'export' where user_id=$1 and module='contacts'",[fixture.users.other.id]);
 await rpc(fixture.users.owner,'crm_share_contact_document',{p_resource:document.resource_id,p_user:fixture.users.other.id});
 try{
  const view=await fetch(endpoint,{headers:{Authorization:'Bearer '+fixture.users.other.token}});assert.equal(view.status,200);await view.arrayBuffer();
  const download=await fetch(endpoint+'&download=1',{headers:{Authorization:'Bearer '+fixture.users.other.token}});assert.equal(download.status,403);await download.text();
 }finally{await rpc(fixture.users.owner,'crm_revoke_document_share',{p_provider:'storage',p_resource:document.resource_id,p_user:fixture.users.other.id});await sql.query("update crm_module_grants set sensitive=$2 where user_id=$1 and module='contacts'",[fixture.users.other.id,oldGrant]);await sql.end();}
 const after=await fetch(endpoint,{headers:{Authorization:'Bearer '+fixture.users.other.token}});assert.equal(after.status,403);await after.text();
});
writeFileSync(join(process.env.CONTACT_EVOLUTION_OUTPUT||'docs/contact-evolution','api-results.json'),JSON.stringify({passed:true,actualNextProxy:true,actualLocalJWT:true,actualStorageBytes:true,results},null,2));
