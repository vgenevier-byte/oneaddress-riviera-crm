/** Compile the complete delivery migration from the pre-feature schema.
 * The entire rehearsal rolls back, retaining the other local fixture campaigns. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {connect,sql,output} from './local.mjs';
await connect();
const names=['fonciere_dossier','fonciere_dossier_fingerprint','track_fonciere_dossier_version','fonciere_arbitrage_status','fonciere_arbitrage_read','fonciere_arbitrage_vote','fonciere_arbitrage_list','fonciere_arbitrage_config_read','fonciere_arbitrage_config','fonciere_arbitrage_config_save','fonciere_bank_prepare','fonciere_bank_finish','fonciere_bank_fail'];
const tables=['fonciere_bank_presentations','fonciere_arbitrage_history','fonciere_arbitrage_opinions','fonciere_arbitrage_snapshots','fonciere_arbitrage_config_history','fonciere_arbitrage_config','fonciere_dossier_versions'];
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
let rolledBack=false;
try{
 await sql.query('begin');
 await sql.query('select pg_advisory_xact_lock(734991)');
 const functions=(await sql.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname=any($1)",[names])).rows;
 for(const {signature} of functions)await sql.query('drop function if exists '+signature+' cascade');
 for(const name of tables)await sql.query('drop table if exists app_private.'+identifier(name)+' cascade');
 const migration=readFileSync('supabase/migrations/20261027190606_fonciere_private_arbitrage.sql','utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
 await sql.query(migration);
 const audit=(await sql.query("select column_name,is_nullable,column_default from information_schema.columns where table_schema='app_private' and table_name='fonciere_arbitrage_config_history'")).rows;
 assert.equal(audit.find(c=>c.column_name==='actor_id').is_nullable,'YES');assert(audit.find(c=>c.column_name==='actor_source').column_default.includes('crm_account'));
 const constraints=(await sql.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='app_private.fonciere_arbitrage_config_history'::regclass")).rows.map(r=>r.definition).join(' ');assert(constraints.includes('actor_id IS NOT NULL'));assert(constraints.includes('deployment'));
 for(const name of tables){const privileges=(await sql.query("select has_table_privilege('authenticated',$1,'select') readable,has_table_privilege('anon',$1,'select') anonymous",['app_private.'+name])).rows[0];assert.equal(privileges.readable,false);assert.equal(privileges.anonymous,false);}
 const helpers=(await sql.query("select p.oid::regprocedure::text signature,has_function_privilege('authenticated',p.oid,'execute') callable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname=any($1)",[['fonciere_dossier','fonciere_dossier_fingerprint','track_fonciere_dossier_version','fonciere_arbitrage_status']])).rows;assert.equal(helpers.length,4);for(const helper of helpers)assert.equal(helper.callable,false,helper.signature);
 const wrappers=(await sql.query("select p.oid::regprocedure::text signature,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anonymous,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1)",[names])).rows;assert.equal(wrappers.length,8);for(const wrapper of wrappers){assert.equal(wrapper.prosecdef,false);assert.equal(wrapper.anonymous,false);assert.equal(wrapper.authenticated,true);}
 await sql.query('rollback');rolledBack=true;
 writeFileSync(join(output,'final-schema-results.json'),JSON.stringify({passed:true,fullMigrationCompiled:true,configAuditActorSource:true,privateTables:tables.length,guardedPublicWrappers:wrappers.length,uncallableInternalHelpers:helpers.length,rolledBack:true,services:'Real isolated PostgreSQL; no production writes'},null,2));
 console.log('PASS Full final migration compiles from pre-feature baseline; 7 private tables, 8 guarded public wrappers, 4 internal helpers and deployment audit constraints verified; entire rehearsal rolled back.');
}finally{if(!rolledBack)await sql.query('rollback');await sql.end();}
