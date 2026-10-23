import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanCaption,
  EditorialPackageSchema,
  normalizeLocationValue,
  normalizeGeneratedPost,
  normalizeRegeneratedText,
} from './schemas.js';
import { resolveCarReference } from './cars.js';

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
  assert.equal(post.caption, 'The day slows off the Esterel coast. Book your next yacht experience on the French Riviera with One Address Riviera.');
  assert.equal(post.hashtags.length, 5);
  assert.equal(post.hashtags[0], '#OneAddressRiviera');
  assert.equal(post.location, 'French Riviera');
});

test('an invitation in third position survives while surplus mood and duplicate invitations do not', () => {
  const invitation = 'Reserve your next escape to the French Riviera with One Address Riviera.';
  const value = `The sea glows in the evening light. The coast settles into silence. ${invitation}`;
  assert.equal(cleanCaption(value), `The sea glows in the evening light. ${invitation}`);
  assert.equal(cleanCaption(`${value} ${invitation}`), cleanCaption(value));
  assert.equal(cleanCaption(cleanCaption(value)), cleanCaption(value));
});

test('long and emoji captions retain a complete English booking invitation within 36 words', () => {
  const caption = cleanCaption(`The ${'beautiful '.repeat(38)}coast welcomes you 🌊. A new perspective awaits.`);
  assert.equal(caption.split(/\s+/u).length <= 36, true);
  assert.equal([...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(caption)].length, 2);
  assert.doesNotMatch(caption, /\p{Extended_Pictographic}/u);
  assert.match(caption, /Book your next escape.*with One Address Riviera\.$/u);
});

test('numeric sentence openings and standalone emoji modifiers cannot defeat caption limits', () => {
  const caption = cleanCaption('Quiet horizons invite you 🏽. 36 hours on the coast feel timeless. Reserve your next escape to the French Riviera with One Address Riviera.');
  assert.equal(caption, 'Quiet horizons invite you. Reserve your next escape to the French Riviera with One Address Riviera.');
  assert.equal(cleanCaption('The coast calls you.Book your next escape to the French Riviera with One Address Riviera.'), 'The coast calls you. Book your next escape to the French Riviera with One Address Riviera.');
});

test('locked car identity alone authorizes the model invitation, including numbered model names', () => {
  const car_context = resolveCarReference({ carType: 'suv', carBrand: 'lamborghini', carModel: 'lamborghini-urus-se-suv-2024' });
  const context = { theme: 'automobile', car_context };
  const caption = cleanCaption('The coast welcomes a quiet arrival. Book your next ride in a Ferrari on the French Riviera.', context);
  assert.match(caption, /Book your next ride in a Lamborghini Urus SE on the French Riviera with One Address Riviera\.$/u);
  assert.doesNotMatch(caption, /Ferrari/u);
  const generic = cleanCaption(caption, { theme: 'automobile', scene_summary: 'A Lamborghini Urus SE', car_context: null });
  assert.match(generic, /Book your next ride on the French Riviera with One Address Riviera\.$/u);
  assert.doesNotMatch(generic, /Lamborghini|Urus/u);
  assert.doesNotMatch(cleanCaption('A Porsche 911 caresses every curve. The coastline opens ahead.', { theme: 'automobile' }), /Porsche|911/u);
  assert.throws(() => cleanCaption(caption, { theme: 'automobile', car_context: { model: 'forged' } }), /automobile/u);
});

test('a decimal car model survives sentence splitting without an extra sentence', () => {
  const car_context = resolveCarReference({ carType: 'supercar', carBrand: 'bugatti', carModel: 'bugatti-veyron-16-4-2005-coupe' });
  const invitation = `Reserve your next ride in a ${car_context.manufacturer} ${car_context.model} on the French Riviera with One Address Riviera.`;
  const caption = cleanCaption(`The coastal road calls you. ${invitation}`, { theme: 'automobile', car_context });
  assert.equal(caption, `The coastal road calls you. ${invitation}`);
});

test('unsafe offers and fictitious villa claims give way to an invitation for a Riviera stay', () => {
  for (const invitation of [
    'Book this villa on the French Riviera with One Address Riviera for €500.',
    'Reserve your next stay on the French Riviera with One Address Riviera available tomorrow.',
    'Book your next stay in our villa on the French Riviera with One Address Riviera.',
  ]) {
    const caption = cleanCaption(`Imagine warm mornings above the sea. ${invitation}`, { theme: 'immobilier' });
    assert.equal(caption, 'Imagine warm mornings above the sea. Book your next stay on the French Riviera with One Address Riviera.');
  }
});

test('French hooks are rejected even when followed by an English booking sentence', () => {
  assert.throws(() => cleanCaption('Le soleil éclaire la côte. Book your next escape to the French Riviera with One Address Riviera.'), /anglais/u);
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
