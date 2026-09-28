import assert from 'node:assert/strict';

export const local = Object.freeze({
  directory: '/private/tmp/crm-publisher-local',
  app: 'http://127.0.0.1:3173',
  api: 'http://127.0.0.1:55531',
  mail: 'http://127.0.0.1:55534',
  databasePort: '55532',
  acknowledgement: 'PUBLISHER_DISPOSABLE_LOCAL_ONLY',
});

// Call before constructing a client, issuing SQL or launching the isolated app.
export function assertPublisherLocalTarget(status, environment = process.env) {
  assert.equal(environment.PUBLISHER_TEST_ACK, local.acknowledgement, 'Explicit Publisher local opt-in required');
  assert.equal(status.API_URL, local.api, 'Only dedicated loopback Auth is allowed');
  const database = new URL(status.DB_URL);
  assert.equal(database.protocol, 'postgresql:');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, local.databasePort);
  assert.equal(database.pathname, '/postgres');
  assert.equal(database.search, '');
  assert.equal(database.hash, '');
  assert.equal(database.href.includes('jcmnwvlmysecrahupfkk'), false, 'Production is forbidden');
  if (status.PUBLISHER_DATABASE_URL) {
    const publisher = new URL(status.PUBLISHER_DATABASE_URL);
    assert.equal(publisher.protocol, database.protocol);
    assert.equal(publisher.hostname, database.hostname);
    assert.equal(publisher.port, database.port);
    assert.equal(publisher.pathname, '/publisher_local');
    assert.equal(publisher.search, '');
    assert.equal(publisher.hash, '');
  }
}
