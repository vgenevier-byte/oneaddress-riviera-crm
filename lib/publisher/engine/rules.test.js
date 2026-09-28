import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFIRMED_MUSIC_SEED,
  RECENT_MUSIC_SEED,
} from './constants.js';
import {
  chooseMusic,
  chooseTheme,
  contentSimilarity,
  eligibleMusic,
  generationClaimDecision,
  hasRecentContentDuplicate,
  normalizeCreativeDirection,
  normalizeDateKey,
  normalizeHashtags,
  todayInTimezone,
} from './rules.js';

test('creative direction requires and normalizes the three guided choices', () => {
  assert.deepEqual(
    normalizeCreativeDirection({ universe: 'cars', moment: 'night', style: 'dynamic' }),
    {
      universeKey: 'cars',
      universe: 'Voitures',
      theme: 'automobile',
      universeGuidance: 'Une automobile premium sans marque visible doit être le sujet principal, avec une sensation de route et de mouvement.',
      momentKey: 'night',
      moment: 'Nuit',
      momentGuidance: 'Ambiance nocturne cinématographique, bleus profonds, lumières ponctuelles raffinées, détails lisibles.',
      styleKey: 'dynamic',
      style: 'Dynamique',
      styleGuidance: 'Angle vivant, énergie, mouvement et impact visuel, sans agressivité ni effet tapageur.',
    },
  );
  assert.throws(() => normalizeCreativeDirection({ universe: 'cars', moment: 'night' }), /invalide/);
  assert.throws(() => normalizeCreativeDirection({ universe: 'restaurant', moment: 'day', style: 'elegant' }), /invalide/);
});

test('14-day music exclusion removes recent and unavailable tracks', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  const music = [
    { id: 1, title: 'Recent', artist: 'A', availability_status: 'available', last_used_at: '2026-08-10T12:00:00Z' },
    { id: 2, title: 'Old', artist: 'B', availability_status: 'available', last_used_at: '2026-07-01T12:00:00Z' },
    { id: 3, title: 'Blocked', artist: 'C', availability_status: 'unavailable', last_used_at: null },
    { id: 4, title: 'Recorded recent', artist: 'D', availability_status: 'unknown', last_used_at: null },
  ];
  assert.deepEqual(eligibleMusic(music, [4], now).map(item => item.id), [2]);
});

test('used and newly confirmed music seeds are marked available', () => {
  assert.deepEqual(
    RECENT_MUSIC_SEED.map(([title, artist, status]) => ({ title, artist, status })),
    [
      { title: 'Save Us (Instrumental)', artist: 'Jason Lesser', status: 'available' },
      { title: 'High With Me (Instrumental)', artist: 'GEEZ', status: 'available' },
      { title: 'On And On (Instrumental)', artist: 'Julia Gartha', status: 'available' },
      { title: 'Daydream (Instrumental)', artist: 'Chela Rivas', status: 'available' },
    ],
  );
  assert.deepEqual(
    CONFIRMED_MUSIC_SEED.map(([title, artist, status]) => ({ title, artist, status })),
    [
      { title: 'Beleza De Verao (Instrumental)', artist: 'Kolektivo', status: 'available' },
      { title: 'Fervor', artist: 'Ross Lara', status: 'available' },
      { title: 'A New Day', artist: 'Loga Ramin Torkian', status: 'available' },
      { title: 'Legends (Instrumental)', artist: 'stereogully', status: 'available' },
    ],
  );
});

test('music choice is unique and prioritizes confirmed availability', () => {
  const music = [
    { id: 1, title: 'Alpha', artist: 'A', availability_status: 'unknown' },
    { id: 2, title: 'Bravo', artist: 'B', availability_status: 'available' },
    { id: 3, title: 'Charlie', artist: 'C', availability_status: 'available' },
    { id: 4, title: 'Delta', artist: 'D', availability_status: 'unknown' },
  ];
  const result = chooseMusic(music, [
    { title: 'Delta', artist: 'D' },
    { title: 'Bravo', artist: 'B' },
    { title: 'Charlie', artist: 'C' },
  ]);
  assert.deepEqual(result.map(item => item.id), [2, 3, 4]);
});

test('theme avoids the seven latest themes deterministically', () => {
  const history = [
    'immobilier', 'yacht', 'automobile', 'gastronomie', 'lifestyle', 'plage', 'hôtel',
  ].map(theme => ({ theme }));
  const selected = chooseTheme(history, '2026-08-15');
  assert.ok(['expérience privée', 'table privée'].includes(selected));
  assert.equal(chooseTheme(history, '2026-08-15'), selected);
});

test('hashtags always contain the brand plus four unique contextual tags', () => {
  const hashtags = normalizeHashtags(['#CotedAzur', 'CotedAzur', '#YachtLife', ' luxe ']);
  assert.equal(hashtags.length, 5);
  assert.equal(hashtags[0], '#OneAddressRiviera');
  assert.equal(new Set(hashtags.map(value => value.toLowerCase())).size, 5);
});

test('generation lease is idempotent until stale', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  assert.equal(generationClaimDecision(null, now), 'claim');
  assert.equal(generationClaimDecision({ generation_status: 'ready' }, now), 'ready');
  assert.equal(generationClaimDecision({ generation_status: 'error' }, now), 'claim');
  assert.equal(generationClaimDecision({ generation_status: 'generating', generation_started_at: '2026-08-15T11:58:00Z' }, now), 'wait');
  assert.equal(generationClaimDecision({ generation_status: 'generating', generation_started_at: '2026-08-15T11:54:00Z' }, now), 'claim');
});

test('publisher date follows Europe/Paris rather than server UTC', () => {
  assert.equal(todayInTimezone('Europe/Paris', new Date('2026-08-14T22:30:00Z')), '2026-08-15');
});

test('Neon DATE returned as a JavaScript Date stays a canonical SQL date', () => {
  const postDate = new Date('2026-08-16T00:00:00.000Z');
  assert.match(String(postDate), /^Sun Aug 16/);
  assert.equal(normalizeDateKey(postDate), '2026-08-16');
  assert.equal(normalizeDateKey('2026-08-16'), '2026-08-16');
});

test('exact recent editorial reuse is rejected despite punctuation differences', () => {
  const candidate = {
    scene_summary: 'Un dîner privé, face à la mer.',
    visual_signature: 'Nouvelle lumière',
    caption: 'Un soir sur la Riviera.',
  };
  assert.equal(hasRecentContentDuplicate(candidate, [{
    scene_summary: 'Un diner prive face a la mer',
    visual_signature: 'Ancienne lumière',
    caption: 'Autre texte',
  }]), true);
  assert.equal(hasRecentContentDuplicate(candidate, [{
    scene_summary: 'Un départ en yacht au lever du jour',
    visual_signature: 'Bleu profond',
    caption: 'Le large vous attend.',
  }]), false);
});

test('lightweight similarity rejects manifestly close visual concepts', () => {
  const candidate = {
    scene_summary: 'A yacht anchored at golden hour before the red Esterel cliffs.',
    visual_signature: 'Warm golden light, cream deck and deep blue water.',
    caption: 'Quiet arrives with the evening tide.',
  };
  const closeConcept = {
    scene_summary: 'A vessel moored beneath Esterel red cliffs at sunset.',
    visual_signature: 'Cream tones, deep blue sea and warm evening light.',
    caption: 'A different English caption.',
  };
  const distinctConcept = {
    scene_summary: 'A chef plates citrus dessert in a private garden at noon.',
    visual_signature: 'Crisp white linen, green foliage and graphic midday shadows.',
    caption: 'Lunch unfolds in the garden.',
  };
  assert.ok(contentSimilarity(candidate.scene_summary, closeConcept.scene_summary) >= 0.52);
  assert.equal(hasRecentContentDuplicate(candidate, [closeConcept]), true);
  assert.equal(hasRecentContentDuplicate(candidate, [distinctConcept]), false);
});
