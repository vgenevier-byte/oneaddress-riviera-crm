// Only external boundaries are substituted locally; all prompts, parsing, music
// selection, persistence and authorization use the production engine.
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { put as blobPut, del as blobDelete, get as blobGet } from '@vercel/blob';
import { beforeExternalCall, currentOperation } from './context.js';
import { localSimulation, publisherConfig, requireEnv } from './env.js';
import { PublisherError } from './operations.js';

let openai;
export function assertGenerationEnabled() {
  if (!localSimulation() && process.env.PUBLISHER_EXTERNAL_CALLS_ENABLED !== '1') {
    throw new PublisherError(503, 'La génération externe nécessite une activation explicite.');
  }
}
async function paid() {
  assertGenerationEnabled();
  await beforeExternalCall();
  if (localSimulation()) {
    const delay = Math.min(Math.max(Number(process.env.PUBLISHER_SIMULATION_DELAY_MS) || 400, 0), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
    await beforeExternalCall();
    // Private loopback fixture control, never accepted from an HTTP body/header.
    if (process.env.PUBLISHER_SIMULATION_CONTROL_FILE) {
      const file = path.resolve(process.env.PUBLISHER_SIMULATION_CONTROL_FILE);
      if (!file.startsWith('/private/tmp/') && !file.startsWith('/tmp/')) throw new Error('Invalid fixture control path');
      const control = await readFile(file, 'utf8').catch(() => '');
      if (control.trim() === 'fail') throw new Error('Simulated provider outage');
    }
  }
}
export function client() {
  return {
    responses: { parse: async request => {
      await paid();
      if (localSimulation()) return { output_parsed: simulateText(request) };
      openai ||= new OpenAI({ apiKey: publisherConfig().openAIKey, maxRetries: 0 });
      return openai.responses.parse(request);
    } },
    images: { generate: async request => {
      await paid();
      if (localSimulation()) return { data: [{ b64_json: simulatedImage(request.size).toString('base64') }] };
      openai ||= new OpenAI({ apiKey: publisherConfig().openAIKey, maxRetries: 0 });
      return openai.images.generate(request);
    } },
  };
}
function simulateText(request) {
  const name = request.text.format.name;
  const input = JSON.parse(request.input.find(item => item.role === 'user').content);
  const stamp = currentOperation().requestId.replaceAll('-', '');
  const suffix = Array.from({ length: 12 }, (_, index) => `${stamp}${index}`).join(' ');
  const caption = `The coast welcomes a quiet new perspective in local study ${stamp.slice(0, 12)}. Light unfolds over the Riviera.`;
  const hashtags = ['#RivieraLight', '#CoastalMoment', '#Mediterranean', '#PrivateEscape'];
  if (name === 'publisher_editorial_package') return {
    caption, hashtags, music: input.musiques_eligibles.slice(0, 3), location: 'French Riviera',
  };
  if (name === 'publisher_text') return { caption: `The Riviera reveals another quiet moment in local study ${stamp.slice(0, 12)}. The light moves gently across the sea.`, hashtags };
  const visual = {
    image_prompt: 'Local simulated provider output for an editorial coastal landscape, luminous blue water and soft golden light, without any external service call. ' + stamp,
    visual_signature: `Simulation ${stamp}`,
  };
  if (name === 'publisher_image_prompt') return visual;
  // Unique fixture tokens exercise the original anti-repetition rules unchanged.
  return { ...visual, scene_summary: suffix.slice(0, 310), format: input.direction_creative_obligatoire?.univers === 'Bateaux' ? 'Reel' : 'Feed 4:5' };
}
function simulatedImage(size) {
  const [width, height] = size.split('x').map(Number);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1024 1280"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#edd9aa"/><stop offset="1" stop-color="#a1c3c7"/></linearGradient><linearGradient id="sea" x2="0" y2="1"><stop stop-color="#487985"/><stop offset="1" stop-color="#153e53"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1024v640H0z"/><circle cx="720" cy="335" r="92" fill="#f8edd0"/><path fill="#5c7984" d="M0 580 150 420 290 550 425 480 590 640H0z"/><path fill="url(#sea)" d="M0 610h1024v670H0z"/><path fill="#d2c9ac" d="M0 890q240-230 340-100T670 960L320 1280H0z"/><path fill="#386369" d="M0 970q230-200 320-70L0 1280z"/><text x="512" y="1080" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff">DÉMONSTRATION LOCALE</text><text x="512" y="1125" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#fff">Génération simulée · aucun appel payant</text></svg>`);
}
function localFile(pathname) {
  const root = path.resolve(requireEnv('PUBLISHER_LOCAL_MEDIA_DIR'));
  if (!root.startsWith('/private/tmp/') && !root.startsWith('/tmp/')) throw new Error('Local media must use an isolated temporary directory.');
  if (!/^publisher\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[a-zA-Z0-9-]+\.(jpg|png|svg)$/.test(pathname)) throw new Error('Invalid media path.');
  return path.join(root, pathname);
}
export async function put(pathname, body, options) {
  if (!localSimulation()) {
    await beforeExternalCall();
    return blobPut(pathname, body, { ...options, token: requireEnv('PUBLISHER_BLOB_READ_WRITE_TOKEN') });
  }
  const file = localFile(pathname);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, { mode: 0o600 });
  return { url: `https://local-simulation.private.blob.vercel-storage.com/${pathname}`, pathname, contentType: 'image/svg+xml' };
}
export async function del(url) {
  if (!localSimulation()) return blobDelete(url, { token: requireEnv('PUBLISHER_BLOB_READ_WRITE_TOKEN') });
  await unlink(localFile(new URL(url).pathname.slice(1))).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
export async function get(pathname) {
  if (!localSimulation()) return blobGet(pathname, { access: 'private', token: requireEnv('PUBLISHER_BLOB_READ_WRITE_TOKEN') });
  const body = await readFile(localFile(pathname)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!body) return null;
  return { statusCode: 200, stream: new Blob([body]).stream(), blob: { contentType: 'image/svg+xml', size: body.byteLength } };
}
