/** Existing loopback bench only; no external services or Production credentials. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Client} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
const root='/private/tmp/oar-task-link-corrections';mkdirSync(root,{recursive:true});
const base=JSON.parse(readFileSync('/private/tmp/oar-task-links-bench/fixture.private.json','utf8'));
const status=JSON.parse(readFileSync(base.statusFile,'utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:55931');assert.equal(new URL(status.DB_URL).port,'55932');
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const results=[];const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const password=base.password;
async function login(user){const r=await fetch(status.API_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password})});assert.equal(r.status,200);return {...user,token:(await r.json()).access_token};}
const users={full:await login(base.users.full),restricted:await login(base.users.restricted)};
async function rpc(name,user,args){const r=await fetch(status.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+user.token,'Content-Type':'application/json'},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};}
try{
 await test('additive house search migration preserves workspace, canonical task rows and journal, and replays identically',async()=>{
  const snapshot=async()=>{const value={};for(const [table,order] of [['public.crm_workspace_state','workspace_id'],['app_private.task_records','id'],['app_private.task_links','id'],['app_private.task_events','id']])value[table]=hash((await sql.query('select to_jsonb(t) row from '+table+' t order by '+order)).rows);return value;};
  const before=await snapshot();const source=readFileSync('supabase/migrations/20261024153223_task_house_search_address.sql','utf8');await sql.query(source);await sql.query(source);assert.deepEqual(await snapshot(),before);
 });
 const prefix='house-fix-'+randomUUID().slice(0,8),houses=Array.from({length:230},(_,index)=>({id:prefix+'-'+String(index).padStart(3,'0'),name:index===229?'Villa Églantine distante '+prefix:`Maison catalogue ${String(index).padStart(3,'0')}`,address:index===229?'18 allée des Cèdres, Théoule-sur-Mer':`Adresse fictive ${index}`}));
 const address=houses.at(-1).address;houses.at(-1).addressDetails={houseNumber:'18',street:'allée des Cèdres',line1:'18 allée des Cèdres',complement:'',postalCode:'06590',city:'Théoule-sur-Mer',country:'France',countryCode:'FR',formattedAddress:address,source:'manual',precision:'manual',fingerprint:address.normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase()};
 await sql.query("update public.crm_workspace_state set payload=jsonb_set(payload,'{houseTrackingHouses}',coalesce(payload->'houseTrackingHouses','[]')||$1::jsonb) where workspace_id='oneaddress-riviera'",[JSON.stringify(houses)]);
 await sql.query("notify pgrst,'reload schema'");
 const last=houses.at(-1);
 await test('real authorized RPC pages include a house beyond page one with name/address/city and no restricted disclosure',async()=>{
  const items=[];for(let offset=0;;offset+=200){const r=await rpc('crm_task_targets_search',users.full,{p_type:'house',p_query:'',p_offset:offset,p_limit:200});assert.equal(r.status,200);items.push(...r.data.items);if(!r.data.hasMore)break;}
  assert(items.findIndex(item=>item.ref.id===last.id)>=200);const target=items.find(item=>item.ref.id===last.id);assert(target.searchFields.includes(last.address));assert(target.searchFields.includes(last.addressDetails.city));assert.match(target.detail,/Cèdres/);
  const hidden=await rpc('crm_task_targets_resolve',users.restricted,{p_refs:[{type:'house',id:last.id}]});assert.equal(hidden.status,200);assert.deepEqual(hidden.data,[{state:'inaccessible'}]);
 });
 const fixture={api:status.API_URL,publicKey:status.ANON_KEY,password,users,houses,last,worker:base.fixture.houseTrackingWorkers[0],houseSource:base.refs.find(ref=>ref.type==='worker_period'),statusFile:base.statusFile};
 writeFileSync(root+'/houses.fixture.private.json',JSON.stringify(fixture,null,2),{mode:0o600});writeFileSync(root+'/house-server-results.json',JSON.stringify({realAuth:true,realHTTPRPC:true,realPostgres:true,fictional:true,results},null,2));
}finally{await sql.end();}
