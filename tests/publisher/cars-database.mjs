/** Additional real-PostgreSQL journal/filter checks; no provider is imported. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { directory, fixture, sql } from './cars-local.mjs';
process.env.PUBLISHER_LOCAL_SIMULATION = '1';
process.env.PUBLISHER_DATABASE_URL = fixture.database;
process.env.NEXT_PUBLIC_SUPABASE_URL = fixture.auth;
const { recentCarReferences, persistOperationCarContext } = await import('../../lib/publisher/engine/db.js');
const { resolveCarReference } = await import('../../lib/publisher/engine/cars.js');
const { publisherContext } = await import('../../lib/publisher/engine/context.js');
const ids = Array.from({length:35},()=>randomUUID()), requestId = randomUUID();
const checks = [];
await sql.connect();
try {
  for (const id of ids) await sql.query("insert into publisher_posts(id,post_date,creation_mode,generation_status,car_context,created_at) values($1,'2026-10-21','guided','ready','null'::jsonb,now()+interval '1 day')",[id]);
  const references = await recentCarReferences();
  assert.ok(references.length > 0);
  assert.ok(references.every(p=>p.car_context && typeof p.car_context === 'object'));
  checks.push('35 recent JSON-null non-car fixtures cannot crowd out actual car references');
  await sql.query("insert into publisher_operations(request_id,actor_id,action,fingerprint,state) values($1,$2,'regenerate-image','local-database-test','running')",[requestId,fixture.users.editor.id]);
  const first = resolveCarReference('suv',[],'first'), second = resolveCarReference('convertible',[],'second');
  const context = { actor:fixture.users.editor.id,requestId,check:async()=>{} };
  assert.deepEqual(await publisherContext.run(context,()=>persistOperationCarContext(first)),first);
  assert.deepEqual(await publisherContext.run(context,()=>persistOperationCarContext(second)),first);
  checks.push('real journal COALESCE retains the first snapshot even when resolution inputs change');
  await assert.rejects(publisherContext.run({...context,actor:fixture.users.other.id},()=>persistOperationCarContext(second)),/non journalisé/);
  checks.push('another actor cannot replace or read a journal snapshot through the write guard');
  await sql.query("update publisher_operations set state='complete' where request_id=$1",[requestId]);
  await assert.rejects(publisherContext.run(context,()=>persistOperationCarContext(second)),/non journalisé/);
  checks.push('a completed journal cannot be rewritten');
  writeFileSync(`${directory}/database-results.json`,JSON.stringify({passed:checks.length,checks,realPostgres:true,paidCalls:0},null,2));
  for (const name of checks) console.log('PASS '+name);
} finally {
  await sql.query('delete from publisher_posts where id=any($1::uuid[])',[ids]);
  await sql.query("delete from publisher_operations where request_id=$1 and fingerprint='local-database-test'",[requestId]);
  await sql.end();
}
// The product's cached pg pool remains alive; no application connection API is
// added solely for this disposable test process.
process.exit(0);
