/** Replay the final sensitive-rights migration over a real fake historical baseline. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {connect,sql,fixtureFile,directory,output,login,ok} from './local.mjs';
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8')),before=JSON.parse(readFileSync(join(directory,'fonciere-sensitive-before.private.json'),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),checks=[];
await connect();
try{
 const source=readFileSync(join('supabase/migrations',fixture.migrationFile),'utf8');assert(source.length>1000,'Final reviewed migration required');
 assert.equal((await sql.query("select to_regprocedure('public.fonciere_authorize_transfer(uuid,integer)') p")).rows[0].p,null,'Fresh historical baseline; apply migration exactly once');
 await sql.query(source);
 for(const [table,rows] of Object.entries(before)){
  const after=JSON.parse(JSON.stringify((await sql.query('select * from public.'+table+' order by 1,2')).rows));
  if(table==='crm_module_grants'){
   assert.deepEqual(after.filter(row=>row.module!=='fonciere'),rows.filter(row=>row.module!=='fonciere'),'All other module grants byte-exact');
   const stable=items=>items.filter(row=>row.module==='fonciere').map(({sensitive,updated_at,...rest})=>rest);
   assert.deepEqual(stable(after),stable(rows),'No module level or identity changes');
  }else if(table==='crm_access_invitations'){
   for(const row of rows){const next=after.find(item=>item.id===row.id),definition=Object.values(fixture.pendingInvitations).find(item=>item.id===row.id);assert(next&&definition);if(definition.state!=='pending')assert.deepEqual(next,row,'Historical '+definition.state+' invitation byte-exact');else{const {grants,...stable}=next,{grants:oldGrants,...oldStable}=row;assert.deepEqual(stable,oldStable,'Invitation identities/roles/assignments preserved');assert.equal(grants.fonciere.level,oldGrants.fonciere.level);assert.equal(grants.fonciere.sensitive.export,true);assert.equal(grants.fonciere.sensitive.delete,definition.level==='contribute');}}
  }else if(table==='crm_access_profiles'){
   const stable=items=>items.map(({revision,updated_at,...rest})=>rest);assert.deepEqual(stable(after),stable(rows));
  }else assert.equal(hash(after),hash(rows),table+' unchanged');
 }
 checks.push('Business payloads, immutable assets, presentation history, identities, roles, levels, assignments and all other module grants preserved');
 const effective={};
 for(const [name,user] of Object.entries(fixture.users)){
  const signed=await login(user),snapshot=await ok(signed.client.rpc('crm_access_snapshot'));
  await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);
  const after=(await sql.query("select app_private.module_allowed('fonciere') readable,app_private.can_fonciere_project($1,false) project_read,app_private.can_fonciere_project($1,true) project_write,app_private.can_fonciere_asset($2,false) metadata_read,app_private.can_project($3,false) presentation_read,app_private.task_target_export_allowed(jsonb_build_object('type','fonciere_project','id',$1)) task_export,app_private.full_access() full_access",[fixture.projects.assigned,fixture.assets.photo.object_path,fixture.presentations.historical])).rows[0];await sql.query('rollback');
  const {original_read,...old}=fixture.effectiveBefore[name];assert.deepEqual(after,old,'Historical effective permission retained: '+name);
  for(const kind of ['photo','pdf']){const download=await signed.client.storage.from('fonciere-documents').download(fixture.assets[kind].object_path);assert.equal(!download.error,original_read,name+' initial real original '+kind+' permission');}
  const def=fixture.definitions[name],enabled=Boolean(def.active!==false&&def.role&&def.level!=='none'),canArchive=Boolean(enabled&&def.level==='contribute'&&['admin','partner','contributor'].includes(def.role));
  assert.equal(Boolean(snapshot.modules.fonciere?.sensitive?.export),enabled,name+' initial download capability');
  assert.equal(Boolean(snapshot.modules.fonciere?.sensitive?.delete),canArchive,name+' initial archive capability');
  effective[name]={...after,original_read,sensitive:snapshot.modules.fonciere?.sensitive??null};
 }
 checks.push('Fourteen real Auth accounts preserve initial read/write/archive/download decisions, including read level and incompatible/missing/inactive roles');
 assert.equal(effective.admin.full_access,true);assert.equal(effective.both.task_export,false);assert.equal(effective.bothLegacyExport.task_export,true);
 checks.push('Historical OAR full administrator and the legacy task-reference export ceiling remain unchanged');
 const journals=(await sql.query("select schemaname,tablename from pg_tables where schemaname='app_private' and (tablename ilike '%sensitive%' or tablename ilike '%fonciere%permission%')")).rows;assert(journals.length);
 for(const row of journals){const r=(await sql.query("select has_table_privilege('anon',$1,'select') a,has_table_privilege('authenticated',$1,'select') b",[row.schemaname+'.'+row.tablename])).rows[0];assert.equal(r.a,false);assert.equal(r.b,false);}
 checks.push('Private recovery journals cannot be read by anonymous or authenticated API roles');
 checks.push('Pending reader/contributor/admin/inherited-role invitations retain planned capabilities; accepted/revoked/expired invitations remain byte-exact');
 writeFileSync(join(directory,'fonciere-sensitive-effective-after.private.json'),JSON.stringify(effective),{mode:0o600});
 writeFileSync(join(output,'migration-results.json'),JSON.stringify({passed:checks.length,checks,accountsCompared:14,sourceSha256:createHash('sha256').update(source).digest('hex'),privateBackupTaken:true,productionRequests:0},null,2));
 console.log(checks.map(name=>'PASS '+name).join('\n'));
}finally{await sql.end();}
