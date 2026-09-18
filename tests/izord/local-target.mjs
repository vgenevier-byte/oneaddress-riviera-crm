// Every write test imports this BEFORE creating any network client.
export function assertLocalTarget({ api, database, app, mail, acknowledgement }) {
  if (acknowledgement !== 'IZORD_DISPOSABLE_LOCAL_ONLY') throw new Error('Explicit local test opt-in required');
  const apiURL = new URL(api), dbURL = new URL(database), appURL = new URL(app), mailURL = new URL(mail);
  for (const u of [apiURL, dbURL, appURL, mailURL]) {
    if (u.hostname !== '127.0.0.1' || u.search || u.hash) throw new Error('Only literal loopback test targets are allowed');
    if (u.href.includes('jcmnwvlmysecrahupfkk')) throw new Error('Production forbidden');
  }
  if(apiURL.origin !== 'http://127.0.0.1:55431' || apiURL.pathname !== '/' || apiURL.username || apiURL.password) throw new Error('Unapproved local API');
  if(dbURL.protocol !== 'postgresql:' || dbURL.port !== '55432' || dbURL.pathname !== '/postgres') throw new Error('Unapproved local database');
  if(appURL.origin !== 'http://127.0.0.1:3159' || appURL.pathname !== '/' || appURL.username || appURL.password) throw new Error('Unapproved local application');
  if(mailURL.origin !== 'http://127.0.0.1:55434' || mailURL.pathname !== '/' || mailURL.username || mailURL.password) throw new Error('Unapproved local mail');
}

// Called before the first Docker/CLI invocation. No implicit Docker context fallback.
export function assertLocalDocker(env) {
  if (env.IZORD_TEST_ACK !== 'IZORD_DISPOSABLE_LOCAL_ONLY') throw new Error('Explicit local test opt-in required');
  if (!env.HOME || env.DOCKER_HOST !== `unix://${env.HOME}/.colima/default/docker.sock`) throw new Error('Explicit local Colima socket required');
  for (const key of ['DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','CONTAINER_HOST','SUPABASE_SERVICES_HOSTNAME']) {
    if (env[key]) throw new Error(`Unexpected engine/service override: ${key}`);
  }
}
