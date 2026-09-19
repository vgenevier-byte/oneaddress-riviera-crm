/** Build and serve actual application routes against real local Auth/PostgREST.
 * Only the Google transport is replaced, in a temporary source copy.
 * No .env, production credential, service-role key or deployment is used.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, chmodSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { assertLocalTarget } from '../izord/local-target.mjs';

const repo = process.cwd();
const previous = process.env.UNIFIED_REPLACE_MANIFEST ? JSON.parse(readFileSync(process.env.UNIFIED_REPLACE_MANIFEST,'utf8')) : null;
if(previous && (previous.app !== 'http://127.0.0.1:3160' || !Number.isInteger(previous.serverPID))) throw new Error('Owned local server manifest required');
if (!process.env.LOCAL_STATUS_FILE) throw new Error('LOCAL_STATUS_FILE required');
const status = JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE, 'utf8'));
assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3159', mail: 'http://127.0.0.1:55434', acknowledgement: process.env.IZORD_TEST_ACK });
assert.ok(typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 10, 'Local public key required');
const dir = mkdtempSync(join(tmpdir(), 'crm-unified-app-'));
chmodSync(dir, 0o700);
for (const folder of ['app', 'components', 'lib', 'public']) cpSync(join(repo, folder), join(dir, folder), {
  recursive: true,
  filter: source => !basename(source).startsWith('.env') && !basename(source).includes('.before-')
});
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'eslint.config.mjs']) if (existsSync(join(repo, file))) cpSync(join(repo, file), join(dir, file));
symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
cpSync(join(repo, 'tests/izord/google-transport-fixture.ts'), join(dir, 'app/api/drive/_localGoogleFixture.ts'));
const guard = join(dir, 'local-network-guard.cjs');
writeFileSync(guard, readFileSync(join(repo, 'tests/izord/local-network-guard.cjs'),'utf8').replace('new Set([3159, 55431])','new Set([3160, 55431, 55434])'));
const utilsPath = join(dir, 'app/api/drive/_utils.ts'), original = readFileSync(utilsPath, 'utf8');
const start = original.indexOf('export function createGoogleDriveFetch(');
const end = original.indexOf('\nasync function verifySupabaseAccessToken(', start);
assert.ok(start > 0 && end > start, 'Expected Google factory boundary required');
const substituted = 'export function createGoogleDriveFetch(): DriveFetch { return createFixtureGoogleDriveFetch(); }\n';
const updated = 'import { createFixtureGoogleDriveFetch } from "./_localGoogleFixture";\n' + original.slice(0, start) + substituted + original.slice(end);
const authEnd = original.indexOf('\nexport function escapeDriveQuery', end);
const authSource = original.slice(end, authEnd);
assert.ok(updated.includes(authSource), 'Actual JWT verification and membership guard must remain byte-identical');
writeFileSync(utilsPath, updated);
const trace = join(dir, 'google-simulation.jsonl'), buildLog = join(dir, 'build.log'), serverLog = join(dir, 'server.log');
for (const file of [trace, buildLog, serverLog]) writeFileSync(file, '', { mode: 0o600 });
const manifestPath = resolve(process.env.IZORD_APP_MANIFEST_FILE || join(dirname(process.env.LOCAL_STATUS_FILE), 'live-app.json'));
const sourceFiles = ['components/CRMApp.tsx', 'components/AccessPortal.tsx', 'lib/access/crmCache.ts', 'package.json', 'package-lock.json'].map(path => ({
  path, sha256: createHash('sha256').update(readFileSync(join(dir, path))).digest('hex')
}));
const versions = Object.fromEntries(['next', 'react', 'react-dom'].map(name => [name, JSON.parse(readFileSync(join(repo, 'node_modules', name, 'package.json'), 'utf8')).version]));
const manifest = { app: 'http://127.0.0.1:3160', directory: dir, googleTraceFile: trace, buildLog, serverLog, sourceFiles, node: process.version, versions, bundler: 'webpack', dependencyMode: 'symlink to repository install; npm ci must be proved separately', simulation: 'Google transport only', actualJWTAuthGuardSHA256: createHash('sha256').update(authSource).digest('hex'), status: 'building', launcherPID: process.pid };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
assert.equal(statSync(manifestPath).mode & 0o077, 0, 'Manifest must remain private');
const env = {
  PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8',
  NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', NODE_OPTIONS: `--require=${guard}`,
  LOCAL_AUTH_INVITE_KEY: status.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  IZORD_TEST_ACK: 'IZORD_DISPOSABLE_LOCAL_ONLY', IZORD_GOOGLE_TRACE_FILE: trace,
  GCP_PROJECT_ID: 'fictional-local-project', GCP_SERVICE_ACCOUNT_EMAIL: 'fixture@fictional-local-project.iam.gserviceaccount.com',
  GOOGLE_DRIVE_SHARED_DRIVE_ID: 'fixture-shared-drive', GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: 'fixture-documents-root', GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: 'fixture-vendors-root'
};
let child;
function sanitized(value) { return String(value).replaceAll(status.SERVICE_ROLE_KEY, '[LOCAL INVITE KEY]').replaceAll(status.ANON_KEY, '[LOCAL PUBLIC KEY]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]'); }
function launch(args, log) {
  child = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), ...args], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += String(chunk); writeFileSync(log, sanitized(output), { mode: 0o600 }); });
  return new Promise((resolveExit, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolveExit({ code, signal })); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
const result = await launch(['build', '--webpack'], buildLog);
if (result.code !== 0) { manifest.status = 'build-failed'; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); throw new Error(`Isolated build failed; private log: ${buildLog}`); }
if(previous){try{process.kill(previous.serverPID,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}await new Promise(resolve=>setTimeout(resolve,700));}
manifest.status = 'starting'; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Isolated local app manifest: ${manifestPath}\nActual Auth/RLS; Google transport simulated; loopback http://127.0.0.1:3160`);
const exitPromise = launch(['start', '--hostname', '127.0.0.1', '--port', '3160'], serverLog);
manifest.serverPID = child.pid;
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:3160/api/drive/diagnostic', { redirect: 'error', signal: AbortSignal.timeout(1000) });
    if (response.status === 401) { ready = true; break; }
  } catch { /* The isolated server may still be starting. */ }
  if (child.exitCode !== null) break;
  await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
}
if (ready) {
  manifest.status = 'ready'; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('READY actual local Next application at http://127.0.0.1:3160');
} else {
  child.kill('SIGTERM');
  manifest.status = 'server-failed'; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  throw new Error(`Local application failed to become ready; private log: ${serverLog}`);
}
const exit = await exitPromise;
manifest.status = 'stopped'; manifest.exitCode = exit.code; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
process.exitCode = exit.code || 0;
