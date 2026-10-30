/** Transactional replay in the guarded fictional local stack; always rolled back. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {connect,sql,output} from '../fonciere-arbitrage/local.mjs';
await connect();
const digest=async()=>(await sql.query("select md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by id) from fonciere_projects p),'')) projects,md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by id) from izord_projects p),'')) presentations,md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by project_id,slot) from app_private.fonciere_arbitrage_opinions p),'')) opinions,md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by id) from app_private.fonciere_drive_jobs p),'')) jobs,md5(coalesce((select string_agg(to_jsonb(p)::text,'' order by schemaname,tablename,policyname) from pg_policies p),'')) policies")).rows[0];
try {
 const before=await digest();await sql.query('begin');
 const retain=(await sql.query("select pg_get_functiondef('app_private.retain_fonciere_internal_answers()'::regprocedure) def")).rows[0].def;
 await sql.query("drop function app_private.validate_fonciere_payload(uuid,jsonb); alter function app_private.validate_fonciere_payload_before_rentals(uuid,jsonb) rename to validate_fonciere_payload; drop function app_private.validate_fonciere_rentals(jsonb); drop function app_private.fonciere_annual_day(text); drop function app_private.fonciere_rental_schema();");
 await sql.query(retain.replace(",'rentalPlan'",''));
 await sql.query(readFileSync('supabase/migrations/20261030193537_fonciere_rental_scenarios.sql','utf8'));
 assert.deepEqual(await digest(),before);
 for(const role of ['anon','authenticated'])for(const signature of ['app_private.validate_fonciere_payload(uuid,jsonb)','app_private.validate_fonciere_payload_before_rentals(uuid,jsonb)','app_private.validate_fonciere_rentals(jsonb)','app_private.fonciere_annual_day(text)','app_private.fonciere_rental_schema()'])assert.equal((await sql.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,false);
 await sql.query('rollback');assert.deepEqual(await digest(),before);
 writeFileSync(join(output,'migration-replay.json'),JSON.stringify({transactionalReplay:true,rolledBack:true,projectsPresentationsOpinionsJobsPoliciesUnchanged:true,noPublicPrivateFunctionGrants:true,productionWrites:0},null,2));console.log('PASS Transactional exact migration replay: projects, presentations, opinions, jobs and policies unchanged; private grants retained');
}finally{await sql.query('rollback');await sql.end();}
