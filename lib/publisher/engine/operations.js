import { createHash } from 'node:crypto';
import { query, transaction } from './database.js';
import { currentOperation } from './context.js';

export class PublisherError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function claimOperation(action, body) {
  const { actor } = currentOperation();
  const fingerprint = createHash('sha256').update(JSON.stringify({ action, body })).digest('hex');
  const existing = await query('SELECT * FROM publisher_operations WHERE request_id = $1', [body.requestId]);
  if (existing[0]) return receipt(existing[0], actor, fingerprint);
  try {
    const [, rows] = await transaction([
      { text: 'SELECT pg_advisory_xact_lock(743830201)', values: [] },
      { text: `INSERT INTO publisher_operations (request_id,actor_id,action,fingerprint,state,target_post_id)
          SELECT $1,$2,$3,$4,'running',$5
          WHERE ($3 NOT IN ('generate','regenerate-text','regenerate-image') OR ((SELECT count(*) FROM publisher_operations WHERE actor_id=$2 AND action IN ('generate','regenerate-text','regenerate-image') AND created_at>now()-interval '1 day') < 20
            AND (SELECT count(*) FROM publisher_operations WHERE action IN ('generate','regenerate-text','regenerate-image') AND created_at>now()-interval '1 day') < 100))
          ON CONFLICT (request_id) DO NOTHING RETURNING *`, values: [body.requestId, actor, action, fingerprint, action === 'generate' ? null : body.postId || body.id] },
    ]);
    if (rows[0]) return { claimed: true };
    const retry = await query('SELECT * FROM publisher_operations WHERE request_id=$1', [body.requestId]);
    if (retry[0]) return receipt(retry[0], actor, fingerprint);
    throw Object.assign(new PublisherError(429, 'Limite de demandes atteinte. Réessayez demain.'), { terminal: true });
  } catch (error) {
    if (error.code === '23505') {
      const retry = await query('SELECT * FROM publisher_operations WHERE request_id=$1', [body.requestId]);
      if (retry[0]) return receipt(retry[0], actor, fingerprint);
      throw Object.assign(new PublisherError(409, 'Une opération Publisher est déjà en cours. Consultez son état.'), { terminal: true });
    }
    throw error;
  }
}
function receipt(operation, actor, fingerprint) {
  if (operation.actor_id !== actor || operation.fingerprint !== fingerprint) {
    throw new PublisherError(409, 'Cet identifiant de demande est déjà utilisé.');
  }
  if (operation.state === 'failed') {
    const error = new PublisherError(409, 'Cette demande a échoué. Vérifiez son état avant une nouvelle demande explicite.');
    error.terminal = true; throw error;
  }
  return { claimed: false, pending: operation.state === 'running', result: operation.result };
}
export async function finishOperation(requestId, result, failed = false) {
  await query(`UPDATE publisher_operations SET state=$2,result=$3::jsonb,finished_at=now()
    WHERE request_id=$1 AND state='running'`, [requestId, failed ? 'failed' : 'complete', JSON.stringify(result)]);
}
