/** Disposable car candidate: real local PostgreSQL, simulated Auth/RPC and providers.
 * Never loads .env, never connects to a remote store. Not proof of real Auth/RLS.
 * Requires the separately installed native PostgreSQL to be running on 55532.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, symlinkSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(import.meta.dirname, '../..');
const directory = '/private/tmp/oar-publisher-cars-bench-20261021';
const app = 'http://127.0.0.1:3173', auth = 'http://127.0.0.1:55531';
const database = 'postgresql://publisher_local@127.0.0.1:55532/publisher_cars';
assert.equal(process.env.PUBLISHER_TEST_ACK, 'PUBLISHER_DISPOSABLE_LOCAL_ONLY');
assert.ok(root.startsWith('/private/tmp/oar-publisher-cars-'));
mkdirSync(directory, { recursive: true });
const manifest = path.join(directory, 'bench.json');
if (existsSync(manifest)) {
  const prior = JSON.parse(readFileSync(manifest));
  assert.equal(prior.directory, directory);
  if (prior.pid) { try { process.kill(prior.pid, 0); throw new Error('Owned bench still running'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
}
const admin = new pg.Client({ connectionString: 'postgresql://publisher_local@127.0.0.1:55532/postgres' });
await admin.connect();
if (!(await admin.query("select 1 from pg_database where datname='publisher_cars'")).rowCount) await admin.query('create database publisher_cars');
await admin.end();
const sql = new pg.Client({ connectionString: database }); await sql.connect();
if (!(await sql.query("select to_regclass('public.publisher_posts') t")).rows[0].t) {
  await sql.query(readFileSync(path.join(root, 'lib/publisher/sql/local-bootstrap.sql'), 'utf8'));
  for (let i = 1; i <= 90; i++) await sql.query('insert into publisher_music(title,artist,availability_status) values($1,$2,$3)', [`Local Track ${i}`, `Fictitious Artist ${i}`, 'available']);
  for (const [id, universe, theme, caption] of [
    ['a3000000-0000-4000-8000-000000000001', 'Voitures', 'voiture', 'A quiet Riviera moment in an old local car study.'],
    ['a3000000-0000-4000-8000-000000000002', 'Paysages', 'paysage', 'The coast glows softly in an old local landscape study.'],
  ]) await sql.query(`insert into publisher_posts(id,post_date,creation_mode,creative_universe,creative_moment,creative_style,theme,moment,caption,scene_summary,visual_signature,hashtags,primary_music_id,alternative_music_ids,location,generation_status) values($1,'2026-09-01','guided',$2,'Matinale','Élégant',$3,'matin',$4,'Historic local archive scene','historic-local-archive','{#OneAddressRiviera,#Riviera,#Coast,#Light,#Escape}',1,'{2,3}','French Riviera','ready')`, [id, universe, theme, caption]);
  await sql.query(readFileSync(path.join(root, 'lib/publisher/sql/001-crm-boundary.sql'), 'utf8'));
  writeFileSync(path.join(directory, 'historical-before.json'), JSON.stringify((await sql.query('select to_jsonb(p) row from publisher_posts p order by id')).rows.map(x => x.row), null, 2));
}
await sql.query(readFileSync(path.join(root, 'lib/publisher/sql/002-car-context.sql'), 'utf8'));
writeFileSync(path.join(directory, 'database-version.txt'), (await sql.query('select version()')).rows[0].version + '\n');
await sql.end();
const users = Object.fromEntries(['editor', 'reader', 'none', 'other'].map((name, i) => [name, {
  id: `b3000000-0000-4000-8000-00000000000${i + 1}`, email: `${name}@publisher-cars.example.invalid`, password: 'Fictitious-local-only!',
}]));
const permissionsFile = path.join(directory, 'permissions.json');
if (!existsSync(permissionsFile)) writeFileSync(permissionsFile, JSON.stringify({ editor: 'contribute', reader: 'read', none: 'none', other: 'contribute' }));
const jwt = user => {
  const body = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000) + 86400 })).toString('base64url')].join('.');
  return body + '.' + createHmac('sha256', 'fictitious-bench-key').update(body).digest('base64url');
};
const sessions = Object.fromEntries(Object.entries(users).map(([name, u]) => [name, { access_token: jwt(u), refresh_token: `local-refresh-${name}`, expires_in: 86400, expires_at: Math.floor(Date.now()/1000) + 86400, token_type: 'bearer', user: { ...u, password: undefined, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-21T00:00:00Z' } }]));
const authServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', app); res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* invalid body gets denied below */ }
  const name = Object.keys(sessions).find(n => req.headers.authorization === `Bearer ${sessions[n].access_token}`);
  const url = new URL(req.url, auth);
  const levels = JSON.parse(readFileSync(permissionsFile));
  const level = levels[name] || 'none';
  const reply = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  appendFileSync(path.join(directory, 'auth-trace.jsonl'), JSON.stringify({ path: url.pathname, name, action: body.p_action, level }) + '\n');
  if (url.pathname === '/auth/v1/token') {
    const login = Object.keys(users).find(n => users[n].email === body.email && users[n].password === body.password);
    return reply(login ? sessions[login] : { message: 'Invalid local fixture credentials' }, login ? 200 : 400);
  }
  if (!name) return reply({ message: 'Invalid fictitious session' }, 401);
  if (url.pathname === '/auth/v1/user') return reply(sessions[name].user);
  if (url.pathname === '/auth/v1/logout') return reply({});
  if (url.pathname === '/rest/v1/app_memberships') return reply([]);
  if (url.pathname === '/rest/v1/rpc/crm_access_snapshot') return reply({ revision: level === 'contribute' ? 1 : 2, active: true, generalAdmin: false, fullAccess: false, modules: level === 'none' ? {} : { publisher: { level, sensitive: level === 'contribute' ? { generate: true, export: true, mark_published: true } : { export: true } } } });
  if (url.pathname === '/rest/v1/rpc/crm_authorize_publisher') return reply(level === 'contribute' || (level === 'read' && ['session','today','history','status','image','export','export-text'].includes(body.p_action)));
  reply({ message: 'Endpoint absent from fixture' }, 403);
});
await new Promise(resolve => authServer.listen(55531, '127.0.0.1', resolve));
writeFileSync(path.join(directory, 'fixtures.json'), JSON.stringify({ users, sessions, app, auth, database }, null, 2));
const runtime = path.join(directory, 'app'); mkdirSync(runtime, { recursive: true });
for (const folder of ['app','components','lib','public']) cpSync(path.join(root, folder), path.join(runtime, folder), { recursive: true });
for (const file of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','eslint.config.mjs']) cpSync(path.join(root, file), path.join(runtime, file));
if (!existsSync(path.join(runtime, 'node_modules'))) symlinkSync(path.join(root, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
// Instrument only the disposable provider copy: capture exactly what crosses
// the simulated provider boundary. Product provider.js remains unchanged.
const providerPath = path.join(runtime, 'lib/publisher/engine/provider.js');
let provider = readFileSync(providerPath, 'utf8');
provider = "import { appendFileSync as recordFixtureRequest } from 'node:fs';\n" + provider;
for (const kind of ['responses', 'images']) {
  const method = kind === 'responses' ? 'parse' : 'generate';
  const needle = `${kind}: { ${method}: async request => {\n      await paid();`;
  assert.equal(provider.split(needle).length, 2);
  provider = provider.replace(needle, needle + `\n      recordFixtureRequest(${JSON.stringify(path.join(directory, 'provider-trace.jsonl'))}, JSON.stringify({kind:${JSON.stringify(kind)},requestId:currentOperation().requestId,request})+'\\n');`);
}
writeFileSync(providerPath, provider);
const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development', NODE_OPTIONS: `--require=${path.join(root, 'tests/publisher/network-guard.cjs')}`, PUBLISHER_TEST_ACK: 'PUBLISHER_DISPOSABLE_LOCAL_ONLY', NEXT_PUBLIC_SUPABASE_URL: auth, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fictitious-local-publishable-key', NEXT_PUBLIC_PUBLISHER_DEMO: '1', PUBLISHER_DATABASE_URL: database, PUBLISHER_LOCAL_SIMULATION: '1', PUBLISHER_LOCAL_MEDIA_DIR: path.join(directory, 'media'), PUBLISHER_SIMULATION_DELAY_MS: '100' };
const log = path.join(directory, 'next.log'); writeFileSync(log, '');
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev','--webpack','--hostname','127.0.0.1','--port','3173'], { cwd: runtime, env, stdio: ['ignore','pipe','pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', d => appendFileSync(log, d));
writeFileSync(manifest, JSON.stringify({ directory, root, pid: process.pid, serverPID: child.pid, app, database, auth: 'simulated HTTP boundary', providers: 'simulated', postgres: 'real native local', providerInstrumentation: providerPath }, null, 2));
console.log(`LOCAL BENCH ${app}/publisher | PostgreSQL real | Auth/RPC + providers simulated`);
for (const sig of ['SIGINT','SIGTERM']) process.on(sig, () => { child.kill('SIGTERM'); authServer.close(); });
await new Promise(resolve => child.on('exit', resolve));
authServer.close();
