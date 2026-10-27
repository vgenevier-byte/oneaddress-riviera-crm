/** Regression campaign for report SQL: isolated owned DB, no Google/Production calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createClient} from '@supabase/supabase-js';
assert.equal(process.env.IZORD_TEST_ACK,'IZORD_DISPOSABLE_LOCAL_ONLY');
const statusPath=process.env.FONCIERE_DRIVE_STATUS_FILE;assert(statusPath);
const status=JSON.parse(readFileSync(statusPath,'utf8'));
for(const url of [status.API_URL,status.DB_URL])assert.equal(new URL(url).hostname,'127.0.0.1');
assert.equal(new URL(status.API_URL).port,'56031');assert.equal(new URL(status.DB_URL).port,'56032');
const sql=new Client({connectionString:status.DB_URL});await sql.connect();
const service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const output=process.env.FONCIERE_DRIVE_OUTPUT||'/private/tmp/fonciere-drive-evidence';mkdirSync(output,{recursive:true});
const file='supabase/migrations/20261027172304_fonciere_drive_report_projection.sql',source=readFileSync(file,'utf8'),checks=[];
const report=async()=>{const result=await service.rpc('fonciere_drive_worker',{p_operation:'report'});assert.equal(result.error,null,result.error?.message);return result.data;};
try{
 assert.equal(Number((await sql.query("select count(*) from auth.users where email not like '%@example.invalid' or email is null")).rows[0].count),0,'Only owned fictional accounts');
 const fingerprint=async()=>{const parts={};for(const table of ['fonciere_projects','fonciere_assets','fonciere_project_assignments','crm_access_profiles','crm_module_grants','app_memberships','izord_projects','izord_project_versions','app_private.fonciere_drive_config','app_private.fonciere_drive_jobs','app_private.fonciere_drive_folders'])parts[table]=(await sql.query('select to_jsonb(t) r from '+table+' t order by to_jsonb(t)::text')).rows;return createHash('sha256').update(JSON.stringify(parts)).digest('hex');};
 const before=await fingerprint(),acl=(await sql.query("select proacl from pg_proc where oid='app_private.fonciere_drive_worker(text,jsonb)'::regprocedure")).rows[0].proacl;
 await sql.query(source);await sql.query(source);
 assert.deepEqual((await sql.query("select proacl from pg_proc where oid='app_private.fonciere_drive_worker(text,jsonb)'::regprocedure")).rows[0].proacl,acl);
 assert.equal(await fingerprint(),before);checks.push('Targeted followup replays safely without changing worker grants, business data, permissions, folders or queue rows');
 const populated=await report();assert.equal(populated.references,Number((await sql.query('select count(*) from fonciere_projects')).rows[0].count));assert.equal(populated.projects.length,populated.references);assert(populated.references>0);
 checks.push('Real service-role REST/RPC report returns every populated project reference and persisted queue/folder state');
 await sql.query('begin');try{
  await sql.query('truncate public.fonciere_projects cascade');
  const empty=(await sql.query("select app_private.fonciere_drive_worker('report') r")).rows[0].r;
  assert.equal(empty.references,0);assert.deepEqual(empty.projects,[]);assert.deepEqual(empty.jobs,[]);assert.deepEqual(empty.errors,[]);
 }finally{await sql.query('rollback');}
 assert.equal(await fingerprint(),before);assert.equal((await report()).references,populated.references);
 checks.push('Empty-project report returns zero and empty arrays; transaction rollback preserves every owned fixture row');
 writeFileSync(join(output,'report-results.json'),JSON.stringify({passed:checks.length,checks,migration:file,migrationSha256:createHash('sha256').update(source).digest('hex'),productionRequests:0,googleRequests:0},null,2));
 console.log(checks.map(check=>'PASS '+check).join('\n'));
}finally{await sql.end();}
