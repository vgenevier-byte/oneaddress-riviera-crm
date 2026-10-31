/** Actual owned Auth/RPC, no business data changes; temporary fictional revocation restored. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {previewProvider} from './preview-retention-provider.mjs';
import {login,status,createFonciereRepository} from '../drive-primary/local.mjs';
const require=createRequire(import.meta.url),{Client}=require('pg');
const f=JSON.parse(readFileSync(process.env.COLLAPSE_FIXTURE,'utf8')),p=await previewProvider(f),admin=await login(f.users.admin),record=f.performance.records[0];
const asset=[...p.assets.values()].find(a=>a.project_id===record.id),checks=[];
const req=etag=>new Request('http://127.0.0.1:3199/api/fonciere/photo-preview?asset='+asset.id,{headers:{authorization:'Bearer '+admin.token,...(etag?{'if-none-match':etag}:{})}});
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const original=(await sql.query('select active from crm_access_profiles where user_id=$1',[admin.id])).rows[0].active;
try{
 let response=await p.handler(req());assert.equal(response.status,200);const etag=response.headers.get('etag'),bytes=Buffer.from(await response.arrayBuffer());assert(etag&&bytes.length);
 response=await p.handler(req(etag));assert.equal(response.status,304);assert.equal((await response.arrayBuffer()).byteLength,0);
 response=await p.handler(req('"previous-version"'));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);checks.push('Live admission accepts current ETag as 304; obsolete version ETag receives a checked 200 replacement');
 p.setHeadChanged(true);response=await p.handler(req(etag));assert.equal(response.status,304);p.setHeadChanged(false);checks.push('A replaced Google head does not substitute bytes for the pinned immutable revision');
 p.setChanged(true);response=await p.handler(req(etag));assert.notEqual(response.status,304);assert(!response.headers.get('content-type')?.includes('image'));p.setChanged(false);checks.push('Warm conditional preview refuses a moved or invalid provider identity');
 await assert.rejects(sql.query("update storage.objects set version='fictional-changed-version' where bucket_id='fonciere-documents' and name=$1",[asset.object_path]),e=>e.code==='42501'&&e.message==='fonciere_immutable_asset');checks.push('Real Storage rejects modification of a bound immutable original version');
 // Exercise actual repository cache against actual handler admission.
 const repo=createFonciereRepository(admin.client,{accessToken:admin.token}),loaded=await repo.loadProject(record.id,{media:'defer'}),fetch=globalThis.fetch;
 const calls=[];globalThis.fetch=async(input,init)=>String(input).includes('/api/fonciere/photo-preview')?(calls.push(new Headers(init?.headers).get('if-none-match')),p.handler(new Request('http://127.0.0.1:3199'+input,{...init}))):fetch(input,init);
 try{
  assert.equal((await repo.hydrateMedia(loaded)).status,'complete');calls.length=0;
  assert.equal((await repo.hydrateMedia(loaded)).status,'complete');assert(calls.every(Boolean));
  await sql.query('update crm_access_profiles set active=false where user_id=$1',[admin.id]);
  response=await p.handler(req(etag));assert.equal(response.status,403);assert(!response.headers.get('content-type')?.includes('image'));
  const denied=await repo.hydrateMedia(loaded);assert.equal(denied.status,'failed');assert.deepEqual(denied.previews,{});checks.push('Actual account revocation denies 304 and cached repository previews, with zero displayed stale photos');
  await sql.query('update crm_access_profiles set active=$2 where user_id=$1',[admin.id,original]);calls.length=0;
  assert.equal((await repo.hydrateMedia(loaded)).status,'complete');assert(calls.every(etag=>!etag));checks.push('Denied entries are removed; restored access requires fresh admitted bytes');
 }finally{globalThis.fetch=fetch;}
 const out=process.env.MEASURE_OUTPUT||'/private/tmp/preview-retention-evidence';mkdirSync(out,{recursive:true});writeFileSync(out+'/security.json',JSON.stringify({checks,productionRequests:0,realGoogleRequests:0,businessWrites:0},null,2));checks.forEach(c=>console.log('PASS '+c));
}finally{await sql.query('update crm_access_profiles set active=$2 where user_id=$1',[admin.id,original]);await sql.end();}
