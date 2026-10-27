/** Real owned loopback Auth/RPC/Storage only. Repository env is never loaded. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
const require=createRequire(import.meta.url);require('../i18n/register-typescript.cjs');
export const {createFonciereData,toPresentationData}=require('../../lib/fonciere/model');
export const {createFonciereRepository}=require('../../lib/fonciere/repository');
export const {createProjectData}=require('../../lib/izord/model');
export const {createGeneratorRepository}=require('../../lib/izord/repository');
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
assert(process.env.FONCIERE_SENSITIVE_STATUS_FILE,'Owned status file required');
export const directory=dirname(process.env.FONCIERE_SENSITIVE_STATUS_FILE);
export const status=JSON.parse(readFileSync(process.env.FONCIERE_SENSITIVE_STATUS_FILE,'utf8'));
for(const value of [status.API_URL,status.DB_URL])assert.equal(new URL(value).hostname,'127.0.0.1');
assert.equal(new URL(status.API_URL).port,'56031');assert.equal(new URL(status.DB_URL).port,'56032');
export const output=process.env.FONCIERE_SENSITIVE_OUTPUT||'/private/tmp/fonciere-sensitive-evidence';mkdirSync(output,{recursive:true});
export const fixtureFile=join(directory,'fonciere-sensitive-fixture.private.json');
export const sql=new Client({connectionString:status.DB_URL});
export const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
export const anonymous=createClient(status.API_URL,status.ANON_KEY,options);
export async function connect(){await sql.connect();assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count),0);}
export async function request(path,token,body,method){
 const response=await fetch(status.API_URL+path,{redirect:'error',method:method??(body===undefined?'GET':'POST'),headers:{apikey:status.ANON_KEY,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
}
export const rpc=(name,token,args={})=>request('/rest/v1/rpc/'+name,token,args);
export async function login(user){const result=await request('/auth/v1/token?grant_type=password',null,{email:user.email,password:user.password});assert.equal(result.status,200,'Real local password Auth');const client=createClient(status.API_URL,status.ANON_KEY,options);await ok(client.auth.setSession({access_token:result.data.access_token,refresh_token:result.data.refresh_token}));return {...user,client,token:result.data.access_token};}
export async function ok(promise){const result=await promise;assert.equal(result.error,null,result.error?.message);return result.data;}
export async function denied(promise){const result=await promise;assert(result.error||Array.isArray(result.data)&&result.data.length===0,'Server must deny unauthorized operation');return result;}
export const fullModules=['dashboard','contacts','leads','tasks','quotes','bookings','vendorQuotes','vendorInvoices','houseTracking','documents','planning','properties','vehicles','boats'];
export const fullGrants=Object.fromEntries(fullModules.map(module=>[module,{level:'contribute',sensitive:{delete:true,export:true,...(module==='contacts'?{bank_read:true,bank_write:true}:{}),...(module==='vendorInvoices'?{payment:true}:{})}}]));
