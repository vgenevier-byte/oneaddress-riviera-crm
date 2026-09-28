import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EditorialPackageSchema,
  normalizeLocationValue,
  normalizeGeneratedPost,
  normalizeRegeneratedText,
} from './schemas.js';

function generatedPost(overrides = {}) {
  return {
    theme: 'yacht',
    moment: 'Golden hour',
    scene_summary: 'A quiet anchorage facing the red cliffs of the Esterel.',
    visual_signature: 'Golden light, cream tones and a deep blue sea.',
    image_prompt: 'Highly realistic vertical editorial photograph of a yacht anchored before the red Esterel cliffs, warm natural golden light, no text, no logo and no recognizable face.',
    caption: 'The day slows off the Esterel coast. The Riviera finds its quiet.',
    hashtags: ['#CotedAzur', '#YachtLifestyle', '#LuxuryTravel', '#MediterraneanLiving'],
    music: [
      { title: 'A', artist: 'A' },
      { title: 'B', artist: 'B' },
      { title: 'C', artist: 'C' },
    ],
    location: 'French Riviera',
    format: 'Feed 4:5',
    ...overrides,
  };
}

test('English content is normalized to two short sentences and five hashtags', () => {
  const post = normalizeGeneratedPost(generatedPost({
    caption: 'The day slows off the Esterel coast. The Riviera finds its quiet. A third sentence is removed.',
  }));
  assert.equal(post.caption, 'The day slows off the Esterel coast. The Riviera finds its quiet.');
  assert.equal(post.hashtags.length, 5);
  assert.equal(post.hashtags[0], '#OneAddressRiviera');
  assert.equal(post.location, 'French Riviera');
});

test('guided generation accepts either Feed 4:5 or Reel output format', () => {
  assert.equal(normalizeGeneratedPost(generatedPost({ format: 'Feed 4:5' })).format, 'Feed 4:5');
  assert.equal(normalizeGeneratedPost(generatedPost({ format: 'Reel' })).format, 'Reel');
  assert.throws(() => normalizeGeneratedPost(generatedPost({ format: 'Story' })));
});

test('French captions are rejected for initial and regenerated text', () => {
  assert.throws(
    () => normalizeGeneratedPost(generatedPost({
      caption: 'Le jour ralentit au large. La Riviera retrouve son silence.',
    })),
    /anglais/,
  );
  assert.throws(
    () => normalizeRegeneratedText({
      caption: 'Une soirée discrète sur la Riviera.',
      hashtags: ['#CotedAzur', '#LuxuryTravel', '#RivieraLifestyle', '#PrivateLuxury'],
    }),
    /anglais/,
  );
});

test('fictional venues and precise locations are normalized to Aucun', () => {
  assert.equal(normalizeGeneratedPost(generatedPost({
    theme: 'hôtel',
    scene_summary: 'A fictional palace suite prepared for a private arrival.',
    location: 'French Riviera',
  })).location, 'Aucun');
  assert.equal(normalizeGeneratedPost(generatedPost({
    theme: 'gastronomie',
    scene_summary: 'An intimate dinner inside an imagined waterfront restaurant.',
    location: 'French Riviera',
  })).location, 'Aucun');
  assert.equal(normalizeGeneratedPost(generatedPost({
    location: 'Saint-Tropez',
  })).location, 'Aucun');
});

test('a location longer than 120 characters is normalized before post validation', () => {
  const longLocation = 'A fictional waterfront property address with a private entrance, descriptive directions, and many details that must never reach Instagram.';
  const editorial = EditorialPackageSchema.parse({
    caption: 'Quiet light follows the coast. The evening begins with ease.',
    hashtags: ['#RivieraEvening', '#MediterraneanLight', '#CoastalMood', '#PrivateEscape'],
    music: [
      { title: 'A', artist: 'A' },
      { title: 'B', artist: 'B' },
      { title: 'C', artist: 'C' },
    ],
    location: longLocation,
  });
  assert.equal(normalizeLocationValue(editorial.location), 'Aucun');
  assert.equal(normalizeGeneratedPost(generatedPost({ location: longLocation })).location, 'Aucun');
});

test('only canonical generic Instagram locations can survive normalization', () => {
  assert.equal(normalizeLocationValue('French Riviera'), 'French Riviera');
  assert.equal(normalizeLocationValue("Côte d'Azur"), 'Côte d’Azur');
  assert.equal(normalizeLocationValue('Saint-Jean-Cap-Ferrat'), 'Aucun');
  assert.equal(normalizeLocationValue('Aucun'), 'Aucun');
});
