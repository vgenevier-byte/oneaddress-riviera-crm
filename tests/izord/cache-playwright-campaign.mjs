/** Exactly three sequential complete runs, zero retries, stop after any failure.
 * Services must already be cold-started by the separately owned service launcher.
 * This parent records the actual runner exit code/signal without browser secrets.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

assert.equal(process.env.IZORD_TEST_ACK, 'IZORD_DISPOSABLE_LOCAL_ONLY');
assert.ok(process.env.IZORD_ARTIFACTS, 'Explicit new campaign output directory required');
const out = resolve(process.env.IZORD_ARTIFACTS);
mkdirSync(out, { recursive: true, mode: 0o700 });
const summaryPath = join(out, 'campaign.json');
assert.equal(existsSync(summaryPath), false, 'Never replace a preceding campaign');
for (let run = 1; run <= 3; run++) assert.equal(existsSync(join(out, `run-${run}`)), false);
const runner = resolve('tests/izord/cache-lifecycle.playwright.mjs');
const runnerSHA256 = createHash('sha256').update(readFileSync(runner)).digest('hex');
const startedAt = new Date().toISOString();
/** @type {{run:number,status:string,startedAt?:string,endedAt?:string,durationMs?:number,pid?:number,exitCode?:number|null,signal?:string|null}[]} */
const runs = [1, 2, 3].map(run => ({ run, status: 'not executed' }));
const record = () => writeFileSync(summaryPath, JSON.stringify({
  startedAt, updatedAt: new Date().toISOString(), plannedRuns: 3, retries: 0,
  execution: 'sequential; one fresh browser/context per complete run; same context across accounts/tabs',
  runnerSHA256, ownerPID: process.pid, runs
}, null, 2) + '\n', { mode: 0o600 });
record();
let activeChild;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  activeChild?.kill(signal);
});
for (const result of runs) {
  if (interrupted) break;
  const runOut = join(out, `run-${result.run}`);
  mkdirSync(runOut, { mode: 0o700 });
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'DOCKER_HOST', 'IZORD_TEST_ACK', 'IZORD_LOCAL_WORKDIR',
    'LOCAL_STATUS_FILE', 'LOCAL_FIXTURE_FILE', 'IZORD_APP_MANIFEST_FILE', 'IZORD_PLAYWRIGHT_RUNTIME'])
    if (process.env[key]) env[key] = process.env[key];
  env.IZORD_ARTIFACTS = runOut;
  result.status = 'running'; result.startedAt = new Date().toISOString();
  const begin = Date.now();
  const child = spawn(process.execPath, [runner], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  activeChild = child; result.pid = child.pid; record();
  // The runner owns redaction; these streams must never receive credentials/session payloads.
  /** @type {[import('node:stream').Readable, string][]} */
  const streams = [[child.stdout, 'runner-stdout.log'], [child.stderr, 'runner-stderr.log']];
  for (const [stream, name] of streams) {
    const filename = join(runOut, name);
    writeFileSync(filename, '', { mode: 0o600 });
    stream.on('data', chunk => appendFileSync(filename, chunk));
  }
  const exit = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  activeChild = undefined;
  result.endedAt = new Date().toISOString(); result.durationMs = Date.now() - begin;
  result.exitCode = exit.code; result.signal = exit.signal;
  result.status = exit.code === 0 && !exit.signal ? 'completed' : 'failed';
  record();
  console.log(`Playwright run ${result.run}: ${result.status}; exit=${exit.code}; signal=${exit.signal ?? 'none'}`);
  if (result.status !== 'completed') break;
}
if (runs.some(run => run.status !== 'completed')) process.exitCode = 1;
