/** Restore only the backed-up fictitious shared payload, under an optimistic precondition. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { assertLocalTarget } from './local-target.mjs';
import { assertRestorablePayload, verifyRetained } from './reuse-local.mjs';

const status=JSON.parse(readFileSync(process.env.LOCAL_STATUS_FILE,'utf8'));
assertLocalTarget({api:status.API_URL,database:status.DB_URL,app:'http://127.0.0.1:3159',mail:'http://127.0.0.1:55434',acknowledgement:process.env.IZORD_TEST_ACK});
const fixture=JSON.parse(readFileSync(process.env.LOCAL_FIXTURE_FILE,'utf8'));
assert.equal(fixture.api,status.API_URL);assert.ok(fixture.reuse?.retainedSnapshotFile);
const stackDir=dirname(resolve(process.env.LOCAL_STATUS_FILE));
assert.equal(dirname(resolve(fixture.reuse.retainedSnapshotFile)),stackDir);
const snapshot=JSON.parse(readFileSync(fixture.reuse.retainedSnapshotFile,'utf8'));
assert.equal(snapshot.stackDir,stackDir);assert.equal(snapshot.runId,fixture.reuse.runId);
const {Client}=createRequire(import.meta.url)(process.env.IZORD_PG_MODULE||'pg');
const sql=new Client({connectionString:status.DB_URL});
try {
  await sql.connect();await sql.query('begin');
  const retained=await verifyRetained(sql,snapshot);
  const row=(await sql.query("select updated_at::text revision,md5(payload::text) payload_hash from public.crm_workspace_state where workspace_id='oneaddress-riviera' for update")).rows[0];
  assert.ok(row);assertRestorablePayload(fixture.reuse.activeWorkspacePayloadHash,row.payload_hash);
  const restored=await sql.query("update public.crm_workspace_state set payload=$1,updated_by=$2 where workspace_id='oneaddress-riviera' and updated_at=$3::timestamptz returning md5(payload::text) payload_hash,updated_at>$3::timestamptz revision_advanced",[snapshot.workspace.payload,snapshot.workspace.updated_by,row.revision]);
  assert.equal(restored.rowCount,1);assert.equal(restored.rows[0].payload_hash,snapshot.workspace.payload_hash);assert.equal(restored.rows[0].revision_advanced,true);
  await sql.query('commit');
  const report={...retained,sharedOriginalPayloadRestored:true,optimisticPreconditionMatched:true,serverRevisionAdvanced:true,noOldAccountProjectObjectOrVolumeDeleted:true};
  if(process.env.IZORD_ARTIFACTS){mkdirSync(process.env.IZORD_ARTIFACTS,{recursive:true});writeFileSync(join(process.env.IZORD_ARTIFACTS,'retained-restoration.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
} catch(e) {await sql.query('rollback').catch(()=>{});console.error('Retained fixture restoration refused or failed; private snapshot preserved.');process.exitCode=1;}
finally {await sql.end().catch(()=>{});}
