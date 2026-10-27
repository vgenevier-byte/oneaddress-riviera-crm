/** Serve a source-identical disposable copy. Never read repository .env files.
 * Only owned loopback Auth/RPC/Storage can be reached. The photo preview API receives this disposable stack's private service key; no repository env or production credentials.
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

assert.equal(process.env.ARBITRAGE_TEST_ACK, 'ARBITRAGE_LOCAL_ONLY');
assert.ok(process.env.ARBITRAGE_STATUS_FILE, 'Owned local status file required');
const port = Number(process.env.ARBITRAGE_APP_PORT ?? 3197);
assert.ok([3197, 3198].includes(port), 'Only owned loopback preview ports are permitted');
assert.equal(process.env.ARBITRAGE_SERVER_ACK, 'ARBITRAGE_OWNED_LOCAL_ONLY');
const repo = process.cwd(), stackRoot = dirname(process.env.ARBITRAGE_STATUS_FILE);
const root = port === 3197 ? stackRoot : join(stackRoot, 'arbitrage-preview');
mkdirSync(root, { recursive: true, mode: 0o700 });
const app = `http://127.0.0.1:${port}`;
const status = JSON.parse(readFileSync(process.env.ARBITRAGE_STATUS_FILE, 'utf8'));
assert.equal(status.API_URL, 'http://127.0.0.1:56031');
const directory = join(root, 'app'), manifestFile = join(root, 'app.private.json');
if (existsSync(manifestFile)) {
  const old = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(old.directory, directory);
  if (old.serverPID) {
    try { process.kill(old.serverPID, 0); throw new Error('Owned server still running; stop its launcher before refreshing the copy.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const folder of ['app', 'components', 'lib', 'public']) cpSync(join(repo, folder), join(directory, folder), {
  recursive: true, filter: source => !basename(source).startsWith('.env') && !basename(source).includes('.before-'),
});
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'eslint.config.mjs']) if (existsSync(join(repo, file))) cpSync(join(repo, file), join(directory, file));
if (!existsSync(join(directory, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(directory, 'node_modules'), 'dir');
const guard = join(root, 'network-guard.cjs');
const originalGuard = readFileSync(join(repo, 'tests/izord/local-network-guard.cjs'), 'utf8');
writeFileSync(guard, originalGuard.replaceAll("IZORD_TEST_ACK", "ARBITRAGE_TEST_ACK").replaceAll('IZORD_DISPOSABLE_LOCAL_ONLY', 'ARBITRAGE_LOCAL_ONLY').replace('new Set([3159, 55431])', `new Set([${port}, 56031, 56032])`), { mode: 0o600 });
const dev = process.argv.includes('--dev');
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8',
  NODE_ENV: dev ? 'development' : 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--require=${guard}`,
  ARBITRAGE_TEST_ACK: process.env.ARBITRAGE_TEST_ACK,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
};
env.LOCAL_AUTH_INVITE_KEY = status.SERVICE_ROLE_KEY;
const hashes = {};
const { readdirSync } = await import('node:fs');
function sources(folder) { return readdirSync(join(directory, folder), {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? sources(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]); }
for (const file of [...sources('app'),...sources('components'),...sources('lib')]) hashes[file] = createHash('sha256').update(readFileSync(join(directory,file))).digest('hex');

const manifest = { app, directory, sourceHashes: hashes, mode: dev ? 'development' : 'production', status: 'starting', launcherPID: process.pid, serverPID: null, auth: 'real local JWT/RPC', egress: 'loopback only', startedAt: new Date().toISOString() };
const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save();
let child;
const sanitize = value => String(value).replaceAll(status.ANON_KEY, '[LOCAL PUBLIC KEY]').replaceAll(status.SERVICE_ROLE_KEY || '\0', '[LOCAL SERVICE KEY]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]');
function launch(args, logName) {
  child = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += String(chunk); writeFileSync(join(root, logName), sanitize(output), { mode: 0o600 }); });
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child?.kill(signal));
if (!dev) {
  const result = await launch(['build','--webpack'], 'build.private.log');
  if (result.code) { manifest.status = 'build-failed'; save(); throw new Error('Isolated build failed; inspect private build log.'); }
}
const running = launch(dev ? ['dev','--webpack','--hostname','127.0.0.1','--port',String(port)] : ['start','--hostname','127.0.0.1','--port',String(port)], 'server.private.log');
manifest.serverPID = child.pid; save();
for (let attempt = 0; attempt < 150; attempt++) {
  try { const response = await fetch(app+'/charges', { signal: AbortSignal.timeout(1500) }); if (response.ok) { manifest.status = 'ready'; save(); break; } } catch { /* Starting. */ }
  if (child.exitCode !== null) break;
  await new Promise(resolve => setTimeout(resolve, 300));
}
assert.equal(manifest.status, 'ready', 'Server must become ready');
console.log(JSON.stringify({ ready:true, app, mode:manifest.mode, manifest:manifestFile }));
const result = await running;
manifest.status = 'stopped'; manifest.serverPID = null; save();
process.exitCode = result.code || 0;
