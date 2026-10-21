import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  buildImagePrompt,
  carSceneForRun,
  parseStructuredOutput,
  resolveImageGenerationOptions,
} from './generation.js';
import { resolveCarReference } from './cars.js';
import { normalizeCreativeDirection } from './rules.js';

test('Feed uses the validated 4:5 size while Reel keeps the vertical size', () => {
  assert.deepEqual(resolveImageGenerationOptions('Feed 4:5'), {
    size: '1024x1280',
    quality: 'medium',
  });
  assert.deepEqual(resolveImageGenerationOptions('Reel'), {
    size: '1024x1536',
    quality: 'medium',
  });
});

test('image quality can be benchmarked at high but never resolves to low', () => {
  assert.deepEqual(resolveImageGenerationOptions('Feed 4:5', {
    size: '1024x1536',
    quality: 'high',
  }), {
    size: '1024x1536',
    quality: 'high',
  });
  assert.equal(resolveImageGenerationOptions('Feed 4:5', { quality: 'low' }, 'low').quality, 'medium');
});

test('structured output falls back to valid output_text when output_parsed is null', () => {
  const schema = z.object({ direction: z.string() });
  assert.deepEqual(parseStructuredOutput({
    output_parsed: null,
    output_text: '{"direction":"coastal morning"}',
  }, schema), { direction: 'coastal morning' });
});

test('the final car prompt fixes a server reference and excludes a contradictory mini-plan identity', () => {
  const direction = normalizeCreativeDirection({ universe: 'cars', moment: 'night', style: 'dynamic', carType: 'convertible' });
  direction.carContext = resolveCarReference('convertible', [], 'prompt-test');
  const prompt = buildImagePrompt('A fictional six-door Ferrari SUV with a fixed roof and six wheels.', direction, 'Reel', 'stable-scene');
  assert.ok(prompt.includes(direction.carContext.manufacturer));
  assert.ok(prompt.includes(direction.carContext.model));
  assert.ok(prompt.includes(direction.carContext.variant));
  assert.ok(prompt.includes('convertible'));
  assert.match(prompt, /empattement|wheelbase/i);
  assert.match(prompt, /9:16/);
  assert.match(prompt, /Nuit/);
  assert.match(prompt, /Dynamique/);
  assert.match(prompt, /aucun texte, logo, filigrane, marque visible ou visage reconnaissable/);
  assert.doesNotMatch(prompt, /Ferrari|six-door|fixed roof|six wheels/);
  assert.equal(carSceneForRun('stable-scene'), carSceneForRun('stable-scene'));
});

test('non-car prompt and format preserve the existing visual direction', () => {
  const direction = normalizeCreativeDirection({ universe: 'boats', moment: 'night', style: 'dynamic' });
  const prompt = buildImagePrompt('A yacht on calm open water.', direction, 'Feed 4:5');
  assert.match(prompt, /Direction visuelle: A yacht on calm open water\./);
  assert.match(prompt, /Bateaux/);
  assert.match(prompt, /4:5/);
  assert.doesNotMatch(prompt, /référence automobile|automobile canonique|Scène photographique imposée/i);
});

test('car image prompt takes a separately controlled scenery pair and ignores free image text', () => {
  const direction = normalizeCreativeDirection({ universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv' });
  direction.carContext = resolveCarReference('suv', [], 'scenery-test');
  const courtyard = {
    scene_summary: 'A mineral courtyard opens between tall pines and a shaded stone wall.',
    visual_signature: 'The foreground holds small gravel textures while irregular foliage shadows cross cream paving.',
  };
  const coast = {
    scene_summary: 'A quiet coastal turnout overlooks pale turquoise water and distant limestone cliffs.',
    visual_signature: 'The horizon is wide above coarse grey tarmac and a soft band of sea haze.',
  };
  const first = buildImagePrompt('Ferrari coupe beside an invented hotel.', direction, 'Feed 4:5', 'same-run', courtyard);
  const second = buildImagePrompt('An invented six-door convertible.', direction, 'Feed 4:5', 'same-run', coast);
  assert.notEqual(first, second);
  for (const [prompt, scenery] of [[first, courtyard], [second, coast]]) {
    assert.ok(prompt.includes(scenery.scene_summary));
    assert.ok(prompt.includes(scenery.visual_signature));
    assert.ok(prompt.includes(direction.carContext.referenceId));
    assert.doesNotMatch(prompt, /Ferrari|invented hotel|six-door/);
  }
});

test('car scenery refuses the entire pair when either descriptor or the moment is incompatible', () => {
  const direction = normalizeCreativeDirection({ universe: 'cars', moment: 'night', style: 'elegant', carType: 'suv' });
  direction.carContext = resolveCarReference('suv', [], 'fallback-test');
  const prompt = buildImagePrompt('A free image prompt must remain unused.', direction, 'Feed 4:5', 'fallback-run', {
    scene_summary: 'A mineral courtyard opens between tall pines and a shaded stone wall.',
    visual_signature: 'Morning light traces rough plaster and slender dark trunks.',
  });
  assert.ok(prompt.includes(carSceneForRun('fallback-run')));
  assert.doesNotMatch(prompt, /Morning light|opens between tall pines|free image prompt/);
});
