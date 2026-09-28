// Offline maintenance only: never imported by an application route. No provider
// invocation and no automatic retry. The operator must first stop the worker and
// establish that all accepted upstream work has settled.
import { query, transaction } from './database.js';

export async function reconcileInterruptedOperation({ requestId, evidence, workerStopped, providerSettled }) {
  if (process.env.PUBLISHER_MAINTENANCE_ENABLED !== '1' || workerStopped !== true || providerSettled !== true
      || typeof evidence !== 'string' || evidence.trim().length < 20 || evidence.length > 500) {
    throw new Error('Explicit offline maintenance and documented settlement evidence required.');
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId || '')) throw new Error('Invalid request ID.');
  const [operation] = await query('SELECT * FROM publisher_operations WHERE request_id=$1', [requestId]);
  if (!operation || operation.state !== 'running' || Date.now() - new Date(operation.created_at).getTime() < 15 * 60000) {
    throw new Error('Only an interrupted running operation older than 15 minutes can be reconciled.');
  }
  const [post] = await query('SELECT * FROM publisher_posts WHERE id=$1 OR generation_request_id=$2 LIMIT 1', [operation.target_post_id, requestId]);
  const recovered = post?.generation_status === 'ready';
  const result = { ...(recovered ? { recoveryPostId: String(post.id) } : {}), reconciliation: { evidence: evidence.trim(), workerStopped, providerSettled } };
  const [, , rows] = await transaction([
    { text: 'SELECT pg_advisory_xact_lock(743830201)', values: [] },
    { text: `UPDATE publisher_posts SET generation_status=$3,error_message='Traitement interrompu clos après vérification opérateur.',updated_at=now()
        WHERE id=$1 AND generation_status='generating'
          AND EXISTS(SELECT 1 FROM publisher_operations WHERE request_id=$2 AND state='running' AND created_at<now()-interval '15 minutes')`,
      values: [post?.id || null, requestId, operation.action === 'generate' ? 'error' : 'ready'] },
    { text: `UPDATE publisher_operations SET state=$2,result=$3::jsonb,finished_at=now()
        WHERE request_id=$1 AND state='running' AND created_at<now()-interval '15 minutes' RETURNING request_id,state`,
      values: [requestId, recovered ? 'complete' : 'failed', JSON.stringify(result)] },
  ]);
  if (!rows[0]) throw new Error('Operation changed during reconciliation; nothing may be retried automatically.');
  return { ...rows[0], recovered, externalCalls: 0 };
}
