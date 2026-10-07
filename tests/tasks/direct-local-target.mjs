import { assertTasksTarget } from './local-target.mjs';

/** New UI runner, same preserved fictional Auth/DB bench; exact loopback only. */
export function assertDirectTasksTarget(target) {
  assertTasksTarget({ ...target, app: 'http://127.0.0.1:3197' });
  const app = new URL(target.app || 'http://127.0.0.1:3198');
  if (app.href !== 'http://127.0.0.1:3198/') throw new Error('Unexpected direct-assignment app');
}
