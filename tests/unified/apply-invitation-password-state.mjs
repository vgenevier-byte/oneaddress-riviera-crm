/** Update only the local invitation preparation function; preserve all fixtures. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {connect,sql,dir} from './local.mjs';

const source=readFileSync('supabase/migrations/20260918084849_unified_module_permissions.sql','utf8');
const start=source.indexOf('create function public.crm_invite_prepare(');
const end=source.indexOf('create function public.crm_invite_accept(',start);
assert.ok(start>0&&end>start);
const statement=source.slice(start,end).trim().replace(/^create function /,'create or replace function ');
assert.match(statement,/'needsPasswordSetup'/);
const read=async()=> (await sql.query("select pg_get_functiondef(p.oid) as definition,p.prosrc as body,p.proacl::text as grants from pg_proc p where p.oid='public.crm_invite_prepare(text,jsonb,text,uuid[])'::regprocedure")).rows[0];
const sha=value=>createHash('sha256').update(value).digest('hex');
await connect();
let transaction=false;
try{
 const before=await read();
 assert.match(before.body,/'existingUser'/);
 assert.ok(!before.body.includes("'needsPasswordSetup'"),'Stop: local function has already changed; inspect before any repeat');
 writeFileSync(dir+'/invitation-prepare-before.sql',before.definition,{flag:'wx',mode:0o600});
 await sql.query('begin');transaction=true;
 await sql.query(statement);
 const after=await read();
 assert.equal(after.grants,before.grants);
 assert.match(after.body,/'needsPasswordSetup',not exists/);
 assert.match(after.body,/coalesce\(u\.encrypted_password,''\)<>''/);
 await sql.query('commit');transaction=false;
 const report={scope:'verified disposable local database only',function:'public.crm_invite_prepare(text,jsonb,text,uuid[])',beforeSHA256:sha(before.definition),afterSHA256:sha(after.definition),executeGrantsPreserved:true,noFixtureRowsChanged:true};
 writeFileSync(dir+'/invitation-password-state-local-apply.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){if(transaction)await sql.query('rollback');throw error;}
finally{await sql.end();}
