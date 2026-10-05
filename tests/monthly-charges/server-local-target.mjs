import assert from 'node:assert/strict';
/** Must run before a client is constructed; this integration never reads .env. */
export function assertMonthlyLocalTarget({ api, database, app, mail, acknowledgement }) {
  assert.equal(acknowledgement, 'IZORD_DISPOSABLE_LOCAL_ONLY', 'Explicit disposable-local opt-in required');
  const urls = [api, database, app, mail].map(value => new URL(value));
  for (const url of urls) {
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.search, ''); assert.equal(url.hash, '');
    assert.ok(!url.href.includes('jcmnwvlmysecrahupfkk'));
  }
  assert.equal(urls[0].origin, 'http://127.0.0.1:55631');
  assert.equal(urls[0].pathname, '/');
  assert.equal(urls[1].protocol, 'postgresql:');
  assert.equal(urls[1].port, '55632'); assert.equal(urls[1].pathname, '/postgres');
  assert.equal(urls[2].origin, 'http://127.0.0.1:3183');
  assert.equal(urls[3].origin, 'http://127.0.0.1:55634');
}
