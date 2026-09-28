/** Same isolated-source approach as tests/unified/serve.mjs. Actual CRM guards,
 * routes and provider adapter; only explicitly gated external generation is fake.
 * No repository .env is read/copied and outgoing TCP is restricted to this bench.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { local, status } from './local.mjs';

assert.ok(status.PUBLISHER_DATABASE_URL, 'Run the guarded Publisher local bootstrap first');
const repo = process.cwd(), directory = join(local.directory, 'app');
const manifestFile = join(local.directory, 'app.private.json');
if (existsSync(manifestFile)) {
  const old = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(old.directory, directory); assert.equal(old.app, local.app);
  if (old.serverPID) {
    try { process.kill(old.serverPID, 0); throw new Error('Owned Publisher server still running: stop its launcher before replacement'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const folder of ['app', 'components', 'lib', 'public']) cpSync(join(repo, folder), join(directory, folder), {
  recursive: true, filter: source => !basename(source).startsWith('.env') && !basename(source).includes('.before-'),
});
// cpSync deliberately preserves the app directory; remove this opt-in fixture
// from earlier runs so a normal launch contains only the repository engine.
const recoveryHelper = join(directory, 'lib/publisher/engine/recovery-provider.mjs');
rmSync(recoveryHelper, { force: true });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'eslint.config.mjs']) if (existsSync(join(repo, file))) cpSync(join(repo, file), join(directory, file));
if (!existsSync(join(directory, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(directory, 'node_modules'), 'dir');
const guard = join(local.directory, 'network-guard.cjs');
cpSync(join(repo, 'tests/publisher/network-guard.cjs'), guard);
const control = join(local.directory, 'provider-control.txt');
if (!existsSync(control)) writeFileSync(control, '', { mode: 0o600 });
const buildLog = join(local.directory, 'build.private.log'), serverLog = join(local.directory, 'server.private.log');
const dev = process.argv.includes('--dev');
const recoveryProbe = process.argv.includes('--recovery-probe');
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8',
  NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: dev ? 'development' : 'production', NODE_OPTIONS: `--require=${guard}`,
  PUBLISHER_TEST_ACK: local.acknowledgement,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  NEXT_PUBLIC_PUBLISHER_DEMO: '1',
  PUBLISHER_DATABASE_URL: status.PUBLISHER_DATABASE_URL,
  PUBLISHER_LOCAL_SIMULATION: '1', PUBLISHER_LOCAL_MEDIA_DIR: join(local.directory, 'media'),
  PUBLISHER_SIMULATION_CONTROL_FILE: control, PUBLISHER_SIMULATION_DELAY_MS: '300',
};
// No service-role/invitation key, provider credential, legacy password or SMTP setting.
const sourceHashes = {};
function inventory(folder) {
  for (const entry of readdirSync(join(directory, folder), { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) inventory(path);
    else if (entry.isFile()) sourceHashes[path] = createHash('sha256').update(readFileSync(join(directory, path))).digest('hex');
  }
}
for (const folder of ['app', 'components', 'lib']) inventory(folder);
const manifest = { app: local.app, directory, launcherPID: process.pid, status: dev ? 'starting' : 'building', mode: dev ? 'development' : 'production', auth: 'real local Supabase', generation: 'simulated external transport', networkGuard: 'loopback-only', sourceHashes, buildLog, serverLog, startedAt: new Date().toISOString() };
if (recoveryProbe) {
  // Instrument the disposable copy only. sourceHashes above remain the hashes
  // of the original product; this explicit record identifies every fixture edit.
  const relativeProvider = 'lib/publisher/engine/provider.js';
  const provider = join(directory, relativeProvider);
  let code = readFileSync(provider, 'utf8');
  for (const [needle, kind] of [
    ['responses: { parse: async request => {\n      await paid();', 'text'],
    ['images: { generate: async request => {\n      await paid();', 'image'],
  ]) {
    assert.equal(code.split(needle).length - 1, 1, `Recovery fixture must match exactly one ${kind} provider entry`);
    code = code.replace(needle, needle.replace('await paid();', `await recoveryProviderEntry('${kind}');\n      await paid();`));
  }
  code = "import { recoveryProviderEntry } from './recovery-provider.mjs';\n" + code;
  writeFileSync(provider, code);
  cpSync(join(repo, 'tests/publisher/recovery-provider.mjs'), recoveryHelper);
  const recoveryControl = join(local.directory, 'recovery-control.txt');
  const recoveryTrace = join(local.directory, 'recovery-provider.jsonl');
  for (const file of [recoveryControl, recoveryTrace]) if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600 });
  env.PUBLISHER_RECOVERY_PROBE = '1';
  manifest.fixtureAdapter = {
    name: 'recovery-provider-entry-v1', control: recoveryControl, trace: recoveryTrace,
    scope: 'simulated provider entry only; normal authorization remains after the hold',
    sourceHashesAre: 'original product before fixture instrumentation',
    files: {
      [relativeProvider]: { sourceSha256: sourceHashes[relativeProvider], runtimeSha256: createHash('sha256').update(code).digest('hex') },
      'lib/publisher/engine/recovery-provider.mjs': { source: 'tests/publisher/recovery-provider.mjs', runtimeSha256: createHash('sha256').update(readFileSync(recoveryHelper)).digest('hex') },
    },
  };
}
const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save(); assert.equal(statSync(manifestFile).mode & 0o077, 0);
let child;
function sanitize(text) { return text.replaceAll(status.ANON_KEY, '[LOCAL PUBLIC KEY]').replaceAll(status.SERVICE_ROLE_KEY, '[LOCAL SERVICE KEY]').replaceAll(status.PUBLISHER_DATABASE_URL, '[LOCAL DATABASE]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'); }
function launch(args, log) {
  child = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { text += String(data); writeFileSync(log, sanitize(text), { mode: 0o600 }); });
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child?.kill(signal));
if (!dev) {
  const built = await launch(['build', '--webpack'], buildLog);
  if (built.code !== 0) { manifest.status = 'build-failed'; save(); throw new Error(`Local build failed; ${buildLog}`); }
  manifest.buildID = readFileSync(join(directory, '.next/BUILD_ID'), 'utf8').trim();
}
const running = launch(dev ? ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3173'] : ['start', '--hostname', '127.0.0.1', '--port', '3173'], serverLog);
manifest.serverPID = child.pid; manifest.status = 'starting'; save();
for (let attempt = 0; attempt < 150; attempt++) {
  try {
    const response = await fetch(local.app + '/api/publisher?action=session', { redirect: 'error', signal: AbortSignal.timeout(1500) });
    if (response.status === 401) { manifest.status = 'ready'; save(); break; }
  } catch { /* Local app compiling/starting. */ }
  if (child.exitCode !== null) break;
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (manifest.status !== 'ready') { child.kill('SIGTERM'); manifest.status = 'failed'; save(); throw new Error(`Local server did not become ready; ${serverLog}`); }
console.log(JSON.stringify({ ready: true, app: local.app, mode: manifest.mode, realAuth: true, externalGeneration: 'simulated', manifest: manifestFile }));
const result = await running;
manifest.status = 'stopped'; manifest.exitCode = result.code; manifest.serverPID = null; save();
process.exitCode = result.code || 0;
