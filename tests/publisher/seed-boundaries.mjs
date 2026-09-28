/** Concrete private OAR/IZORD records prove denial against existing content.
 * Reuses actual Auth + Storage services and CRM RPCs; no fake Storage metadata.
 */
import './network-guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client, status, fixturePath, login, rpc } from './local.mjs';

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
if (fixture.boundaries) { console.log('Existing concrete boundary fixtures retained.'); process.exit(0); }
const sql = new Client({ connectionString: status.DB_URL }); await sql.connect();
try {
const token = await login(fixture.users.admin);
const priorProjects = (await sql.query('select id from public.izord_projects where owner_id=$1 and title=$2', [fixture.users.admin.id, 'IZORD LOCAL CONFIDENTIEL'])).rows;
assert.ok(priorProjects.length <= 1, 'Unambiguous retained boundary project');
const project = priorProjects[0] ? { status: 200, data: priorProjects[0].id } : await rpc('izord_create_project', token, { p_title: 'IZORD LOCAL CONFIDENTIEL' });
assert.equal(project.status, 200, 'Authorized admin creates real local project');
const priorAssets = (await sql.query('select object_path,lifecycle from public.izord_assets where project_id=$1', [project.data])).rows;
assert.ok(priorAssets.length <= 1, 'Unambiguous retained boundary document');
const asset = priorAssets[0] ? { status: 200, data: priorAssets[0].object_path } : await rpc('izord_register_asset', token, { p_project: project.data, p_revision: 1, p_kind: 'pdf' });
assert.equal(asset.status, 200);
const files = { oar: { bucket: 'crm-documents', path: 'publisher-boundary.pdf', content: '%PDF-1.4\nOAR LOCAL CONFIDENTIEL\n%%EOF' }, izord: { bucket: 'izord-documents', path: asset.data, content: '%PDF-1.4\nIZORD LOCAL CONFIDENTIEL\n%%EOF' } };
for (const file of Object.values(files)) {
  const existing = await fetch(status.API_URL + '/storage/v1/object/' + file.bucket + '/' + file.path, { headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + token } });
  if (existing.status === 200) { assert.equal(await existing.text(), file.content); continue; }
  const response = await fetch(status.API_URL + '/storage/v1/object/' + file.bucket + '/' + file.path, { method: 'POST', headers: { apikey: status.ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf' }, body: file.content });
  assert.equal(response.status, 200, 'Actual authorized Storage upload');
}
if (priorAssets[0]?.lifecycle !== 'finalized') assert.equal((await rpc('izord_finalize_asset', token, { p_asset: asset.data.split('/')[1] })).status, 204);
  const historicalRows = {};
  for (const table of ['crm_leads', 'crm_tasks', 'crm_properties', 'crm_vehicles', 'crm_boats', 'crm_quotes', 'crm_contacts', 'crm_backups']) {
    const inserted = await sql.query(`insert into public.${table}(user_id,payload) values($1,$2) returning id`, [fixture.users.editor.id, { fixture: 'Publisher owner row must remain inaccessible without OAR grant' }]);
    historicalRows[table] = inserted.rows[0].id;
  }
  fixture.boundaries = { project: project.data, files, historicalRows };
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ project: 'actual local IZORD record', documents: Object.keys(files), historicalOwnerRows: Object.keys(historicalRows).length, production: false }));
} finally { await sql.end(); }
