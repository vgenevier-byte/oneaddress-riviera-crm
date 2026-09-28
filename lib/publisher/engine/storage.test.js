import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLISHER_BLOB_ACCESS } from './constants.js';
import { serializePublisherPost } from './db.js';
import { isPrivateBlobUrl } from './storage.js';

test('all Publisher Blob operations are pinned to private access', () => {
  assert.equal(PUBLISHER_BLOB_ACCESS, 'private');
  assert.equal(
    isPrivateBlobUrl('https://store.private.blob.vercel-storage.com/publisher/image.jpg'),
    true,
  );
  assert.equal(
    isPrivateBlobUrl('https://store.public.blob.vercel-storage.com/publisher/image.jpg'),
    false,
  );
});

test('client payload exposes only the authenticated image proxy', () => {
  const payload = serializePublisherPost({
    id: '5b4fa53e-4f31-4de8-9077-1b2c3d4e5f60',
    post_date: new Date('2026-08-15T00:00:00.000Z'),
    creation_mode: 'guided',
    creative_universe: 'Bateaux',
    creative_moment: 'Soirée',
    creative_style: 'Élégant',
    theme: 'yacht',
    moment: 'soir',
    scene_summary: 'summary',
    visual_signature: 'signature',
    caption: 'caption',
    hashtags: [],
    primary_music_id: 11,
    alternative_music_ids: [12, 13],
    music_used_id: null,
    location: 'Estérel',
    format: 'Feed 4:5',
    status: 'draft',
    generation_status: 'ready',
    generation_progress: { direction: 'working' },
    published_at: null,
    image_url: 'https://store.private.blob.vercel-storage.com/publisher/private.jpg',
    image_pathname: 'publisher/private.jpg',
  });
  assert.equal(Object.hasOwn(payload, 'image_url'), false);
  assert.equal(Object.hasOwn(payload, 'image_pathname'), false);
  assert.equal(payload.post_date, '2026-08-15');
  assert.equal(payload.creation_mode, 'guided');
  assert.equal(payload.creative_universe, 'Bateaux');
  assert.deepEqual(payload.generation_progress, {
    direction: 'done',
    visual: 'done',
    editorial: 'done',
    music: 'done',
    finalization: 'done',
  });
  assert.equal(
    payload.image_src,
    '/api/publisher?action=image&id=5b4fa53e-4f31-4de8-9077-1b2c3d4e5f60',
  );
});
