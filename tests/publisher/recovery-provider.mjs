/** Copied only by serve.mjs --recovery-probe into the disposable engine.
 * This observes simulated provider entries and holds them while the browser's
 * Auth verification is interrupted. Product authorization still runs afterward.
 */
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { currentOperation } from './context.js';
import { localSimulation } from './env.js';

const directory = '/private/tmp/crm-publisher-local';
const control = `${directory}/recovery-control.txt`;
const trace = `${directory}/recovery-provider.jsonl`;
const timeout = 60_000;

export async function recoveryProviderEntry(kind) {
  assert.equal(process.env.PUBLISHER_TEST_ACK, 'PUBLISHER_DISPOSABLE_LOCAL_ONLY');
  assert.equal(process.env.PUBLISHER_RECOVERY_PROBE, '1');
  assert.equal(localSimulation(), true, 'Recovery fixture requires isolated local simulation');
  assert.ok(kind === 'text' || kind === 'image');
  const { requestId } = currentOperation();
  assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await appendFile(trace, JSON.stringify({ requestId, kind, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  const deadline = Date.now() + timeout;
  while ((await readFile(control, 'utf8')).trim() === 'hold') {
    if (Date.now() >= deadline) throw new Error('Local recovery fixture hold exceeded 60 seconds');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
