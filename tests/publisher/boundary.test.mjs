import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handlePublisher } from '../../lib/publisher/engine/handler.js';
import { localSimulation } from '../../lib/publisher/engine/env.js';

test('legacy shared cookie and benchmark never authorize integrated routes, even in preview', async t => {
  const secret = 'fictitious-local-legacy-secret';
  const payload = Buffer.from(JSON.stringify({ version: 1, issuedAt: Math.floor(Date.now()/1000), expiresAt: Math.floor(Date.now()/1000)+86400 })).toString('base64url');
  const cookie = `oar_publisher_session=${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Legacy request must not touch Auth, storage or any provider'); });
  for (const action of ['session','today','history','status','image','export','export-text','generate','regenerate-text','regenerate-image','music-status','music-replace','music-confirm','music-select','publish']) {
    const method = ['generate','regenerate-text','regenerate-image','music-status','music-replace','music-confirm','music-select','publish'].includes(action) ? 'POST' : 'GET';
    const response = await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=${action}`, { method, headers: { cookie, 'x-publisher-benchmark': secret, 'x-user-role': 'admin' } }));
    assert.equal(response.status, 401, action);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
test('unknown and former authentication actions are closed before any service call', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('No service call allowed'); });
  for (const action of ['login','logout','delete','benchmark','null','other']) {
    assert.equal((await handlePublisher(new Request(`http://127.0.0.1/api/publisher?action=${action}`))).status, 404);
  }
  assert.equal((await handlePublisher(new Request('http://127.0.0.1/api/publisher?action=generate', { method:'POST', headers:{origin:'https://outside.invalid'} }))).status,403);
  // Real Next local Node adapter normalizes request.url to localhost while the
  // browser legitimately addresses 127.0.0.1. It must reach CRM authentication.
  assert.equal((await handlePublisher(new Request('http://localhost:3173/api/publisher?action=generate', { method:'POST', headers:{host:'127.0.0.1:3173',origin:'http://127.0.0.1:3173'} }))).status,401);
  assert.equal((await handlePublisher(new Request('http://localhost:3173/api/publisher?action=generate', { method:'POST', headers:{host:'127.0.0.1:3173',origin:'https://outside.invalid','x-forwarded-host':'outside.invalid'} }))).status,403);
});
function replaceMusicRegion(source, pattern, replacement, expectedCount) {
  let count = 0;
  const result = source.replace(pattern, () => { count += 1; return replacement; });
  assert.equal(count, expectedCount, `Unexpected authorized music region: ${pattern}`);
  return result;
}

// Only these named music regions may differ from the verified source. All
// other source lines remain protected, including creative directions, captions,
// locations, brand/image prompts, models, retries, quality, calls and regeneration.
function preservedSource(name, source) {
  if (name === 'constants.js') source = replaceMusicRegion(source, /export const (?:RECENT|CONFIRMED)_MUSIC_SEED = \[[\s\S]*?\n\];/g, 'MUSIC_SEED', 2);
  if (name === 'rules.js') {
    source = source.replace(/^import \{ hydrateMusic, isConfirmedMusic, musicContextForFormat, musicIdentity \} from '\.\/music.js';\n/m, '');
    source = replaceMusicRegion(source, /export function eligibleMusic\([\s\S]*?(?=export function chooseTheme\()/g, 'MUSIC_SELECTION\n\n', 1);
  }
  if (name === 'schemas.js') {
    source = replaceMusicRegion(source, /const MusicSuggestionSchema = z.object\(\{[\s\S]*?\n\}\);/g, 'const MusicSuggestionSchema = MUSIC_REFERENCE;', 1);
    source = replaceMusicRegion(source, /^  music: z\.array\(MusicSuggestionSchema(?:\.partial\(\{ version: true \}\))?\)\.(?:length|max)\(3\),$/gm, '  music: MUSIC_REFERENCES,', 2);
  }
  if (name === 'generation.js') {
    source = source.replace(/^import \{ musicContextForFormat \} from '\.\/music.js';\n/m, '');
    source = replaceMusicRegion(source, /^    const candidates = eligibleMusic\([\s\S]*?^    \);\n/gm, '', 1);
    source = source.replace(/^    if \(candidates.length < 3\) \{\n      throw new Error\('Moins de trois musiques éligibles après la fenêtre de 14 jours\.'\);\n    \}\n/m, '');
    source = source.replace(/^    if \(selectedMusic.length !== 3\) throw new Error\('Sélection musicale incomplète\.'\);\n/m, '');
    source = replaceMusicRegion(source, /^        content: `\$\{BRAND_BRIEF\(Boolean\(direction\.carContext\)\)\}\\nComplète le mini-plan.*`,$/gm, '        content: MUSIC_EDITORIAL_INSTRUCTION,', 1);
    source = replaceMusicRegion(source, /^          musiques_eligibles: candidates\.map\(.*\),$/gm, '          musiques_eligibles: MUSIC_CANDIDATES,', 1);
    source = replaceMusicRegion(source, /^            musiques: (?:3|Math\.min\(candidates\.length, 3\)),$/gm, '            musiques: MUSIC_COUNT,', 1);
  }
  return source.replace(/^[ \t]*\n/gm, '');
}

test('only authorized music regions differ from the verified creative source', () => {
  // Current creative, automotive and booking logic is pinned to the remote
  // integration baseline 7c4d0b5; only the named music regions are excluded.
  // These are fixed hashes; committing an unrelated change cannot reset them.
  const expected = {
    'constants.js': '5f7d95ffef08c5b6c2a97a1d7bccaf4f98a5bd44347a72f20c88699f7c9a534a',
    'rules.js': '98b3bc5bde31d8d86de9211aede2319b88aac53b3ad071efc9ad71055f075375',
    'schemas.js': 'cf38274349a7fee428bc8768d3216724cc2bc172ecc752226de9778096e88ffd',
    'generation.js': '50101fe7812d3914c101d7cdd23b3bb9b8830a8dddb5e1b6421eaba695eaf13b',
  };
  for (const [name, hash] of Object.entries(expected)) {
    const digest = createHash('sha256').update(preservedSource(name, readFileSync(`lib/publisher/engine/${name}`, 'utf8'))).digest('hex');
    assert.equal(digest, hash, `Non-music source changed in ${name}`);
  }
});

test('private storage remains byte-identical to the deployed source', () => {
  const provenance = JSON.parse(readFileSync('docs/publisher/source.json','utf8'));
  const digest = createHash('sha256').update(readFileSync('lib/publisher/engine/storage.js')).digest('hex');
  assert.equal(digest, provenance.sourceFilesSha256['app/frontend/server/publisher/storage.js']);
});
test('provider configuration and original SQL access schema remain unchanged', () => {
  const expected = {
    'lib/publisher/engine/env.js': '018a6e7453ebed18d49b0304c291ec74121c8d365eeb74fc9420e68419c7f237',
    'lib/publisher/engine/provider.js': '659d66b05a748149c3abf8e50c50c7ccfebd9156a1b336dc95e797b311eae99f',
    'lib/publisher/sql/local-bootstrap.sql': '9a074b79efe7aa712983ed88bdec730de048ddf047f4d965443b94cc534e6b37',
    'lib/publisher/sql/001-crm-boundary.sql': '576891bab16a404d857025c2dd6e3d31e6f1e68ee3db6dea9e4a8f7dcd682ef7',
    'lib/publisher/sql/002-car-context.sql': 'cdcefc33e8cd32215af8d5493dc75fdbb51b234405c249a0396d5dcbb777cd17',
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), hash, path);
});
test('simulation fails closed when a Production URL is supplied', () => {
  const keys = ['PUBLISHER_LOCAL_SIMULATION','PUBLISHER_DATABASE_URL','NEXT_PUBLIC_SUPABASE_URL'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    process.env.PUBLISHER_LOCAL_SIMULATION='1';
    process.env.PUBLISHER_DATABASE_URL='postgresql://fiction@127.0.0.1:55532/publisher_local';
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://jcmnwvlmysecrahupfkk.supabase.co';
    assert.throws(localSimulation, /isolated loopback/);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
