/** Reuse the retained cache benchmark and its reviewed build. No seed/build/SQL.
 * --start stays alive until SIGINT/SIGTERM, then stops only its own services.
 * --stop verifies the recorded live launcher identity before requesting shutdown.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, statSync, writeFileSync
} from 'node:fs';
import { assertLocalDocker, assertLocalTarget } from './local-target.mjs';

const script = fileURLToPath(import.meta.url), repo = resolve(dirname(script), '../..');
const project = 'izord-local-stack-5hxub2', app = 'http://127.0.0.1:3159';
const expectedBuildID = 'QJC2_XWQqx3wgnAyz5FtU';
const expectedCompiledDiagnostic = 'ba63004df9abeb39f27d981985c635d3b2d4826536979b8876ef581fde51eb37';
const expectedBuildLog = 'f574a477952a6f0ab1c0ffe4e8988499930cbbef5c9fbdad532c585763dbc305';
const volumes = ['supabase_db_' + project, 'supabase_storage_' + project];
const serviceNames = ['storage', 'rest', 'inbucket', 'auth', 'kong', 'db']
  .map(name => 'supabase_' + name + '_' + project).sort();
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = path => hash(readFileSync(path));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const delay = ms => new Promise(done => setTimeout(done, ms));
class SafeReportError extends Error {}
function need(condition, message) {
  if (!condition) throw new SafeReportError(message);
}
function privateFile(path, value) {
  writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600);
}
function privateJSON(path, value) { privateFile(path, JSON.stringify(value, null, 2)); }
function publicJSON(path, value) { writeFileSync(path, JSON.stringify(value, null, 2)); }
function privateMode(path) {
  need(statSync(path).isFile() && (statSync(path).mode & 0o077) === 0, 'Private input must be a private regular file');
}
function processIdentity(pid) {
  need(Number.isSafeInteger(pid) && pid > 1, 'Invalid owned process id');
  const read = field => execFileSync('/bin/ps', ['-p', String(pid), '-o', field + '='],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return { command: read('command'), started: read('lstart') };
}
async function portState(port) {
  return new Promise((done, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done('open'); });
    socket.once('error', error => {
      socket.destroy();
      const code = 'code' in error ? String(error.code) : 'unknown';
      if (code === 'ECONNREFUSED') done('closed');
      else reject(new SafeReportError('Local port check failed: ' + code));
    });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('Local port check timed out')); });
  });
}
async function portsState() {
  return Object.fromEntries(await Promise.all([3159, 55431, 55432, 55434]
    .map(async port => [port, await portState(port)])));
}
async function waitBounded(promise, milliseconds) {
  let timer;
  try { await Promise.race([promise, new Promise(done => { timer = setTimeout(done, milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function context() {
  need(process.argv.length === 3 && ['--start', '--stop'].includes(process.argv[2]), 'Use exactly --start or --stop');
  assertLocalDocker(process.env);
  const requested = process.env.IZORD_LOCAL_WORKDIR || process.env.IZORD_EXISTING_STACK;
  need(requested, 'Existing local workdir required');
  const dir = realpathSync(requested);
  if (process.env.IZORD_LOCAL_WORKDIR && process.env.IZORD_EXISTING_STACK)
    need(realpathSync(process.env.IZORD_LOCAL_WORKDIR) === realpathSync(process.env.IZORD_EXISTING_STACK), 'Conflicting local workdirs');
  privateMode(join(dir, 'manifest.json'));
  const manifest = json(join(dir, 'manifest.json'));
  need(realpathSync(manifest.dir) === dir && manifest.project === project && manifest.network === project + '-loopback', 'Unexpected retained benchmark');
  assertLocalTarget({ ...manifest, acknowledgement: process.env.IZORD_TEST_ACK });
  need(statSync(join(process.env.HOME, '.colima/default/docker.sock')).isSocket(), 'Explicit Colima socket missing');
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    DOCKER_HOST: process.env.DOCKER_HOST, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'
  };
  return { dir, manifest, env, runManifest: join(dir, 'live-app-playwright.json') };
}

async function stopOwned(ctx) {
  privateMode(ctx.runManifest);
  const recorded = json(ctx.runManifest);
  need(recorded.project === project && recorded.script === script, 'Foreign launcher manifest');
  if (recorded.status === 'stopped') { console.log('ALREADY STOPPED retained cache benchmark'); return; }
  need(['starting', 'ready', 'stopping'].includes(recorded.status), 'Launcher is not in a stoppable state');
  const observed = processIdentity(recorded.launcherPID);
  need(observed.command === recorded.launcherIdentity.command && observed.started === recorded.launcherIdentity.started,
    'Recorded launcher pid was replaced; refusing to signal it');
  need(observed.command.includes('cache-playwright-services.mjs') && observed.command.includes('--start'), 'Unexpected launcher command');
  if (recorded.status !== 'stopping') process.kill(recorded.launcherPID, 'SIGTERM');
  for (let n = 0; n < 240; n++) {
    const current = json(ctx.runManifest);
    need(current.runID === recorded.runID, 'Launcher manifest changed during shutdown');
    if (current.status === 'stopped') { console.log('STOPPED retained cache benchmark; volumes preserved'); return; }
    need(current.status !== 'cleanup-failed', 'Owned cleanup failed; inspect sanitized lifecycle proof');
    await delay(500);
  }
  throw new Error('Owned shutdown timed out; no other process was signalled');
}

function verifyBuild(ctx) {
  const sourceManifest = join(ctx.dir, 'live-app-lint-cdp.json');
  privateMode(sourceManifest);
  const original = json(sourceManifest), dir = realpathSync(original.directory);
  need(original.app === app && original.status === 'stopped' && original.simulation === 'Google transport only', 'Previous build is not a stopped reviewed local build');
  need(dir.endsWith('/izord-live-app-bhaRM0'), 'Unexpected preserved application directory');
  need(original.node === process.version, 'Node differs from the reviewed build');
  need(realpathSync(join(dir, 'node_modules')) === realpathSync(join(repo, 'node_modules')), 'Unexpected build dependency target');
  for (const name of readdirSync(dir)) need(!name.startsWith('.env'), 'Environment file found in preserved build');
  const versions = Object.fromEntries(['next', 'react', 'react-dom'].map(name =>
    [name, json(join(repo, 'node_modules', name, 'package.json')).version]));
  need(JSON.stringify(versions) === JSON.stringify(original.versions), 'Installed runtime versions changed');
  const sourcePaths = [], copyPaths = [];
  function walk(root, folder, collected) {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      need(!entry.name.startsWith('.env'), 'Environment file found among product sources');
      if (entry.name.includes('.before-')) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(root, path, collected);
      else { need(!entry.isSymbolicLink(), 'Unexpected product symlink'); collected.push(path); }
    }
  }
  for (const folder of ['app', 'components', 'lib', 'public']) {
    walk(repo, folder, sourcePaths); walk(dir, folder, copyPaths);
  }
  const googleCopy = join('app', 'api', 'drive', '_localGoogleFixture.ts');
  need(JSON.stringify(sourcePaths.slice().sort()) === JSON.stringify(copyPaths.filter(path => path !== googleCopy).sort()), 'Preserved product file inventory differs');
  const source = readFileSync(join(repo, 'app/api/drive/_utils.ts'), 'utf8');
  const start = source.indexOf('export function createGoogleDriveFetch(');
  const end = source.indexOf('\nasync function verifySupabaseAccessToken(', start);
  const authEnd = source.indexOf('\nexport function escapeDriveQuery', end);
  need(start > 0 && end > start && authEnd > end, 'Google/Auth substitution boundaries missing');
  const expected = 'import { createFixtureGoogleDriveFetch } from "./_localGoogleFixture";\n' + source.slice(0, start)
    + 'export function createGoogleDriveFetch(): DriveFetch { return createFixtureGoogleDriveFetch(); }\n' + source.slice(end);
  need(readFileSync(join(dir, 'app/api/drive/_utils.ts'), 'utf8') === expected, 'Google-only transport substitution differs');
  const authSHA256 = hash(source.slice(end, authEnd));
  need(authSHA256 === original.actualJWTAuthGuardSHA256, 'Actual JWT authorization guard changed');
  need(fileHash(join(dir, googleCopy)) === fileHash(join(repo, 'tests/izord/google-transport-fixture.ts')), 'Google fixture changed');
  need(fileHash(join(dir, 'local-network-guard.cjs')) === fileHash(join(repo, 'tests/izord/local-network-guard.cjs')), 'Network guard changed');
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs', 'eslint.config.mjs']) sourcePaths.push(path);
  const hashes = sourcePaths.sort().map(path => {
    const sourceSHA256 = fileHash(join(repo, path)), copySHA256 = fileHash(join(dir, path));
    need(path === 'app/api/drive/_utils.ts' || sourceSHA256 === copySHA256, 'Product or build configuration changed: ' + path);
    return { path, sourceSHA256, copySHA256, googleTransportOnly: path === 'app/api/drive/_utils.ts' };
  });
  const normalizeNextEnv = value => value.replace(/^import "\.\/\.next\/types\/(routes|root-params)\.d\.ts";\n/gm, '')
    .replace('https://nextjs.org/docs/app/api-reference/config/typescript', 'https://nextjs.org/docs/app/building-your-application/configuring/typescript');
  need(normalizeNextEnv(readFileSync(join(repo, 'next-env.d.ts'), 'utf8')) === normalizeNextEnv(readFileSync(join(dir, 'next-env.d.ts'), 'utf8')), 'Unexpected generated Next types difference');
  for (const entry of original.sourceFiles) need(fileHash(join(repo, entry.path)) === entry.sha256, 'Source differs from original build manifest');
  const buildID = readFileSync(join(dir, '.next/BUILD_ID'), 'utf8').trim();
  need(buildID === expectedBuildID, 'Unexpected preserved Next build');
  need(fileHash(join(dir, '.next/server/app/api/drive/diagnostic/route.js')) === expectedCompiledDiagnostic, 'Compiled diagnostic differs from reviewed build');
  need(fileHash(original.buildLog) === expectedBuildLog, 'Original build proof changed');
  privateMode(join(ctx.dir, 'local-status.json'));
  const status = json(join(ctx.dir, 'local-status.json'));
  assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app, mail: ctx.manifest.mail, acknowledgement: process.env.IZORD_TEST_ACK });
  need(typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 16, 'Local compiled public key missing');
  let compiledKeyMatches = false, compiledAPIMatches = false;
  function inspectChunks(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) inspectChunks(path);
      else if (entry.name.endsWith('.js')) {
        const content = readFileSync(path, 'utf8');
        compiledKeyMatches ||= content.includes(status.ANON_KEY);
        compiledAPIMatches ||= content.includes(status.API_URL);
      }
    }
  }
  inspectChunks(join(dir, '.next/static'));
  need(compiledKeyMatches && compiledAPIMatches, 'Preserved browser bundles do not match the local API/public key');
  return {
    dir, original, buildID, versions, hashes, authSHA256,
    networkGuardSHA256: fileHash(join(dir, 'local-network-guard.cjs')),
    generatedNextEnv: { sourceSHA256: fileHash(join(repo, 'next-env.d.ts')), copySHA256: fileHash(join(dir, 'next-env.d.ts')) }
  };
}

async function startOwned(ctx) {
  need(process.env.SUPABASE_BIN && statSync(process.env.SUPABASE_BIN).isFile(), 'Existing Supabase CLI required');
  need(process.env.IZORD_ARTIFACTS, 'New artifact directory required');
  if (existsSync(ctx.runManifest)) need(['stopped', 'cleanup-failed'].includes(json(ctx.runManifest).status), 'Previous launcher has not stopped');
  const out = resolve(process.env.IZORD_ARTIFACTS);
  mkdirSync(out, { recursive: true });
  need(!existsSync(join(out, 'lifecycle.json')) && !existsSync(join(out, 'server.log')), 'Use a new artifact directory');
  const build = verifyBuild(ctx);
  const runID = randomUUID(), privateDir = join(ctx.dir, 'playwright-services-' + runID);
  mkdirSync(privateDir, { mode: 0o700 });
  const lifecycle = { runID, project, startedAt: new Date().toISOString(), events: [], noBuildSeedMigrationOrSQL: true, coldStartProcessOnly: true };
  const manifest = {
    runID, project, script, app, directory: build.dir, originalManifest: join(ctx.dir, 'live-app-lint-cdp.json'),
    status: 'starting', launcherPID: process.pid, launcherIdentity: processIdentity(process.pid),
    privateDir, artifacts: out, buildID: build.buildID, versions: build.versions, node: process.version,
    bundler: 'webpack', sourceFiles: build.hashes.map(item => ({ path: item.path, sha256: item.copySHA256 })),
    actualJWTAuthGuardSHA256: build.authSHA256,
    startedAt: lifecycle.startedAt, googleTraceFile: join(privateDir, 'google-simulation.jsonl'),
    serverLog: join(privateDir, 'server.private.log'), simulation: 'Google transport only'
  };
  let phase = 'preflight', nextChild, cliChild, stackAttempted = false, stopRequested = false, status;
  let resolveStop;
  const stopSignal = new Promise(done => { resolveStop = done; });
  function save() { privateJSON(ctx.runManifest, manifest); publicJSON(join(out, 'lifecycle.json'), lifecycle); }
  function event(name, detail = {}) { lifecycle.events.push({ event: name, at: new Date().toISOString(), ...detail }); save(); }
  const requestStop = signal => {
    if (stopRequested) return;
    stopRequested = true; event('stop-requested', { signal });
    if (phase !== 'cleanup') cliChild?.kill('SIGTERM');
    resolveStop();
  };
  const onInterrupt = () => requestStop('SIGINT'), onTerminate = () => requestStop('SIGTERM');
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  const docker = args => execFileSync('/opt/homebrew/bin/docker', args,
    { env: ctx.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const containers = () => docker(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort();
  const ownNames = () => docker(['ps', '-a', '--filter', 'label=com.supabase.cli.project=' + project, '--format', '{{.Names}}']).split('\n').filter(Boolean).sort();
  const volumeInfo = () => volumes.map(name => JSON.parse(docker(['volume', 'inspect', '--format',
    '{"name":{{json .Name}},"createdAt":{{json .CreatedAt}},"driver":{{json .Driver}}}', name])));
  async function cli(args, basename) {
    const logfile = join(privateDir, basename);
    privateFile(logfile, '');
    const result = await new Promise((done, reject) => {
      cliChild = spawn(process.env.SUPABASE_BIN, args, { env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      cliChild.stdout.on('data', data => { stdout += String(data); appendFileSync(logfile, data); });
      cliChild.stderr.on('data', data => appendFileSync(logfile, data));
      const timer = setTimeout(() => cliChild?.kill('SIGTERM'), 180000);
      cliChild.once('error', () => { clearTimeout(timer); cliChild = null; reject(new Error('Local CLI could not start')); });
      cliChild.once('exit', (code, signal) => { clearTimeout(timer); cliChild = null; done({ code, signal, stdout }); });
    });
    need(result.code === 0, 'Local CLI failed; private diagnostic retained');
    return result.stdout;
  }
  const redact = value => {
    let safe = String(value);
    for (const key of ['ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL']) if (status?.[key]) safe = safe.replaceAll(status[key], '[LOCAL CREDENTIAL REDACTED]');
    return safe.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]')
      .replaceAll(ctx.dir, '[PRIVATE_STACK]').replaceAll(build.dir, '[PRESERVED_BUILD]');
  };
  let nextExit, nextExited = false;
  save();
  try {
    const version = JSON.parse(docker(['version', '--format', '{{json .}}']));
    need(version.Client && version.Server, 'Local Docker server unavailable');
    lifecycle.engine = { explicitColimaSocket: true, client: version.Client.Version, server: version.Server.Version, api: version.Client.ApiVersion, overridesAbsent: true };
    lifecycle.portsBefore = await portsState();
    need(Object.values(lifecycle.portsBefore).every(state => state === 'closed'), 'Cold start requires all benchmark ports closed');
    need(ownNames().length === 0, 'Cold start requires benchmark containers absent');
    lifecycle.foreignContainersBefore = containers(); lifecycle.volumesBefore = volumeInfo();
    need(!stopRequested, 'Stopped before service startup');
    const networks = docker(['network', 'ls', '--format', '{{.Name}}']).split('\n');
    if (!networks.includes(ctx.manifest.network)) docker(['network', 'create', '--label', 'izord.disposable=' + project,
      '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', ctx.manifest.network]);
    const network = JSON.parse(docker(['network', 'inspect', ctx.manifest.network]))[0];
    need(network.Labels?.['izord.disposable'] === project && network.Options?.['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1'
      && Object.keys(network.Containers || {}).length === 0, 'Network is not the empty dedicated loopback benchmark');
    phase = 'supabase-start'; stackAttempted = true; event('supabase-start');
    await cli(['start', '--workdir', ctx.dir, '--network-id', ctx.manifest.network,
      '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], 'supabase-start.private.log');
    need(!stopRequested, 'Stop requested while starting services');
    const names = ownNames(); need(JSON.stringify(names) === JSON.stringify(serviceNames), 'Unexpected benchmark services');
    lifecycle.services = names.map(name => {
      const info = JSON.parse(docker(['inspect', '--format',
        '{"state":{{json .State.Status}},"network":{{json .NetworkSettings}}}', name]));
      need(info.state === 'running' && info.network.Networks[ctx.manifest.network], 'Service not running on dedicated network');
      const ports = Object.values(info.network.Ports || {}).flatMap(value => value || []);
      need(ports.every(port => port.HostIp === '127.0.0.1'), 'Service published beyond loopback');
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', name]));
      const expectedVolume = name === 'supabase_db_' + project ? volumes[0]
        : name === 'supabase_storage_' + project ? volumes[1] : null;
      if (expectedVolume) need(mounts.some(mount => mount.Type === 'volume' && mount.Name === expectedVolume), 'Service is not using its retained volume');
      return { name, state: info.state, ports, ...(expectedVolume ? { retainedVolume: expectedVolume } : {}) };
    });
    const statusText = await cli(['status', '--workdir', ctx.dir, '--output', 'json'], 'supabase-status.private.log');
    status = JSON.parse(statusText);
    assertLocalTarget({ api: status.API_URL, database: status.DB_URL, app, mail: ctx.manifest.mail, acknowledgement: process.env.IZORD_TEST_ACK });
    privateMode(join(ctx.dir, 'local-status.json'));
    const previousStatus = json(join(ctx.dir, 'local-status.json'));
    need(status.API_URL === previousStatus.API_URL && status.ANON_KEY === previousStatus.ANON_KEY, 'Compiled local API/public key changed');
    privateFile(join(ctx.dir, 'local-status.json'), statusText);
    event('supabase-ready', { existingVolumesReused: true });
    need(!stopRequested, 'Stop requested before app startup');
    publicJSON(join(out, 'source-manifest.json'), {
      runID, observedAt: new Date().toISOString(), buildID: build.buildID, versions: build.versions, node: process.version,
      reusedBuild: true, rebuilt: false, simulation: manifest.simulation, authGuardSHA256: build.authSHA256,
      networkGuardSHA256: build.networkGuardSHA256, sourceFiles: build.hashes,
      generatedNextEnvOnly: true, generatedNextEnv: build.generatedNextEnv, compiledLocalAPIAndPublicKeyMatched: true,
      originalBuildLogSHA256: expectedBuildLog, compiledDiagnosticSHA256: expectedCompiledDiagnostic
    });
    privateFile(manifest.googleTraceFile, ''); privateFile(manifest.serverLog, ''); writeFileSync(join(out, 'server.log'), '');
    const env = {
      PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8',
      NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', NODE_OPTIONS: '--require=' + join(build.dir, 'local-network-guard.cjs'),
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      IZORD_TEST_ACK: 'IZORD_DISPOSABLE_LOCAL_ONLY', IZORD_GOOGLE_TRACE_FILE: manifest.googleTraceFile,
      GCP_PROJECT_ID: 'fictional-local-project', GCP_SERVICE_ACCOUNT_EMAIL: 'fixture@fictional-local-project.iam.gserviceaccount.com',
      GOOGLE_DRIVE_SHARED_DRIVE_ID: 'fixture-shared-drive', GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: 'fixture-documents-root',
      GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID: 'fixture-vendors-root'
    };
    phase = 'next-start';
    nextChild = spawn(process.execPath, [join(repo, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3159'],
      { cwd: build.dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    manifest.serverPID = nextChild.pid; event('next-start');
    for (const stream of [nextChild.stdout, nextChild.stderr]) {
      let pending = '';
      stream.on('data', chunk => {
        appendFileSync(manifest.serverLog, chunk); pending += String(chunk);
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          appendFileSync(join(out, 'server.log'), redact(pending.slice(0, end + 1))); pending = pending.slice(end + 1);
        }
      });
      stream.on('end', () => { if (pending) appendFileSync(join(out, 'server.log'), redact(pending)); });
    }
    nextExit = new Promise(done => {
      nextChild.once('error', () => { nextExited = true; manifest.serverExit = { code: null, signal: 'spawn-error' }; resolveStop(); done(); });
      nextChild.once('exit', (code, signal) => { nextExited = true; manifest.serverExit = { code, signal }; resolveStop(); done(); });
    });
    let ready = false;
    for (let n = 0; n < 100 && !stopRequested && !nextExited; n++) {
      try {
        const response = await fetch(app + '/api/drive/diagnostic', { redirect: 'error', signal: AbortSignal.timeout(1000) });
        if (response.status === 401) { ready = true; break; }
      } catch (error) {
        need(!['EPERM', 'EACCES'].includes(error?.cause?.code || error?.code), 'Permission denied during local readiness check');
        // A refused local connection is normal before Next becomes ready.
      }
      await delay(200);
    }
    need(ready && !stopRequested && !nextExited, 'Preserved application failed readiness');
    manifest.serverIdentity = processIdentity(nextChild.pid);
    manifest.status = 'ready'; manifest.readyAt = new Date().toISOString(); phase = 'serving'; event('ready');
    console.log('READY preserved local app http://127.0.0.1:3159; launcher PID ' + process.pid);
    console.log('Private manifest: ' + ctx.runManifest);
    await stopSignal;
    need(stopRequested, 'Owned Next process exited unexpectedly');
  } catch (error) {
    lifecycle.failure = {
      phase,
      message: error instanceof SafeReportError ? redact(error.message) : 'Internal orchestration operation failed; private diagnostics retained'
    };
    process.exitCode = 1;
  } finally {
    manifest.status = 'stopping'; phase = 'cleanup'; event('cleanup-start');
    const errors = [];
    if (nextChild && !nextExited) {
      nextChild.kill('SIGTERM');
      await waitBounded(nextExit, 10000);
      if (!nextExited) { nextChild.kill('SIGKILL'); await waitBounded(nextExit, 5000); }
      if (!nextExited) errors.push('Owned Next child did not exit');
    }
    if (stackAttempted) {
      try { await cli(['stop', '--workdir', ctx.dir], 'supabase-stop.private.log'); }
      catch { errors.push('Targeted Supabase stop failed; private log retained'); }
    }
    try {
      lifecycle.ownContainersAfter = ownNames();
      lifecycle.volumesAfter = volumeInfo();
      lifecycle.portsAfter = await portsState();
      lifecycle.foreignContainersAfter = containers();
      lifecycle.volumesPreserved = JSON.stringify(lifecycle.volumesBefore) === JSON.stringify(lifecycle.volumesAfter);
      lifecycle.foreignContainersUnchanged = JSON.stringify(lifecycle.foreignContainersBefore) === JSON.stringify(lifecycle.foreignContainersAfter);
      if (lifecycle.ownContainersAfter.length) errors.push('Owned containers remain');
      if (!lifecycle.volumesPreserved) errors.push('Retained volume inventory differs');
      if (!lifecycle.foreignContainersUnchanged) errors.push('Foreign container inventory differs');
      if (Object.values(lifecycle.portsAfter).some(state => state !== 'closed')) errors.push('A benchmark port remains open');
    } catch { errors.push('Final Docker/port verification failed'); }
    lifecycle.cleanupErrors = errors; lifecycle.networkRetained = true; lifecycle.noVolumeDeletion = true;
    lifecycle.stoppedAt = new Date().toISOString();
    manifest.status = errors.length ? 'cleanup-failed' : 'stopped'; manifest.stoppedAt = lifecycle.stoppedAt;
    if (errors.length) process.exitCode = 1;
    event(manifest.status);
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    console.log(manifest.status === 'stopped' ? 'STOPPED owned services; retained volumes preserved' : 'Cleanup requires review; sanitized lifecycle proof retained');
  }
}

try {
  const ctx = context();
  if (process.argv[2] === '--stop') await stopOwned(ctx);
  else await startOwned(ctx);
} catch {
  // Never print arbitrary SDK/CLI output or private manifests on a guard failure.
  console.error('Service orchestration refused or failed. Check the invocation and sanitized lifecycle proof, if created.');
  process.exitCode = 1;
}
