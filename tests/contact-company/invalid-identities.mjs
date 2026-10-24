/** Exact installed guard, raw INSERT/UPDATE semantics, isolated temporary rows. */
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {Client} from 'pg';
assert.equal(process.env.CONTACT_COMPANY_ACK,'CONTACT_COMPANY_DISPOSABLE_LOCAL_ONLY');
const status=JSON.parse(readFileSync('/private/tmp/oar-relations-bench/status.private.json'));assert.equal(new URL(status.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(status.DB_URL).port,'55932');
const migration='supabase/migrations/20261024081258_contact_company_relations.sql',source=readFileSync(migration,'utf8'),sql=new Client({connectionString:status.DB_URL}),checks=[];
await sql.connect();try{
 const before=(await sql.query("select to_jsonb(w) row from public.crm_workspace_state w where workspace_id='oneaddress-riviera'")).rows[0].row;
 await sql.query('begin');
 const start=source.indexOf('function app_private.guard_contact_company_relations('),from=source.lastIndexOf('create ',start),end=source.indexOf('$$;',start)+3,definition=source.slice(from,end).replace(/^create function/,'create or replace function');
 // Optional guarded installation changes only one function, never the workspace.
 if(process.env.CONTACT_COMPANY_INSTALL_GUARD==='1')await sql.query(definition);
 const installed=(await sql.query("select prosrc,pg_get_functiondef('app_private.guard_contact_company_relations()'::regprocedure) definition from pg_proc where oid='app_private.guard_contact_company_relations()'::regprocedure")).rows[0];const bodyStart=definition.indexOf('as $$')+5;assert.equal(installed.prosrc,definition.slice(bodyStart,definition.lastIndexOf('$$;')));
 await sql.query('create temporary table contact_link_guard_fixture(workspace_id text,payload jsonb) on commit drop');
 await sql.query('create trigger exact_guard before insert or update on contact_link_guard_fixture for each row execute function app_private.guard_contact_company_relations()');
 await sql.query("insert into contact_link_guard_fixture values('oneaddress-riviera','{\"contacts\":[]}')");
 const company={id:'valid-company',entityType:'company',companyName:'Agence fictive'},person={id:'valid-person',entityType:'person',name:'Durand',companyId:'valid-company'};
 async function refused(label,contacts,expected){await sql.query('savepoint refusal');let error;try{await sql.query('update contact_link_guard_fixture set payload=$1',[{contacts}]);}catch(e){error=e;}await sql.query('rollback to savepoint refusal');await sql.query('release savepoint refusal');assert(error,label+' must fail');assert.equal(error.message,expected);assert.deepEqual((await sql.query('select payload from contact_link_guard_fixture')).rows[0].payload,{contacts:[]});checks.push(label);}
 for(const [label,value] of [['missing',undefined],['empty',''],['numeric',42],['invalid characters','bad/id'],['too long','p'.repeat(101)]]){const input={...person};if(value===undefined)delete input.id;else input.id=value;await refused('linked typed person with '+label+' ID rejected',[company,input],'contact_company_link_requires_person');}
 for(const [label,value]of [['missing',undefined],['empty',''],['numeric',42],['invalid characters','bad/id']]){const input={...company};if(value===undefined)delete input.id;else input.id=value;await refused('new company with '+label+' ID rejected',[input,{...person,companyId:'valid-company'}],'contact_company_identity_invalid');}
 await sql.query('update contact_link_guard_fixture set payload=$1',[{contacts:[company,person]}]);assert.equal((await sql.query("select jsonb_array_length(payload->'contacts') n from contact_link_guard_fixture")).rows[0].n,2);checks.push('valid stable company and genuine person IDs accepted');
 await sql.query('commit');
 assert.deepEqual((await sql.query("select to_jsonb(w) row from public.crm_workspace_state w where workspace_id='oneaddress-riviera'")).rows[0].row,before);checks.push('real workspace payload author and revision unchanged');
 const output={passed:true,actualLocalPostgres:true,exactInstalledTrigger:true,isolatedTemporaryRows:true,workspacePayloadAndRevisionUnchanged:true,remoteWrites:0,migrationSHA256:createHash('sha256').update(source).digest('hex'),guardDefinitionSHA256:createHash('sha256').update(installed.definition).digest('hex'),checks};writeFileSync('/private/tmp/oar-relations-bench/invalid-identity-results.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{await sql.query('rollback');await sql.end();}
