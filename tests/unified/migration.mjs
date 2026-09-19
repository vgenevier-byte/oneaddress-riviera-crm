import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connect,sql,status,dir} from './local.mjs';
const require=createRequire(import.meta.url),{Client}=require('/tmp/oar-contact-release-test-runtime/node_modules/pg');
await connect();const name='unified_replay_'+Date.now();assert.match(name,/^unified_replay_\d+$/);await sql.query('create database '+name);
const url=new URL(status.DB_URL);url.pathname='/'+name;const db=new Client({connectionString:url.href});await db.connect();
try{
 await db.query(readFileSync('tests/izord/sql-fixture.sql','utf8'));
 for(const p of ['20260914210807_drive_folder_registry.sql','20260916170445_module_access_foundation.sql','20260917172412_izord_generator_versions.sql'])await db.query(readFileSync('supabase/migrations/'+p,'utf8'));
 const id='12345678-1234-4234-8234-123456789012';await db.query("insert into auth.users values($1,'replay@example.invalid',now());",[id]);await db.query("insert into app_memberships(user_id,workspace_id,role) values($1,'oar','member'),($1,'izord','admin')",[id]);const payload={contacts:[{id:'fictif',name:'Conservé'}],tasks:[{id:'task',title:'Conservée'}],vendorInvoices:[{id:'recurring-one',amount:100},{id:'recurring-two',amount:100}]};await db.query("update crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'",[payload]);
 const before=(await db.query('select * from app_memberships order by workspace_id')).rows;
 const source=readFileSync('supabase/migrations/20260918084849_unified_module_permissions.sql','utf8');await db.query(source);
 assert.deepEqual((await db.query('select payload from crm_workspace_state')).rows[0].payload,payload);assert.deepEqual((await db.query('select * from app_memberships order by workspace_id')).rows,before);
 assert.equal((await db.query('select count(*)::int n from crm_access_profiles where general_admin')).rows[0].n,0);
 await db.query('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);assert.equal((await db.query('select * from crm_workspace_state')).rowCount,0);await db.query('reset role');
 const exposed=await db.query("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and (p.proname like 'crm_%' or n.nspname='app_private') and has_function_privilege('anon',p.oid,'execute')");assert.deepEqual(exposed.rows,[]);
 const result={exactMigrationReplay:true,transactionSucceeded:true,payloadEqual:true,membershipsUnchanged:true,noImplicitGeneralAdmin:true,legacyRawAccessClosed:true,noAnonymousSecurityDefiner:true,sha256:createHash('sha256').update(source).digest('hex')};writeFileSync(dir+'/migration-replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await db.end();await sql.query('drop database '+name);await sql.end();}
