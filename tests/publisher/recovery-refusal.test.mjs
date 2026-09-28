/** Recovery regression: only proven admission refusals permit an explicit new attempt.
 * Real claimOperation and AsyncLocalStorage; the SQL boundary alone is simulated.
 * Run with node --experimental-test-module-mocks --test this-file.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { publisherContext } from '../../lib/publisher/engine/context.js';

await test('Publisher recovery distinguishes refused admission from unknown outcome', async t => {
  const actor = 'a2000000-0000-4000-8000-000000000001';
  const body = {
    requestId: 'b2000000-0000-4000-8000-000000000001', mode: 'guided',
    direction: { universe: 'landscapes', moment: 'morning', style: 'elegant' },
  };
  const fingerprint = createHash('sha256').update(JSON.stringify({ action: 'generate', body })).digest('hex');
  let existing, transactionError, queries, transactions;
  const reset = () => { existing = null; transactionError = null; queries = 0; transactions = 0; };
  t.mock.module(new URL('../../lib/publisher/engine/database.js', import.meta.url), { exports: {
    query: async (text, values) => {
      queries += 1;
      assert.match(text, /^SELECT \* FROM publisher_operations WHERE request_id\s*=\s*\$1$/);
      assert.deepEqual(values, [body.requestId]);
      return existing ? [existing] : [];
    },
    transaction: async statements => {
      transactions += 1;
      assert.equal(publisherContext.getStore().actor, actor);
      assert.equal(statements[1].values[0], body.requestId);
      assert.equal(statements[1].values[1], actor);
      if (transactionError) throw transactionError;
      return [[], []];
    },
  } });
  const { claimOperation, PublisherError } = await import('../../lib/publisher/engine/operations.js');
  const claim = () => publisherContext.run({ actor, check: async () => {} }, () => claimOperation('generate', body));

  await t.test('cap refusal with no inserted operation and no existing receipt is terminal', async () => {
    reset();
    await assert.rejects(claim, error => {
      assert.ok(error instanceof PublisherError);
      assert.equal(error.status, 429);
      assert.equal(error.terminal, true);
      return true;
    });
    assert.equal(transactions, 1);
    assert.equal(queries, 2);
  });

  await t.test('rolled-back unique conflict with no existing receipt is terminal', async () => {
    reset();
    // database.transaction rolls back before forwarding this error. This fixture
    // represents that boundary; it is not evidence of a real SQL rollback.
    transactionError = Object.assign(new Error('Simulated transaction rollback'), { code: '23505' });
    await assert.rejects(claim, error => {
      assert.ok(error instanceof PublisherError);
      assert.equal(error.status, 409);
      assert.equal(error.terminal, true);
      return true;
    });
    assert.equal(transactions, 1);
    assert.equal(queries, 2);
  });

  for (const state of ['running', 'complete']) {
    await t.test(`an existing ${state} receipt is returned without another admission`, async () => {
      reset();
      const result = state === 'complete' ? { state: 'ready', post: { id: 'fictional-existing-post' } } : null;
      existing = { actor_id: actor, fingerprint, state, result };
      assert.deepEqual(await claim(), { claimed: false, pending: state === 'running', result });
      assert.equal(transactions, 0);
      assert.equal(queries, 1);
    });
  }

  await t.test('an unknown database outcome stays nonterminal', async () => {
    reset();
    transactionError = new Error('Simulated loss of transaction acknowledgement');
    await assert.rejects(claim, error => {
      assert.equal(error, transactionError);
      assert.equal(error.terminal, undefined);
      return true;
    });
    assert.equal(transactions, 1);
    assert.equal(queries, 1);
  });
});
