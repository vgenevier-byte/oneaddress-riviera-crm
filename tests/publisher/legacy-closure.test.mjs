import assert from 'node:assert/strict';
import test from 'node:test';
import close from '../../docs/publisher/legacy-api-closed.mjs';

test('future legacy closure refuses all known actions even with cookie/benchmark credentials', () => {
  for (const action of ['session','login','logout','today','generate','status','history','image','regenerate-text','regenerate-image','music-status','publish','unknown']) {
    for (const method of ['GET','POST']) {
      const response = { headers: {}, setHeader(name,value) { this.headers[name] = value; }, end(body) { this.body = JSON.parse(body); } };
      close({ method, query: { action }, headers: { cookie: 'oar_publisher_session=previously-valid', 'x-publisher-benchmark': 'previously-valid' } }, response);
      assert.equal(response.statusCode, 410);
      assert.match(response.headers['Cache-Control'], /no-store/);
      assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
      assert.equal(response.body.url, 'https://oneaddress-riviera-crm.vercel.app/publisher');
    }
  }
});
