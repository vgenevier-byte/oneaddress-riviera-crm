import './network-guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, status, fixturePath } from './local.mjs';

Object.assign(process.env, { PUBLISHER_DATABASE_URL: status.PUBLISHER_DATABASE_URL,
  PUBLISHER_LOCAL_SIMULATION: '1', NEXT_PUBLIC_SUPABASE_URL: status.API_URL });
const { reconcileInterruptedOperation } = await import('../../lib/publisher/engine/reconcile.js');
const users = JSON.parse(readFileSync(fixturePath,'utf8'));
const client = new Client({connectionString:status.PUBLISHER_DATABASE_URL});
await client.connect();
try {
  const actor = users.users?.editor?.id || users.editor?.id;
  assert.ok(actor);
  const id = randomUUID();
  await client.query("insert into publisher_operations(request_id,actor_id,action,fingerprint,state,created_at) values($1,$2,'generate','local-crash','running',now()-interval '20 minutes')", [id,actor]);
  await assert.rejects(reconcileInterruptedOperation({requestId:id,evidence:'Local fixture, simulated provider settled.',workerStopped:true,providerSettled:true}));
  process.env.PUBLISHER_MAINTENANCE_ENABLED='1';
  await assert.rejects(reconcileInterruptedOperation({requestId:id,evidence:'Local fixture, simulated provider settled.',workerStopped:false,providerSettled:true}));
  const recovered=await reconcileInterruptedOperation({requestId:id,evidence:'Local fixture only: no worker launched, no external provider contacted.',workerStopped:true,providerSettled:true});
  assert.equal(recovered.state,'failed'); assert.equal(recovered.externalCalls,0);
  assert.equal((await client.query("select count(*) from publisher_operations where state='running'")).rows[0].count,'0');
  console.log(JSON.stringify({passed:1,scenario:'crash requires explicit settlement; no external replay; durable lock released',auth:'same isolated real PostgreSQL, offline maintenance'}));
} finally { await client.end(); }
// The isolated product adapter's local pool is otherwise kept alive for the app.
process.exit(0);
