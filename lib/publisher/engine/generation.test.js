import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  parseStructuredOutput,
  resolveImageGenerationOptions,
} from './generation.js';

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
