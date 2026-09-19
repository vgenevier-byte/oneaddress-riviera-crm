import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect, sql, dir } from './local.mjs';

// Importing local.mjs verifies the disposable loopback targets before any connection.
const publication = readFileSync('docs/unified/PUBLICATION.md', 'utf8');
const section = publication.split('### Bootstrap explicite du propriétaire')[1];
assert.ok(section, 'The reviewed owner bootstrap section must exist');
const block = section.match(/```sql\n([\s\S]*?)\n```/)?.[1];
assert.ok(block, 'The reviewed SQL block must exist');
assert.match(block, /^begin;\n[\s\S]*\ncommit;$/);
const procedure = block.slice('begin;\n'.length, -'\ncommit;'.length);
assert.match(procedure, /^do \$\$\n[\s\S]*\nend \$\$;$/);
const identityPattern = /declare owner_id uuid := '[^']+';/;
const emailPattern = /and lower\(email\)='[^']+'/;
assert.equal(procedure.match(new RegExp(identityPattern.source, 'g'))?.length, 1);
assert.equal(procedure.match(new RegExp(emailPattern.source, 'g'))?.length, 1);

const owner = randomUUID();
const other = randomUUID();
const project = randomUUID();
const email = `bootstrap-${owner}@example.invalid`;
const sourceHash = createHash('sha256').update(block).digest('hex');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const checks = [];
let transactionOpen = false;
let stage = 'connect';
let failed = false;

// Only the reviewed identity literals are replaced; no executable statement changes.
function fictitiousProcedure(id = owner, recipient = email) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.match(recipient, /^[a-z0-9-]+@example\.invalid$/);
  return procedure
    .replace(identityPattern, `declare owner_id uuid := '${id}';`)
    .replace(emailPattern, `and lower(email)='${recipient}'`);
}

async function snapshot() {
  const result = {};
  for (const [key, query] of Object.entries({
    ownerProfile: 'select to_jsonb(p) value from public.crm_access_profiles p where user_id=$1',
    ownerGrants: 'select to_jsonb(g) value from public.crm_module_grants g where user_id=$1 order by module',
    otherProfiles: 'select to_jsonb(p) value from public.crm_access_profiles p where user_id<>$1 order by user_id',
    otherGrants: 'select to_jsonb(g) value from public.crm_module_grants g where user_id<>$1 order by user_id,module',
    memberships: 'select to_jsonb(m) value from public.app_memberships m order by user_id,workspace_id',
    assignments: 'select to_jsonb(a) value from public.izord_project_assignments a order by user_id,project_id',
    payload: 'select to_jsonb(w) value from public.crm_workspace_state w order by workspace_id',
  })) {
    result[key] = (await sql.query(query, query.includes('$1') ? [owner] : [])).rows;
  }
  return result;
}

async function expectRefusal(name, acknowledgement, candidate, expectedMessage, before) {
  stage = name;
  await sql.query('savepoint refused_bootstrap');
  await sql.query("select set_config('crm.owner_bootstrap_approved',$1,true)", [acknowledgement]);
  let message;
  try {
    await sql.query(candidate);
  } catch (error) {
    message = error.message;
  } finally {
    await sql.query('rollback to savepoint refused_bootstrap');
    await sql.query('release savepoint refused_bootstrap');
  }
  assert.equal(message, expectedMessage, `${name}: the reviewed guard must reject`);
  assert.deepEqual(await snapshot(), before, `${name}: refusal must preserve all rows`);
  checks.push({ name, passed: true });
}

async function assertOwnerAccess() {
  await sql.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
  await sql.query('set local role authenticated');
  try {
    const access = (await sql.query('select public.crm_access_snapshot() value')).rows[0].value;
    assert.equal(access.active, true);
    assert.equal(access.generalAdmin, true);
    assert.equal(access.fullAccess, true);
    assert.equal(Object.keys(access.modules).length, 15);
    assert.ok((await sql.query('select workspace_id from public.crm_workspace_state')).rowCount > 0);
  } finally {
    await sql.query('reset role');
  }
}

function assertPreserved(before, after) {
  for (const key of ['otherProfiles', 'otherGrants', 'memberships', 'assignments', 'payload']) {
    assert.deepEqual(after[key], before[key], `${key} must remain unchanged`);
  }
  assert.deepEqual(
    after.ownerGrants.filter(row => row.value.module === 'izord'),
    before.ownerGrants.filter(row => row.value.module === 'izord'),
    'The owner IZORD ceiling must remain unchanged',
  );
}

try {
  await connect();
  await sql.query('begin isolation level repeatable read');
  transactionOpen = true;
  stage = 'fictitious-fixtures';
  // Nothing in this transaction survives: no Auth API account creation is needed.
  await sql.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())', [owner, email, other, `bootstrap-other-${other}@example.invalid`]);
  await sql.query("insert into public.app_memberships(user_id,workspace_id,role) values($1,'oar','member'),($1,'izord','admin'),($2,'oar','member'),($2,'izord','reader')", [owner, other]);
  await sql.query('insert into public.crm_access_profiles(user_id) values($1),($2)', [owner, other]);
  await sql.query("insert into public.crm_module_grants(user_id,module,level,sensitive) values($1,'izord','contribute','{\"delete\":true,\"export\":true}'),($2,'izord','read','{}'),($2,'tasks','read','{}')", [owner, other]);
  await sql.query("insert into public.izord_projects(id,owner_id,title) values($1,$2,'Bootstrap fictif transactionnel')", [project, owner]);
  await sql.query('insert into public.izord_project_assignments(project_id,user_id) values($1,$2),($1,$3)', [project, owner, other]);
  const before = await snapshot();

  await expectRefusal('missing-acknowledgement', '', fictitiousProcedure(), 'Explicit reviewed release acknowledgement required', before);
  await expectRefusal('incorrect-acknowledgement', 'NOT_APPROVED', fictitiousProcedure(), 'Explicit reviewed release acknowledgement required', before);
  await expectRefusal('incorrect-owner-identity', 'REVIEWED_RELEASE_ONLY', fictitiousProcedure(randomUUID()), 'Owner identity mismatch: STOP', before);
  await expectRefusal('incorrect-owner-email', 'REVIEWED_RELEASE_ONLY', fictitiousProcedure(owner, 'bootstrap-wrong@example.invalid'), 'Owner identity mismatch: STOP', before);

  stage = 'exact-bootstrap';
  await sql.query("select set_config('crm.owner_bootstrap_approved','REVIEWED_RELEASE_ONLY',true)");
  await sql.query(fictitiousProcedure());
  await assertOwnerAccess();
  const after = await snapshot();
  assertPreserved(before, after);
  checks.push({ name: 'exact-bootstrap-grants-full-owner-access', passed: true });
  checks.push({ name: 'izord-roles-assignments-and-ceiling-preserved', passed: true });
  checks.push({ name: 'all-other-accounts-and-business-data-unchanged', passed: true });

  stage = 'preserve-existing-full-owner';
  await sql.query(fictitiousProcedure());
  await assertOwnerAccess();
  const repeated = await snapshot();
  assertPreserved(before, repeated);
  assert.deepEqual(repeated.ownerGrants, after.ownerGrants);
  assert.equal(repeated.ownerProfile[0].value.revision, after.ownerProfile[0].value.revision + 1);
  checks.push({ name: 'full-owner-access-preserved-on-repeated-bootstrap', passed: true });

  await sql.query('rollback');
  transactionOpen = false;
  stage = 'rollback-verification';
  assert.equal((await sql.query('select 1 from auth.users where id=any($1::uuid[])', [[owner, other]])).rowCount, 0);
  assert.equal((await sql.query('select 1 from public.izord_projects where id=$1', [project])).rowCount, 0);
  checks.push({ name: 'all-fictitious-bootstrap-fixtures-rolled-back', passed: true });
} catch (error) {
  failed = true;
  // Keep the failed stage/code, never a raw SQL query, credential or private row.
  checks.push({ name: stage, passed: false, errorCode: String(error.code ?? error.name ?? 'Error') });
  process.exitCode = 1;
} finally {
  if (transactionOpen) await sql.query('rollback');
  await sql.end();
  const result = {
    passed: !failed,
    document: 'docs/unified/PUBLICATION.md',
    exactSqlBlockSHA256: sourceHash,
    exactProcedureExtracted: true,
    onlyFictitiousIdentitySubstitutions: true,
    transaction: 'REPEATABLE READ; final ROLLBACK instead of publication COMMIT',
    localTargetsVerified: true,
    checks,
  };
  const evidence = `${dir}/bootstrap-exact-${runId}.json`;
  writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ evidence, ...result }));
}
