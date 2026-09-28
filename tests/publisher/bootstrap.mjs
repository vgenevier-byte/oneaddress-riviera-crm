/** Actual local Auth/Postgres/Storage fixtures, reusing the historical SQL fixture
 * and all real CRM migrations. Only this owned stack is ever changed.
 */
import './network-guard.cjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, status, statusPath, request, local, fixturePath } from './local.mjs';
import { RECENT_MUSIC_SEED, CONFIRMED_MUSIC_SEED, MUSIC_LIBRARY_SEED } from '../../lib/publisher/engine/constants.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const migrationFile = join(local.directory, 'migrations.private.json');
const applied = existsSync(migrationFile) ? JSON.parse(readFileSync(migrationFile, 'utf8')) : {};
const sql = new Client({ connectionString: status.DB_URL });
await sql.connect();
const record = () => writeFileSync(migrationFile, JSON.stringify(applied, null, 2), { mode: 0o600 });
try {
  assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count), 0, 'Only fictitious Auth users are permitted');
  if (!(await sql.query("select to_regclass('public.crm_workspace_state') present")).rows[0].present) {
    const baseline = readFileSync('tests/izord/sql-fixture.sql', 'utf8');
    const start = baseline.indexOf('create table public.crm_workspace_state'), end = baseline.indexOf('create schema storage;');
    assert.ok(start > 0 && end > start);
    await sql.query(baseline.slice(start, end));
    await sql.query("insert into storage.buckets(id,name,public) values('crm-documents','crm-documents',false); create policy crm_docs on storage.objects for all to authenticated using(bucket_id='crm-documents') with check(bucket_id='crm-documents')");
    const catalog = JSON.parse(readFileSync('lib/access/collections.json', 'utf8'));
    const payload = Object.fromEntries(catalog.map(item => [item.collection, []]));
    payload.contacts = [{ id: 'publisher-fixture-contact', name: 'OAR LOCAL CONFIDENTIEL', kind: 'Client', email: 'fiction@example.invalid' }];
    await sql.query("update public.crm_workspace_state set payload=$1 where workspace_id='oneaddress-riviera'", [payload]);
  }
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
    const text = readFileSync(join('supabase/migrations', file), 'utf8');
    if (applied[file]) { assert.equal(applied[file], digest(text), 'Applied migration source changed: ' + file); continue; }
    await sql.query(text); applied[file] = digest(text); record();
  }
  assert.ok(applied['20260928191512_publisher_module_access.sql'], 'Publisher access migration must be prepared before fixtures');
  await sql.query("notify pgrst, 'reload schema'");

  // No invite endpoint, mail, real identity or membership is involved.
  const names = ['admin', 'editor', 'reader', 'reader-export', 'contributor', 'none', 'revoked', 'matrix', 'admin-only', 'full-oar'];
  const users = {};
  const modules = ['dashboard', 'contacts', 'leads', 'tasks', 'quotes', 'bookings', 'vendorQuotes', 'vendorInvoices', 'houseTracking', 'documents', 'planning', 'properties', 'vehicles', 'boats', 'izord'];
  for (const name of names) {
    const email = `publisher-${name}@example.invalid`, password = 'Local-Publisher-2026!';
    let user = (await sql.query('select id from auth.users where email=$1', [email])).rows[0];
    if (!user) {
      const created = await request('/auth/v1/admin/users', status.SERVICE_ROLE_KEY, { email, password, email_confirm: true });
      assert.equal(created.status, 200, 'Create local fictitious user'); user = created.data;
    }
    users[name] = { id: user.id, email, password };
    // Restore only our fixed demo accounts; separate access-test identities remain untouched.
    await sql.query('insert into public.crm_access_profiles(user_id,general_admin,active) values($1,$2,$3) on conflict(user_id) do update set general_admin=$2,active=$3,revision=crm_access_profiles.revision+1', [user.id, ['admin', 'admin-only'].includes(name), name !== 'revoked']);
    await sql.query('delete from public.crm_module_grants where user_id=$1', [user.id]);
    const fullOAR = ['admin', 'full-oar'].includes(name);
    if (fullOAR) {
      await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member') on conflict(user_id,workspace_id) do update set status='active'", [user.id]);
      for (const moduleId of modules.filter(item => item !== 'izord' || name === 'admin')) {
        const sensitive = { delete: true, export: true, ...(moduleId === 'contacts' ? { bank_read: true, bank_write: true } : {}), ...(moduleId === 'vendorInvoices' ? { payment: true } : {}) };
        await sql.query('insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,$2,$3,$4)', [user.id, moduleId, 'contribute', sensitive]);
      }
    } else assert.equal((await sql.query('select 1 from public.app_memberships where user_id=$1', [user.id])).rowCount, 0, 'Publisher-only fixture must not acquire a membership');
    if (name === 'admin') await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'izord','admin') on conflict(user_id,workspace_id) do update set status='active'", [user.id]);
    const grant = ['admin', 'editor', 'revoked'].includes(name) ? { level: 'contribute', sensitive: { generate: true, export: true, mark_published: true } }
      : ['reader', 'reader-export', 'matrix'].includes(name) ? { level: 'read', sensitive: { export: name === 'reader-export' } }
        : name === 'contributor' ? { level: 'contribute', sensitive: {} } : null;
    if (grant) await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'publisher',$2,$3)", [user.id, grant.level, grant.sensitive]);
  }
  if (!status.PUBLISHER_DATABASE_URL) {
    assert.equal((await sql.query("select 1 from pg_database where datname='publisher_local'")).rowCount, 0, 'Unowned existing Publisher database: stop');
    assert.equal((await sql.query("select 1 from pg_roles where rolname='publisher_app'")).rowCount, 0, 'Unowned existing role: stop');
    const password = randomBytes(32).toString('hex');
    await sql.query(`create role publisher_app login password '${password}'`);
    await sql.query('grant publisher_app to postgres');
    await sql.query('create database publisher_local owner publisher_app');
    await sql.query('revoke all on database publisher_local from public');
    const url = new URL(status.DB_URL); url.username = 'publisher_app'; url.password = password; url.pathname = '/publisher_local';
    status.PUBLISHER_DATABASE_URL = url.toString();
    writeFileSync(statusPath, JSON.stringify(status), { mode: 0o600 });
  }
  const publisher = new Client({ connectionString: status.PUBLISHER_DATABASE_URL });
  await publisher.connect();
  try {
    const bootstrap = readFileSync('lib/publisher/sql/local-bootstrap.sql', 'utf8');
    if (!(await publisher.query("select to_regclass('public.publisher_posts') present")).rows[0].present) {
      await publisher.query(bootstrap);
      const music = [...RECENT_MUSIC_SEED, ...CONFIRMED_MUSIC_SEED, ...MUSIC_LIBRARY_SEED.map(row => [...row, 'unknown'])];
      for (const [title, artist, availability] of music) await publisher.query('insert into publisher_music(title,artist,availability_status) values($1,$2,$3)', [title, artist, availability]);
      const rows = [
        { id: '6a8ed21f-076c-44ba-b516-98f3ca96ec81', date: '2026-09-10', status: 'published', caption: 'Archive fictive conservée : la lumière de la Riviera.', music: 1, published: '2026-09-10T10:00:00Z' },
        { id: '6833a290-3d7f-4752-8a76-88c9e10b1773', date: '2026-09-11', status: 'draft', caption: 'Brouillon historique fictif, conservé pour la démonstration.', music: null, published: null },
      ];
      for (const row of rows) {
        const pathname = `publisher/${row.date}/${row.id}.svg`;
        const image = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280" viewBox="0 0 1024 1280"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#e2cba8"/><stop offset="1" stop-color="#638d99"/></linearGradient></defs><rect width="1024" height="1280" fill="url(#s)"/><path d="M0 660Q300 500 580 630T1024 600V1280H0Z" fill="#236276"/><path d="M0 850L360 660 640 900 1024 790V1280H0Z" fill="#173d4e"/><text x="70" y="1100" font-family="Georgia" font-size="52" fill="#fff">Riviera • archive locale</text><text x="70" y="1170" font-family="sans-serif" font-size="30" fill="#fff">Illustration fictive — aucun média Production</text></svg>`;
        mkdirSync(join(local.directory, 'media', 'publisher', row.date), { recursive: true, mode: 0o700 });
        writeFileSync(join(local.directory, 'media', pathname), image, { mode: 0o600 });
        await publisher.query(`insert into publisher_posts(id,post_date,creation_mode,theme,moment,scene_summary,visual_signature,caption,hashtags,primary_music_id,alternative_music_ids,music_used_id,location,format,status,generation_status,published_at,created_at,updated_at,image_pathname,image_url,image_content_type,image_width,image_height,image_bytes)
          values($1,$2,'guided','paysage','matin','Archive locale représentative','fixture-archive',$3,'{#FrenchRiviera,#OneAddressRiviera}',1,'{2,3}',$4,'French Riviera','Feed 4:5',$5,'ready',$6,$7,$7,$8,$9,'image/svg+xml',1024,1280,$10)`, [row.id, row.date, row.caption, row.music, row.status, row.published, row.date + 'T08:00:00Z', pathname, `https://fictitious.private.blob.vercel-storage.com/${pathname}`, Buffer.byteLength(image)]);
      }
      const before = (await publisher.query('select to_jsonb(p) row from publisher_posts p order by id')).rows.map(row => row.row);
      writeFileSync(join(local.directory, 'history-before.private.json'), JSON.stringify(before), { mode: 0o600 });
      applied['publisher-local-bootstrap'] = digest(bootstrap); record();
    }
    const boundary = readFileSync('lib/publisher/sql/001-crm-boundary.sql', 'utf8');
    if (!applied['publisher-boundary']) { await publisher.query(boundary); applied['publisher-boundary'] = digest(boundary); record(); }
    else assert.equal(applied['publisher-boundary'], digest(boundary), 'Applied Publisher boundary changed');
    const before = JSON.parse(readFileSync(join(local.directory, 'history-before.private.json'), 'utf8'));
    const after = (await publisher.query('select to_jsonb(p) row from publisher_posts p where id=any($1::uuid[]) order by id', [before.map(row => row.id)])).rows.map(row => row.row);
    for (const row of after) { assert.equal(row.created_by, null); assert.equal(row.updated_by, null); delete row.revision; delete row.created_by; delete row.updated_by; }
    assert.deepEqual(after, before, 'Publisher historical IDs, timestamps, status and music relations preserved exactly');
  } finally { await publisher.end(); }
  mkdirSync(join(local.directory, 'media'), { recursive: true, mode: 0o700 });
  mkdirSync(join(local.directory, 'results'), { recursive: true, mode: 0o700 });
  const priorFixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : {};
  writeFileSync(fixturePath, JSON.stringify({ ...priorFixture, app: local.app, api: local.api, users, historicalIds: ['6a8ed21f-076c-44ba-b516-98f3ca96ec81', '6833a290-3d7f-4752-8a76-88c9e10b1773'], simulatedExternalGeneration: true }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, app: local.app, auth: 'actual local Supabase', publisherDatabase: 'separate publisher_local', users: Object.keys(users), migrations: Object.keys(applied), historicalFixturePreserved: true }));
} finally { await sql.end(); }
