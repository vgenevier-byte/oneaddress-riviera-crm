/** Fail closed before constructing any local client. No repo .env is loaded. */
export const ACK = 'CONTACTS_ENTITY_DISPOSABLE_LOCAL_ONLY';
export const ORIGIN = 'http://127.0.0.1:55831';
export function assertTarget({ origin, database, acknowledgement }) {
  if (acknowledgement !== ACK) throw new Error('Explicit disposable Contacts bench acknowledgement required');
  const api = new URL(origin), db = new URL(database);
  if (api.href !== ORIGIN + '/' || api.username || api.password) throw new Error('Unexpected Contacts API target');
  if (db.protocol !== 'postgresql:' || db.hostname !== '127.0.0.1' || db.port !== '55832' || db.pathname !== '/postgres' || db.search || db.hash) throw new Error('Unexpected Contacts database target');
}
export function assertDocker(env) {
  if (env.CONTACTS_ENTITY_ACK !== ACK || env.DOCKER_HOST !== `unix://${env.HOME}/.colima/default/docker.sock`) throw new Error('Explicit local Colima engine required');
  for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'CONTAINER_HOST', 'SUPABASE_SERVICES_HOSTNAME']) if (env[key]) throw new Error('Unexpected Docker/service override: ' + key);
}
export function assertPrivateFile(path) {
  if (!path || !/^\/(?:private\/)?tmp\/oar-contacts-entity-[^/]+\//.test(path)) throw new Error('Private Contacts bench file must remain in its temporary directory');
}
