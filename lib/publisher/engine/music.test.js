import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrateMusic, musicContextForFormat } from './music.js';
import { chooseMusic, eligibleMusic } from './rules.js';

const reference = { id: 1, revision: 2, title: 'Fixture title', artist: 'Fixture artist', version: '' };
const confirmation = { title: reference.title, artist: reference.artist, version: '', status: 'confirmed',
  method: 'manual_instagram', checked_at: '2026-10-23T10:00:00Z', account: 'one-address-riviera', context: 'feed' };

test('a historical unavailable flag remains visible without fabricated verification', () => {
  const legacy = { ...reference, availability_status: 'unavailable' };
  const before = structuredClone(legacy);
  for (const format of ['Feed 4:5', 'Reel']) {
    const track = hydrateMusic(legacy, musicContextForFormat(format));
    assert.equal(track.availability_status, 'unavailable');
    assert.equal(track.legacy_availability_status, 'unavailable');
    assert.equal(track.verification, null);
    assert.equal(track.instagram_audio_id, null);
    assert.equal(track.instagram_audio_url, null);
    assert.deepEqual(eligibleMusic([legacy], [], new Date(), musicContextForFormat(format)), []);
    assert.deepEqual(chooseMusic([track]), []);
  }
  assert.deepEqual(legacy, before, 'Reading must not backfill historical rows');
});

test('legacy available and unknown flags remain unconfirmed', () => {
  for (const status of ['available', 'unknown']) {
    const track = hydrateMusic({ ...reference, availability_status: status });
    assert.equal(track.availability_status, 'unknown');
    assert.equal(track.legacy_availability_status, status);
    assert.equal(track.verification, null);
    assert.deepEqual(eligibleMusic([track]), []);
  }
});

test('a scoped confirmation supersedes a legacy report only in its recorded context', () => {
  const legacy = { ...reference, availability_status: 'unavailable', verification_history: [confirmation] };
  const feed = hydrateMusic(legacy, musicContextForFormat('Feed 4:5'));
  const reel = hydrateMusic(legacy, musicContextForFormat('Reel'));
  assert.equal(feed.availability_status, 'available');
  assert.equal(feed.legacy_availability_status, 'unavailable');
  assert.equal(feed.verification.context, 'feed');
  assert.equal(reel.availability_status, 'unavailable');
  assert.equal(reel.verification, null);
  assert.deepEqual(eligibleMusic([legacy]).map(song => song.id), [1]);
  assert.deepEqual(eligibleMusic([legacy], [], new Date(), musicContextForFormat('Reel')), []);
});

test('an explicit contextual reset overrides an older unscoped negative flag', () => {
  const track = hydrateMusic({ ...reference, availability_status: 'unavailable',
    verification_history: [{ ...confirmation, status: 'unknown' }] });
  assert.equal(track.availability_status, 'unknown');
  assert.equal(track.verification.status, 'unknown');
  assert.equal(track.legacy_availability_status, 'unavailable');
  assert.deepEqual(eligibleMusic([track]), []);
});
