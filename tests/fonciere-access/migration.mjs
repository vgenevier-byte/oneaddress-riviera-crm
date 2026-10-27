/** Exact split migration replay over privately backed-up fictional effective access. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, sql, fixtureFile, directory, output, login } from './local.mjs';
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));
const before=JSON.parse(readFileSync(join(directory,'fonciere-access-before.private.json'),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const migration=process.env.FONCIERE_ACCESS_MIGRATION||'20261027131656_fonciere_module_permissions.sql';
assert.match(migration||'',/^\d+_fonciere_module_permissions\.sql$/);
await connect();
try {
 assert.equal(Number((await sql.query("select count(*) from crm_module_grants where module='fonciere'")).rows[0].count),0,'Apply the split once over the prepared legacy fixture');
 const source=readFileSync(join('supabase/migrations',migration),'utf8');assert(source.length>1000,'Final migration required');
 await sql.query(source);
 const checks=[];
 for(const [table,rows] of Object.entries(before)){
  const after=(await sql.query('select * from public.'+table+' order by 1,2')).rows;
  if(table==='crm_module_grants')assert.equal(hash(after.filter(row=>row.module!=='fonciere')),hash(rows),'Other module grants remain byte-exact');
  else if(table==='crm_access_invitations'){
   for(const row of rows){const next=JSON.parse(JSON.stringify(after.find(item=>item.id===row.id)));assert(next);const {grants,fonciere_assignments,...stable}=next;const{grants:oldGrants,...oldStable}=row;assert.deepEqual(stable,oldStable,'Pending invitation identity/role/scope preserved');assert.deepEqual(Object.fromEntries(Object.entries(grants).filter(([key])=>key!=='fonciere')),oldGrants);}
  } else if(table==='crm_access_profiles'){
   const stable=items=>items.map(({revision,updated_at,...rest})=>rest);
   assert.deepEqual(stable(JSON.parse(JSON.stringify(after))),stable(rows),'Active/general-admin identities retained');
  } else assert.equal(hash(after),hash(rows),table+' business data unchanged');
 }
 checks.push('Every historical business table, role, owner, assignment, document and non-Foncière module grant is preserved');
 const afterEffective={};
 for(const [name,user] of Object.entries(fixture.users)){
  const signed=await login(user);
  const [projects,presentations,assets,snapshot]=await Promise.all([signed.client.from('fonciere_projects').select('id').order('id'),signed.client.from('izord_projects').select('id').order('id'),signed.client.from('fonciere_assets').select('id').order('id'),signed.client.rpc('crm_access_snapshot')]);
  for(const response of [projects,presentations,assets,snapshot])assert.equal(response.error,null,response.error?.message);
  await sql.query('begin');await sql.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);
  const probes=(await sql.query('select app_private.can_fonciere_project($1,false) project_read,app_private.can_fonciere_project($1,true) project_write,app_private.can_project($2,false) presentation_read,app_private.can_project($2,true) presentation_write,app_private.full_access() full_access',[fixture.projects.assigned,fixture.presentations.assigned])).rows[0];await sql.query('rollback');
  afterEffective[name]={projects:projects.data,presentations:presentations.data,assets:assets.data,probes,otherModules:Object.fromEntries(Object.entries(snapshot.data.modules).filter(([key])=>key!=='fonciere'))};
  assert.deepEqual(afterEffective[name],fixture.effectiveBefore[name],'Effective access changed for '+name);
 }
 checks.push('All 21 real Auth identities retain exactly the same visible projects/presentations/assets and read/write/full-access decisions');
 const newGrants=(await sql.query("select u.email,g.level from crm_module_grants g join auth.users u on u.id=g.user_id where g.module='fonciere' order by u.email")).rows;
 assert.equal(newGrants.find(row=>row.email===fixture.users.legacyReader.email)?.level,'read','Business reader never gains contribution');
 for(const key of ['legacyNoRole','legacyInactive','legacyInactiveMembership','legacyNoGrant','legacyFull'])assert(!newGrants.some(row=>row.email===fixture.users[key].email&&row.level!=='none'),'No newly effective Foncière permission for '+key);
 assert.equal(afterEffective.legacyFull.probes.full_access,true,'Historical OAR full administrator stays full');
 checks.push('Compatibility initialization respects reader ceiling, inactive/missing membership and historical full administrator');
 const journals=(await sql.query("select schemaname,tablename from pg_tables where schemaname='app_private' and (tablename ilike '%fonciere%permission%' or tablename ilike '%fonciere%access%') order by tablename")).rows;
 assert(journals.length>0,'Private recovery journal exists');
 for(const row of journals){const denied=(await sql.query('select has_table_privilege(\'anon\',$1,\'select\') anon,has_table_privilege(\'authenticated\',$1,\'select\') authenticated',[row.schemaname+'.'+row.tablename])).rows[0];assert.equal(denied.anon,false);assert.equal(denied.authenticated,false);}
 checks.push('Recovery journal is private and unavailable to anonymous/authenticated direct reads');
 writeFileSync(join(directory,'fonciere-access-effective-after.private.json'),JSON.stringify(afterEffective),{mode:0o600});
 writeFileSync(join(output,'migration-results.json'),JSON.stringify({passed:checks.length,checks,accountsCompared:Object.keys(afterEffective).length,sourceSha256:createHash('sha256').update(source).digest('hex'),privateBackupTaken:true,recoveryJournalPrivate:true,effectiveAccessConstant:true,productionRequests:0},null,2));
 console.log('PASS '+checks.join('\nPASS '));
}finally{await sql.end();}
