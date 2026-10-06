/** Actual local Auth/RPC and bytes; injection only coordinates a revocation
 * immediately after the actual byte read. No authentication result is mocked.
 * CONTACT_DOCUMENT_HANDLER_FILE points at the temporary CommonJS TS build. */
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync}=require('node:fs');
const pg=require('pg');
const {createContactDocumentFileHandler,readContactDocumentBytes}=require(process.env.CONTACT_DOCUMENT_HANDLER_FILE);
(async()=>{
 const status=JSON.parse(readFileSync('/private/tmp/oar-targeted-docs-local-status.json','utf8'));
 const fixture=JSON.parse(readFileSync('/private/tmp/oar-contact-evolution-fixture.private.json','utf8'));
 assert.equal(new URL(status.API_URL).origin,'http://127.0.0.1:55431');
 assert.equal(new URL(status.DB_URL).port,'55432');
 assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:55431';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=status.ANON_KEY;process.env.LOCAL_AUTH_INVITE_KEY=status.SERVICE_ROLE_KEY;
 const sql=new pg.Client({connectionString:status.DB_URL});await sql.connect();
 const doc=fixture.documents.find(d=>d.lifecycle==='active'&&d.created_by===fixture.users.depositor.id);assert.ok(doc);
 const call=(user,download=false)=>new Request('http://localhost/api/contact-documents/file?resource='+encodeURIComponent(doc.resource_id)+(download?'&download=1':''),{headers:user?{Authorization:'Bearer '+user.token}:{}});
 const rpc=async(name,args)=>{const r=await fetch('http://127.0.0.1:55431/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+fixture.users.owner.token,'Content-Type':'application/json'},body:JSON.stringify(args)});assert.ok([200,204].includes(r.status),await r.text());};
 try{
  let reads=0;
  const handler=createContactDocumentFileHandler({readBytes:async(...args)=>{reads++;return readContactDocumentBytes(...args);}});
  assert.equal((await handler(call(null))).status,401);assert.equal(reads,0);
  assert.equal((await handler(call(fixture.users.other))).status,403);assert.equal(reads,0);
  const owner=await handler(call(fixture.users.owner,true));assert.equal(owner.status,200);assert.equal(owner.headers.get('cache-control'),'private, no-store');assert.equal(owner.headers.get('location'),null);assert.match(owner.headers.get('content-disposition'),/^attachment;/);assert.match(await owner.text(),/FICTIONAL CONTACT IDENTITY/);
  await rpc('crm_share_contact_document',{p_resource:doc.resource_id,p_user:fixture.users.other.id});
  let bytesRead=false;
  const revoke=createContactDocumentFileHandler({readBytes:async(...args)=>{const bytes=await readContactDocumentBytes(...args);bytesRead=true;await rpc('crm_revoke_document_share',{p_provider:'storage',p_resource:doc.resource_id,p_user:fixture.users.other.id});return bytes;}});
  const revoked=await revoke(call(fixture.users.other));assert.equal(bytesRead,true);assert.equal(revoked.status,403);assert.ok(!(await revoked.text()).includes('FICTIONAL CONTACT IDENTITY'));
  writeFileSync('/private/tmp/oar-contact-evolution-file-handler-results.json',JSON.stringify({passed:true,actualLocalAuth:true,actualLocalStorageBytes:true,unauthorizedNoByteRead:true,revocationDuringActualBytesBlocksResponse:true},null,2),{mode:0o600});console.log('PASS actual local Auth and byte loading, revocation during response blocked');
 }finally{await sql.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
