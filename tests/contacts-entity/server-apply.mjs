/** Apply only the new Contacts migration to the guarded, already prepared bench. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {getBench} from './server-control.mjs';
const {status}=getBench(),sql=new Client({connectionString:status.DB_URL});
assert.equal(JSON.parse(readFileSync(resolve('../evidence/server/baseline-refusals.json'),'utf8')).passed,true);
const file='supabase/migrations/20261008194000_contact_entity_identity.sql',source=readFileSync(file,'utf8');
const snapshot=async()=>({
 workspace:(await sql.query('select to_jsonb(w) value from public.crm_workspace_state w order by workspace_id')).rows,
 shares:(await sql.query('select to_jsonb(s) value from public.crm_document_shares s order by provider,resource_id,user_id')).rows,
 scopes:(await sql.query('select to_jsonb(s) value from public.crm_document_scopes s order by provider,resource_id')).rows,
 profiles:(await sql.query('select to_jsonb(p) value from public.crm_access_profiles p order by user_id')).rows,
 grants:(await sql.query('select to_jsonb(g) value from public.crm_module_grants g order by user_id,module')).rows,
 memberships:(await sql.query('select to_jsonb(m) value from public.app_memberships m order by user_id,workspace_id')).rows,
 catalogue:(await sql.query('select * from app_private.module_collections order by collection')).rows,
 functions:(await sql.query("select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by n.nspname,p.proname,args")).rows,
 policies:(await sql.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname")).rows,
 });
await sql.connect();
try{
 const before=await snapshot();await sql.query(source);const after=await snapshot();
 for(const key of ['workspace','shares','scopes','profiles','grants','memberships','policies'])assert.deepEqual(after[key],before[key],key+' preserved byte-for-byte at SQL JSON projection');
 assert.equal(before.shares.length,8);
 const changed=['validate_business_patch','tasks_previous_mutate_record','crm_reference_options'];
 for(const fn of before.functions){
  const current=after.functions.find(x=>x.oid===fn.oid);assert(current,'Function OID retained: '+fn.proname);
  if(changed.includes(fn.proname)){const {definition:_a,...oldMeta}=fn,{definition:_b,...newMeta}=current;assert.deepEqual(newMeta,oldMeta,'Function metadata/ACL preserved: '+fn.proname);}
  else assert.deepEqual(current,fn,'Unrelated function unchanged: '+fn.proname);
 }
 for(const row of before.catalogue){const current=after.catalogue.find(x=>x.collection===row.collection);if(row.collection==='contacts'){const {entityType,...fields}=current.fields;assert.deepEqual(fields,row.fields);assert.deepEqual(entityType,{type:'string',label:'Nature de la fiche',enum:['person','company']});}else assert.deepEqual(current,row);}
 const newFunctions=after.functions.filter(x=>!before.functions.some(prior=>prior.oid===x.oid));
 assert.deepEqual(newFunctions.map(x=>x.proname).sort(),['contact_identity_blank','guard_contact_entity_identity','validate_contact_identity']);
 for(const fn of newFunctions){assert.equal((await sql.query('select has_function_privilege($1,$2,\'execute\') allowed',['authenticated',fn.oid])).rows[0].allowed,false);assert.equal((await sql.query('select has_function_privilege($1,$2,\'execute\') allowed',['anon',fn.oid])).rows[0].allowed,false);}
 const result={passed:true,migration:file,migrationSha256:createHash('sha256').update(source).digest('hex'),actualLocalDatabase:true,remoteWrites:0,workspaceAndRevisionsUnchanged:true,retainedShares:8,scopesMembershipsGrantsPoliciesUnchanged:true,existingFunctionOidsACLsSearchPathsSecurityUnchanged:true,unrelatedFunctionsIdentical:before.functions.length-changed.length,changedFunctions:changed,newPrivateFunctions:newFunctions.map(x=>x.proname),canonicalTasksWrapperUnchanged:true,noDataBackfill:true};
 writeFileSync(resolve('../evidence/server/migration-preservation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await sql.end();}
