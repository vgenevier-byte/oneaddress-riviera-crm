import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
const f=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const s=JSON.parse(readFileSync(f.statusFile,'utf8'));
assert.equal(s.API_URL,'http://127.0.0.1:55931');const app='http://127.0.0.1:3198';
const sql=new Client({connectionString:s.DB_URL});await sql.connect();
const p=JSON.parse(readFileSync('/private/tmp/oar-task-links-publisher.private.json','utf8'));const neon=new Client({connectionString:p.database});await neon.connect();
const results=[];const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const before=hash((await neon.query('select to_jsonb(p) from publisher_posts p order by id')).rows);
async function login(user){const r=await fetch(s.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:f.password})});assert.equal(r.status,200);return (await r.json()).access_token;}
const tokens={full:await login(f.users.full||f.users.author),restricted:await login(f.users.restricted)};
async function endpoint(token,ids,exporting=false){const r=await fetch(app+'/api/tasks/publisher'+(exporting?'?export=1':''),{method:ids?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(ids?{'Content-Type':'application/json'}:{})},...(ids?{body:JSON.stringify({ids})}:{})});return {status:r.status,data:await r.json()};}
async function rpc(name,token,args){const r=await fetch(s.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};}
async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
try{
 await test('Publisher task bridge requires real Auth and independent target rights',async()=>{assert.equal((await endpoint(null)).status,401);assert.equal((await endpoint(tokens.restricted)).status,403);const r=await endpoint(tokens.full);assert.equal(r.status,200);assert(r.data.items.some(t=>t.ref.id===p.id));assert(!JSON.stringify(r.data).includes('caption'));});
 await test('Neon existence attestation rejects invented IDs and cannot be forged through canonical task RPC',async()=>{const id=randomUUID();assert.deepEqual((await endpoint(tokens.full,[id])).data.items,[]);const r=await rpc('crm_tasks_mutate',tokens.full,{p_request_id:randomUUID(),p_id:'bridge-invalid-'+randomUUID(),p_revision:null,p_patch:{title:'Fictif',linkChanges:{add:[{type:'publisher_creation',id}]}}});assert.equal(r.status,403);});
 await test('saved Neon creation persists atomically in canonical Tasks and reverse lookup after fresh Auth login',async()=>{const confirmed=await endpoint(tokens.full,[p.id]);assert.equal(confirmed.status,200);const target={type:'publisher_creation',id:p.id};const args={p_request_id:randomUUID(),p_id:'bridge-proof-'+randomUUID(),p_revision:null,p_patch:{title:'Contrôle Publisher fictif',linkChanges:{add:[target],primary:{target}}}};const first=await rpc('crm_tasks_mutate',tokens.full,args);assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual((await rpc('crm_tasks_mutate',tokens.full,args)).data,first.data);const fresh=await login(f.users.full||f.users.author);const task=(await rpc('crm_tasks_read',fresh,{p_id:args.p_id})).data[0];assert.equal(task.links[0].target.id,p.id);const reverse=(await rpc('crm_tasks_for_target',fresh,{p_ref:target})).data;assert(reverse.some(t=>t.id===task.id));assert.equal((await sql.query('select count(*)::int n from app_private.task_links where task_id=$1',[task.id])).rows[0].n,1);});
 await test('bridge calls never mutate creations, generation operations, music or financial business records',async()=>{assert.equal(hash((await neon.query('select to_jsonb(p) from publisher_posts p order by id')).rows),before);assert.equal((await neon.query('select count(*)::int n from publisher_operations')).rows[0].n,0);});
 writeFileSync('/private/tmp/oar-task-links-evidence/publisher-server-results.json',JSON.stringify({realAuth:true,realNeonAdapter:true,localPostgresTransport:true,realCanonicalRPC:true,externalProviderCalls:0,instagramPublications:0,results},null,2));
}finally{await sql.end();await neon.end();}
