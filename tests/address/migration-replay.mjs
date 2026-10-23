/** Replay the exact delivered migration against a second disposable local database.
 * Auth/Storage schema facsimiles only; actual Auth/RPC proof is persistence.mjs. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
const status=JSON.parse(readFileSync(process.env.ADDRESS_LOCAL_STATUS,'utf8'));
const target=new URL(status.DB_URL);assert.equal(process.env.ADDRESS_LOCAL_ACK,'fictitious-address-local-only');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55932');assert.equal(target.pathname,'/postgres');
const name='address_exact_'+randomUUID().replaceAll('-',''),admin=new Client({connectionString:target.href});
await admin.connect();await admin.query('create database '+name);target.pathname='/'+name;
const sql=new Client({connectionString:target.href});await sql.connect();
const migration='20261023105820_address_autocomplete_metadata.sql',source=readFileSync('supabase/migrations/'+migration,'utf8');
try{
 await sql.query(readFileSync('tests/izord/sql-fixture.sql','utf8'));
 await sql.query("alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz,add column raw_user_meta_data jsonb default '{}',add column raw_app_meta_data jsonb default '{}';create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;alter table storage.objects add column updated_at timestamptz default clock_timestamp(),add column owner uuid,add column owner_id text,add column created_at timestamptz default clock_timestamp();");
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x<migration).sort())await sql.query(readFileSync('supabase/migrations/'+file,'utf8'));
 const snapshot=async()=>({workspace:(await sql.query('select to_jsonb(t) row from crm_workspace_state t')).rows,policies:(await sql.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,grants:(await sql.query('select to_jsonb(t) row from crm_module_grants t')).rows,memberships:(await sql.query('select to_jsonb(t) row from app_memberships t')).rows});
 const before=await snapshot();await sql.query(source);assert.deepEqual(await snapshot(),before);
 assert.equal((await sql.query("select to_regprocedure('app_private.guard_project_address_metadata()') is not null okay")).rows[0].okay,true);
 const funcs=(await sql.query("select proname from pg_proc where pronamespace='app_private'::regnamespace and proname like '%address%' and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))")).rows;assert.deepEqual(funcs,[]);
 const directory=process.env.ADDRESS_ARTIFACTS||'/private/tmp/oar-address-evidence';mkdirSync(directory,{recursive:true});const report={passed:true,exactFinalMigrationReplay:true,migrationSha256:createHash('sha256').update(source).digest('hex'),secondDisposableDatabase:true,workspaceMembershipsGrantsPoliciesPreserved:true,noExposedPrivateAddressFunctions:true,boundary:'PostgreSQL semantics with Auth/Storage schema facsimiles. Actual Auth/RPC proof is separate.'};writeFileSync(directory+'/migration-final-replay.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await sql.end();await admin.query('drop database '+name+' with (force)');await admin.end();}
