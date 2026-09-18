/** Exact-source anonymous browser checks in development and production.
 * No Auth adapter, application hook or business mutation. Real Auth is covered
 * separately by the existing local integration/browser suites.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = process.cwd();
const out = resolve(process.env.IZORD_ARTIFACTS || '/tmp/izord-artifacts');
mkdirSync(out, { recursive: true });
const directory = readFileSync(join(out, 'build-preview-path.txt'), 'utf8').trim();
const sourceHashes = ['lib/supabase.ts', 'app/layout.tsx', 'components/AccessPortal.tsx', 'components/CRMApp.tsx'].map(path => {
  const source = readFileSync(join(repo, path));
  assert.ok(source.equals(readFileSync(join(directory, path))), `Exact source required: ${path}`);
  return { path, sha256: createHash('sha256').update(source).digest('hex') };
});
const base = 'http://127.0.0.1:3159';
const binary = process.env.AGENT_BROWSER_BIN || '/tmp/izord-browser-runtime/node_modules/.bin/agent-browser';
const next = join(repo, 'node_modules/next/dist/bin/next');
const versions = Object.fromEntries(['next', 'react', 'react-dom'].map(name => [name, JSON.parse(readFileSync(join(repo, 'node_modules', name, 'package.json'), 'utf8')).version]));
const browserEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const env = {
  ...browserEnv, NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55431', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fictional-local-build-key',
  IZORD_TEST_ACK: 'IZORD_DISPOSABLE_LOCAL_ONLY', NODE_OPTIONS: `--require=${join(repo, 'tests/izord/local-network-guard.cjs')}`
};
const config = join(out, 'smoke-browser-config.json');
writeFileSync(config, '{}');
const pause = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const results = [];
for (const mode of ['development', 'production']) {
  const report = { mode, versions, node: process.version, bundler: 'webpack', sourceHashes, checks: [], icons: [], console: [], exceptions: [], failedHTTP: [], remoteAttempts: [], failures: [] };
  const browserSession = `izord-next-smoke-${mode}-${process.pid}`;
  const ab = (...args) => execFileSync(binary, ['--config', config, '--session', browserSession, ...args], { env: browserEnv, encoding: 'utf8', timeout: 45000 }).trim();
  const args = mode === 'development' ? ['dev', '--webpack'] : ['start'];
  const child = spawn(process.execPath, [next, ...args, '--hostname', '127.0.0.1', '--port', '3159'], { cwd: directory, env: { ...env, NODE_ENV: mode }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '', socket, sessionId, requestId = 0;
  const pending = new Map();
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { serverLog += chunk; });
  const safe = value => String(value).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]');
  const send = (method, params = {}, session = sessionId) => new Promise((resolveCommand, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: resolveCommand, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error('Smoke evaluation failed');
    return result.result.value;
  };
  async function waitFor(test, label, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await test()) return; if (child.exitCode !== null) throw Error('Owned server exited'); await pause(150); }
    throw Error(`Timed out: ${label}`);
  }
  async function check(label, action) {
    try { await action(); report.checks.push(label); console.log(`PASS ${mode}: ${label}`); }
    catch (error) { report.failures.push({ label, error: safe(error.message) }); console.log(`FAIL ${mode}: ${label}`); }
  }
  try {
    await waitFor(() => serverLog.includes('Ready'), 'owned local server ready');
    ab('--allowed-domains', '127.0.0.1', 'open', base + '/spaces');
    const endpoint = ab('get', 'cdp-url');
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:/);
    socket = new WebSocket(endpoint);
    await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const data = JSON.parse(String(event.data));
      if (data.id) { const command = pending.get(data.id); if (command) { clearTimeout(command.timeout); pending.delete(data.id); data.error ? command.reject(Error(`CDP operation rejected: ${data.error.message}`)) : command.resolve(data.result); } return; }
      if (data.sessionId !== sessionId) return;
      const params = data.params;
      if (data.method === 'Runtime.exceptionThrown') report.exceptions.push(safe(params.exceptionDetails.text));
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = safe(params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
        if (params.type === 'error' || /hydrat|did not match|server rendered HTML/i.test(text)) report.console.push({ type: params.type, text });
      }
      if (data.method === 'Log.entryAdded' && params.entry.level === 'error') report.console.push({ type: 'log-error', text: safe(params.entry.text) });
      if (data.method === 'Network.responseReceived' && params.response.status >= 400) { const url = new URL(params.response.url); report.failedHTTP.push({ path: url.pathname + url.search, status: params.response.status }); }
      if (data.method === 'Network.requestWillBeSent') {
        const url = new URL(params.request.url);
        if (['http:', 'https:'].includes(url.protocol) && (url.hostname !== '127.0.0.1' || !['3159', '55431'].includes(url.port))) report.remoteAttempts.push(url.origin + url.pathname);
      }
    });
    const targets = await send('Target.getTargets', {}, null);
    const target = targets.targetInfos.find(info => info.type === 'page' && info.url.startsWith(base));
    assert.ok(target, 'Owned local browser tab required');
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
    const iconPaths = new Set(['/favicon.ico', '/icon.png', '/favicon.png', '/apple-touch-icon.png']);
    for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      for (const path of ['/', '/spaces', '/izord']) {
        await check(`Anonymous ${path} at ${width}px: individual login, no CRM, no overflow/overlay`, async () => {
          await send('Page.navigate', { url: base + path });
          await waitFor(() => evaluate('document.readyState !== "loading" && !!document.querySelector("input[type=password]")'), 'individual login');
          assert.equal(await evaluate('!!document.querySelector(".nav-list")'), false);
          assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
          assert.equal(await evaluate(`(()=>{const roots=[document];for(let i=0;i<roots.length;i++){if(roots[i].querySelector('[data-nextjs-dialog-overlay],[data-nextjs-error-overlay]'))return true;for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);}return false})()`), false, 'No Next error overlay');
          const hrefs = await evaluate('Array.from(document.querySelectorAll("link[rel~=icon],link[rel=apple-touch-icon]"),link=>link.href)');
          assert.ok(hrefs.length > 0, 'Generated metadata icon required');
          for (const href of hrefs) { const url = new URL(href); assert.equal(url.origin, base, 'Icons must remain local'); iconPaths.add(url.pathname + url.search); }
          ab('screenshot', join(out, `next-${mode}-${path === '/' ? 'root' : path.slice(1)}-${width}.png`));
        });
      }
    }
    for (const path of iconPaths) await check(`Icon ${path}: HTTP 200 and nonempty image`, async () => {
      const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const result = { path, status: response.status, contentType: response.headers.get('content-type'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      report.icons.push(result);
      assert.equal(response.status, 200, path); assert.match(result.contentType || '', /^image\//); assert.ok(bytes.length > 0);
    });
    await pause(300);
    await check('No browser exception, console error, hydration issue, HTTP failure or non-bench request', async () => {
      assert.deepEqual(report.exceptions, []); assert.deepEqual(report.console, []); assert.deepEqual(report.failedHTTP, []); assert.deepEqual(report.remoteAttempts, []); assert.equal(ab('errors'), '');
    });
  } catch (error) { report.failures.push({ label: 'smoke runner', error: safe(error.message) }); }
  finally {
    for (const command of pending.values()) clearTimeout(command.timeout);
    socket?.close(); try { ab('close'); } catch { /* Report remains useful on browser startup failure. */ }
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([exited, pause(5000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    writeFileSync(join(out, `next-${mode}-server.log`), safe(serverLog));
    writeFileSync(join(out, `next-${mode}-smoke.json`), JSON.stringify(report, null, 2));
    results.push(report);
  }
}
writeFileSync(join(out, 'next-smoke-results.json'), JSON.stringify({ kind: 'exact-source anonymous dev/prod; not Auth authorization proof', results }, null, 2));
if (results.some(result => result.failures.length)) process.exitCode = 1;
