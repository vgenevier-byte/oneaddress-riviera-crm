/** Rehearse the complete final migration in a rolled-back local transaction. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {connect,sql,output,fixtureFile} from '../fonciere-arbitrage/local.mjs';
await connect();
const digest=async()=> (await sql.query("select md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by id) from public.fonciere_projects p),'')) projects,md5(coalesce((select string_agg(to_jsonb(o)::text,'' order by project_id,slot) from app_private.fonciere_arbitrage_opinions o),'')) opinions,md5(coalesce((select string_agg(to_jsonb(h)::text,'' order by id) from app_private.fonciere_arbitrage_history h),'')) history,md5(coalesce((select string_agg(to_jsonb(j)::text,'' order by id) from app_private.fonciere_drive_jobs j),'')) jobs,md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by schemaname,tablename,policyname) from pg_policies p),'')) policies")).rows[0];
try {await sql.query('begin');const before=await digest();
 await sql.query('drop trigger fonciere_retain_internal_answers on public.fonciere_projects; drop function app_private.retain_fonciere_internal_answers(); drop function app_private.validate_fonciere_payload(uuid,jsonb); alter function app_private.validate_fonciere_payload_before_internal_tracking(uuid,jsonb) rename to validate_fonciere_payload;');
 await sql.query(readFileSync('supabase/migrations/20261030180620_fonciere_compact_internal_tracking.sql','utf8'));assert.deepEqual(await digest(),before);
 for(const fn of ['app_private.validate_fonciere_payload(uuid,jsonb)','app_private.validate_fonciere_payload_before_internal_tracking(uuid,jsonb)','app_private.retain_fonciere_internal_answers()'])for(const role of ['anon','authenticated'])assert.equal((await sql.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).rows[0].allowed,false);
 const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));await sql.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[fixture.users.admin.id,JSON.stringify({sub:fixture.users.admin.id,role:'authenticated'})]);
 await sql.query('select app_private.validate_fonciere_payload(id,payload) from public.fonciere_projects');
 await sql.query('rollback');writeFileSync(join(output,'compact-migration-results.json'),JSON.stringify({completeMigration:true,projectsOpinionsHistoryJobsPoliciesUnchanged:true,privateFunctionsNotCallable:true,allExistingPayloadsAccepted:true,rolledBack:true},null,2));console.log('PASS Complete final migration: payloads accepted; rows, approvals, jobs and policies unchanged; no public execute grants.');
} finally {await sql.query('rollback');await sql.end();}
