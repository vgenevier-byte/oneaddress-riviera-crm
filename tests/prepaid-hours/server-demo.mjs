/** Create a requested UI demonstration state using actual local Auth/RPC only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sql, directory, rpc, login } from './server-local.mjs';
const fixture = JSON.parse(readFileSync(join(directory, 'fixtures.private.json'), 'utf8'));
const command = process.argv[2]; assert.ok(['first','renew'].includes(command));
await connect();
try {
 fixture.users.owner.token = await login(fixture.users.owner);
 const token = fixture.users.owner.token;
 const allowed = async operation => { const r = await operation; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
 let state = await allowed(rpc('crm_house_prepaid_state', token));
 const save = (action, patch) => allowed(rpc('crm_save_house_prepaid', token, { p_revision: state.revision, p_request_id: randomUUID(), p_action: action, p_patch: patch }));
 if (command === 'first') {
  assert.equal(state.packages.length, 0, 'Run server-reset first to create initial fictional state');
  state = await save('settings', { workerId: 'worker-prepaid', billingMode: 'prepaid', defaultMinutes: 1800, defaultPriceCents: 50000 });
  state = await save('package', { workerId: 'worker-prepaid', capacityMinutes: 1800, priceCents: 50000, paymentId: 'payment-existing' });
 } else {
  assert.equal(state.packages.filter(x => x.workerId === 'worker-prepaid').length, 1);
  state = await save('package', { workerId: 'worker-prepaid', capacityMinutes: 1800, priceCents: 50000, payment: { id: 'payment-second', houseId: 'house-a', date: '2026-11-01', method: 'Virement', note: 'Paiement fictif confirmé pour capture' } });
 }
 writeFileSync(join(directory, 'fixtures.private.json'), JSON.stringify(fixture), { mode: 0o600 });
 console.log(JSON.stringify(state.summaries.find(x => x.workerId === 'worker-prepaid')));
} finally { await sql.end(); }
