/** Dedicated fictional Supabase only; never reads repository environment. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {Client} from 'pg';
import {assertVendorInformationLocalTarget} from './local-target.mjs';
export const statusFile=process.env.VENDOR_INFORMATION_STATUS_FILE;
assert.ok(statusFile,'VENDOR_INFORMATION_STATUS_FILE required');
export const directory=dirname(statusFile);
export const status=JSON.parse(readFileSync(statusFile,'utf8'));
assertVendorInformationLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3207',mail:'http://127.0.0.1:56234',acknowledgement:process.env.IZORD_TEST_ACK});
export const sql=new Client({connectionString:status.DB_URL});
export async function connect(){await sql.connect();assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count),0,'Fictional identities only');}
export async function request(path,token,body,method){const r=await fetch(status.API_URL+path,{method:method??(body===undefined?'GET':'POST'),redirect:'error',headers:{apikey:status.ANON_KEY,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data};}
export const rpc=(name,token,args={})=>request('/rest/v1/rpc/'+name,token,args);
export async function login(user){const r=await request('/auth/v1/token?grant_type=password',null,{email:user.email,password:user.password});assert.equal(r.status,200);assert.equal(r.data.user.id,user.id);return r.data.access_token;}
export const allow=r=>{assert.ok([200,204].includes(r.status),JSON.stringify(r));return r.data;};
export const deny=(r,message)=>{assert.ok(r.status>=400,JSON.stringify(r));if(message)assert.match(r.data.message,new RegExp(message));return r;};
export const read=token=>rpc('crm_read_module',token,{p_module:'vendorQuotes'}).then(allow);
export const payload=async()=>(await sql.query("select payload from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows[0].payload;
