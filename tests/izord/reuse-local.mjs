/** Retained fictitious benchmark only. No schema reset, migration or old-row deletion. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const migrationHashes = {
  'supabase/migrations/20260914210807_drive_folder_registry.sql': 'ac1e8a6f5ae5bab3ae042bec94fc40bdc937e661ddc2474564d12b8545eda7f6',
  'supabase/migrations/20260916170445_module_access_foundation.sql': '03b897399c1dc0e9eb3314fd6ddfe1c17135337c8fdef7a27eb579210253fce9'
};
const tables = ['crm_leads','crm_tasks','crm_properties','crm_vehicles','crm_boats','crm_quotes','crm_contacts','crm_backups','app_memberships','crm_drive_folder_registry','izord_projects','izord_project_versions','izord_project_assignments','izord_assets','izord_access_events','izord_invitations'];
const digest = value => createHash('sha256').update(value).digest('hex');

export function assertNewFixturePath(file, stackDir) {
  assert.equal(dirname(resolve(file)), resolve(stackDir), 'New private fixtures must belong to this retained stack');
  assert.notEqual(basename(file), 'browser-fixtures.json', 'Preserve the preceding private fixture');
  assert.equal(existsSync(file), false, 'Use a new fixture filename for each run');
}

export function withFixtureVendor(payload, vendorId) {
  assert.ok(payload && typeof payload === 'object' && Array.isArray(payload.contacts), 'Retained fictitious workspace required');
  assert.ok(payload.contacts.some(c => c.id === 'fictional-contact-browser' && c.name === 'OAR LOCAL CONFIDENTIEL'), 'Known retained fictitious contact required');
  assert.ok(!payload.contacts.some(c => c.id === vendorId), 'New vendor identity must be unique');
  return { ...payload, contacts: [...payload.contacts, { id: vendorId, kind: 'Prestataire', companyName: 'Prestataire fictif API' }] };
}

export function visibleIds(existing, current, globalRole) {
  // Compare the complete REST response, never a filtered subset that could hide a leak.
  return [...new Set([...(globalRole ? existing : []), ...current])].sort();
}

export function assertRetainedHashes(before, after) {
  const counts = values => values.reduce((map, hash) => map.set(hash, (map.get(hash) || 0) + 1), new Map());
  const observed = counts(after);
  for (const [hash, count] of counts(before)) assert.ok((observed.get(hash) || 0) >= count, 'A retained fictitious row changed or disappeared');
}

export async function catalogHash(sql) {
  const { rows } = await sql.query(`select kind, identity, definition from (
    select 'function' kind, p.oid::regprocedure::text identity, pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind in ('f','p')
    union all select 'policy', schemaname||'.'||tablename||'.'||policyname, row_to_json(x)::text from pg_policies x where schemaname in ('public','storage')
    union all select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname in ('public','storage')
    union all select 'table', n.nspname||'.'||c.relname, json_build_object('rls',c.relrowsecurity,'force',c.relforcerowsecurity)::text
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind='r'
  ) definitions order by kind,identity`);
  return digest(JSON.stringify(rows));
}

async function retainedHashes(sql) {
  const result = {};
  for (const table of tables) result[table] = (await sql.query(`select md5(to_jsonb(t)::text) hash from public.${table} t order by hash`)).rows.map(r => r.hash);
  result.storage_objects = (await sql.query("select md5(to_jsonb(t)::text) hash from storage.objects t where bucket_id in ('crm-documents','izord-documents') order by hash")).rows.map(r => r.hash);
  result.auth_identities = (await sql.query('select md5(json_build_array(id,email)::text) hash from auth.users order by hash')).rows.map(r => r.hash);
  return result;
}

export async function prepareReuse(sql, { statusFile, fixturePath, api, runId }) {
  const stackDir = dirname(resolve(statusFile));
  const manifest = JSON.parse(readFileSync(join(stackDir,'manifest.json'),'utf8'));
  assert.equal(resolve(manifest.dir),stackDir);
  assert.equal(manifest.project,basename(stackDir).toLowerCase());
  assert.equal(manifest.api,api);
  assertNewFixturePath(fixturePath,stackDir);
  for (const [path, expected] of Object.entries(migrationHashes)) assert.equal(digest(readFileSync(path)),expected,'Reviewed migration source must remain unchanged');
  const oldFixture=JSON.parse(readFileSync(join(stackDir,'browser-fixtures.json'),'utf8'));
  assert.equal(oldFixture.integrationComplete,true,'Previously completed local fixture required');
  assert.equal(oldFixture.api,api);
  assert.equal(Number((await sql.query("select count(*) n from auth.users where email is null or email not like '%@example.invalid'")).rows[0].n),0,'Only fictitious Auth identities may exist in the retained benchmark');
  for (const user of Object.values(oldFixture.users)) assert.equal((await sql.query('select id from auth.users where id=$1 and email=$2',[user.id,user.email])).rowCount,1,'Retained Auth fixture identity mismatch');
  const workspace=(await sql.query("select workspace_id,payload,updated_by,updated_at::text revision,md5(payload::text) payload_hash from public.crm_workspace_state where workspace_id='oneaddress-riviera'")).rows;
  assert.equal(workspace.length,1,'Existing shared fictitious workspace required');
  assert.equal((await sql.query('select count(*)::int n from public.crm_workspace_state')).rows[0].n,1);
  const projects=(await sql.query('select id from public.izord_projects order by id')).rows.map(r=>r.id);
  const versions=(await sql.query('select project_id from public.izord_project_versions')).rows;
  const assets=(await sql.query("select object_path from public.izord_assets where lifecycle='finalized' order by object_path")).rows.map(r=>r.object_path);
  for(const size of [projects.length,versions.length,assets.length]) assert.ok(size+50<1000,'Retained inventory exceeds this benchmark full-response limit');
  const snapshot={runId,stackDir,workspace:workspace[0],catalogHash:await catalogHash(sql),retained:await retainedHashes(sql),baseline:{projects,versionProjects:[...new Set(versions.map(r=>r.project_id))],assets}};
  const snapshotFile=join(stackDir,`retained-fixture-${runId}.json`);
  writeFileSync(snapshotFile,JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
  return {...snapshot,snapshotFile};
}

export async function verifyRetained(sql,snapshot) {
  assert.equal(await catalogHash(sql),snapshot.catalogHash,'Retained schema/policies/functions changed');
  const observed=await retainedHashes(sql);
  for(const [table,hashes] of Object.entries(snapshot.retained)) assertRetainedHashes(hashes,observed[table]);
  return {schemaUnchanged:true,retainedTablesVerified:Object.keys(snapshot.retained).length,retainedRowsPreserved:true};
}

export function assertRestorablePayload(expected,current) {
  assert.equal(current,expected,'Shared fictitious payload changed after the benchmark; preserve it for review instead of overwriting');
}
