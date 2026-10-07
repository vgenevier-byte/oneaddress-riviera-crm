/** Browser/database writes are confined to the preserved disposable Tasks stack. */
export function assertAdminSimplificationTarget({ api, database, app = 'http://127.0.0.1:3200', acknowledgement }) {
  if (acknowledgement !== 'TASKS_DISPOSABLE_LOCAL_ONLY') throw new Error('Explicit Tasks disposable local opt-in required');
  const a = new URL(api), d = new URL(database), p = new URL(app);
  if (a.href !== 'http://127.0.0.1:55731/') throw new Error('Unexpected Tasks API');
  if (d.hostname !== '127.0.0.1' || d.port !== '55732' || d.protocol !== 'postgresql:' || d.pathname !== '/postgres') throw new Error('Unexpected Tasks database');
  if (p.href !== 'http://127.0.0.1:3200/') throw new Error('Unexpected Tasks app');
  if (d.search || d.hash) throw new Error('Unexpected database target parameters');
}
