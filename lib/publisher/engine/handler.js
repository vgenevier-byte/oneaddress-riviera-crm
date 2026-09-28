import { createClient } from '@supabase/supabase-js';
import { publisherContext } from './context.js';
import { publisherConfig, localSimulation, requireEnv } from './env.js';
import { normalizeCreativeDirection } from './rules.js';
import {
  claimGuidedGeneration, claimTodayGeneration, claimRegeneration, getPostById,
  getPostByRequestId, getTodayPost, hydratePostWithMusic, listHistory,
  markPublished, normalizeGenerationProgress, setMusicStatus,
} from './db.js';
import { generateClaimedPost, regenerateImage, regenerateText } from './generation.js';
import { assertGenerationEnabled, get } from './provider.js';
import { claimOperation, finishOperation, PublisherError } from './operations.js';
import { query } from './database.js';

const readActions = new Set(['session', 'today', 'history', 'status', 'image', 'export', 'export-text']);
const writeActions = new Set(['generate', 'regenerate-text', 'regenerate-image', 'music-status', 'publish']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => Response.json(body, { status, headers });

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Bearer-only clients; no cookie authentication.
  try {
    const parsed = new URL(origin);
    // Next's Node adapter can normalize request.url to localhost. HTTP Host is
    // the browser's actual destination; never accept x-forwarded-host as input.
    const host = request.headers.get('host') || url.host;
    return origin === parsed.origin && ['http:', 'https:'].includes(parsed.protocol)
      && parsed.protocol === url.protocol && parsed.host === host;
  } catch { return false; }
}

async function authorize(request, action) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new PublisherError(401, 'Authentification CRM requise.');
  const client = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const user = await client.auth.getUser(token);
  if (user.error || !user.data.user) throw new PublisherError(401, 'Session CRM invalide ou expirée.');
  async function check() {
    const result = await client.rpc('crm_authorize_publisher', { p_action: action });
    if (result.error) throw new PublisherError(503, 'Vérification des droits indisponible.');
    if (result.data !== true) throw new PublisherError(403, 'Accès Publisher non autorisé.');
  }
  await check();
  return { actor: user.data.user.id, check };
}
function requireId(value) { if (!uuid(value)) throw new PublisherError(400, 'Identifiant invalide.'); return value; }
function requireRevision(value) { if (!Number.isSafeInteger(value) || value < 1) throw new PublisherError(400, 'Révision requise.'); }
async function currentPost(id, revision) {
  const post = await getPostById(requireId(id));
  if (!post) throw new PublisherError(404, 'Création introuvable.');
  if (revision !== undefined) {
    requireRevision(revision);
    if (Number(post.revision) !== revision) throw new PublisherError(409, 'Cette création a changé. Votre brouillon est conservé ; rechargez la version actuelle pour comparer.');
  }
  return post;
}
async function state(post) {
  if (!post) return { state: 'empty' };
  if (post.generation_status === 'ready') return { state: 'ready', post: await hydratePostWithMusic(post) };
  if (post.generation_status === 'error') return { state: 'error', error: 'Cette génération a été interrompue. Une nouvelle demande doit être explicite.' };
  return { state: 'preparing', id: String(post.id), progress: normalizeGenerationProgress(post.generation_progress, post.generation_status) };
}

async function read(action, url) {
  if (action === 'session') return json({ authenticated: true, simulated: localSimulation() });
  if (action === 'history') return json({ posts: await listHistory(30) });
  if (action === 'today') return json(await state(await getTodayPost(publisherConfig().timezone)));
  if (action === 'status') {
    const id = url.searchParams.get('id');
    const requestId = url.searchParams.get('requestId');
    if (!id && requestId) {
      requireId(requestId);
      const operations = await query('SELECT state,result FROM publisher_operations WHERE request_id=$1 AND actor_id=$2', [requestId, publisherContext.getStore().actor]);
      const operation = operations[0];
      if (operation?.state === 'failed') return json({ state: 'error', terminal: true, error: 'Cette demande a échoué. Une nouvelle tentative doit être explicite.' });
      if (operation?.result?.recoveryPostId) return json(await state(await currentPost(operation.result.recoveryPostId)));
      if (operation?.state === 'complete' && operation.result?.post) return json({ state: 'ready', post: operation.result.post });
      const post = await getPostByRequestId(requestId);
      if (post) return json(await state(post));
      if (operation?.state === 'running') return json({ state: 'preparing', id: null, progress: normalizeGenerationProgress({}, 'generating') });
      throw new PublisherError(404, 'Création introuvable.');
    }
    const post = await getPostById(requireId(id));
    if (!post) throw new PublisherError(404, 'Création introuvable.');
    return json(await state(post));
  }
  const post = await currentPost(url.searchParams.get('id'));
  if (action === 'export-text') return json({ ok: true });
  if (!post.image_pathname) throw new PublisherError(404, 'Visuel introuvable.');
  const blob = await get(post.image_pathname);
  if (!blob?.stream || blob.statusCode === 304) throw new PublisherError(404, 'Visuel introuvable.');
  // Buffer before the final access check: revocation during remote retrieval must
  // not leak the fetched body. Historical source images are bounded by this cap.
  if (blob.blob.size > 25 * 1024 * 1024) throw new PublisherError(413, 'Visuel trop volumineux.');
  const bytes = await new Response(blob.stream).arrayBuffer();
  if (bytes.byteLength > 25 * 1024 * 1024) throw new PublisherError(413, 'Visuel trop volumineux.');
  const extension = blob.blob.contentType === 'image/svg+xml' ? 'svg' : 'jpg';
  return new Response(bytes, { headers: { ...headers, 'Content-Type': blob.blob.contentType || 'image/jpeg',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `${action === 'export' ? 'attachment' : 'inline'}; filename="oar-${String(post.post_date).slice(0, 10)}.${extension}"` } });
}
function validatedBody(action, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublisherError(400, 'Demande invalide.');
  requireId(body.requestId);
  // Canonical whitelist also makes idempotency independent of object key order.
  if (action === 'generate') {
    if (!['daily', 'guided'].includes(body.mode)) throw new PublisherError(400, 'Mode invalide.');
    let direction;
    try { direction = normalizeCreativeDirection(body.direction); } catch { throw new PublisherError(400, 'Les trois choix créatifs sont obligatoires.'); }
    return { requestId: body.requestId, mode: body.mode, direction: { universe: direction.universeKey, moment: direction.momentKey, style: direction.styleKey } };
  }
  requireRevision(body.revision);
  if (action === 'music-status') {
    requireId(body.postId); requireRevision(body.musicRevision);
    if (!Number.isSafeInteger(body.id) || body.id < 1 || !['available', 'unavailable', 'unknown'].includes(body.status)) throw new PublisherError(400, 'Musique invalide.');
    return { requestId: body.requestId, id: body.id, postId: body.postId, revision: body.revision, musicRevision: body.musicRevision, status: body.status };
  }
  requireId(body.id);
  if (action === 'publish') {
    if (!Number.isSafeInteger(body.musicId) || body.musicId < 1) throw new PublisherError(400, 'Musique invalide.');
    return { requestId: body.requestId, id: body.id, revision: body.revision, musicId: body.musicId };
  }
  return { requestId: body.requestId, id: body.id, revision: body.revision };
}
async function mutate(action, body) {
  if (action === 'generate') {
    const direction = normalizeCreativeDirection(body.direction);
    const claim = await (body.mode === 'daily' ? claimTodayGeneration : claimGuidedGeneration)(publisherConfig().timezone, direction, body.requestId);
    if (claim.post?.id) await query('UPDATE publisher_operations SET target_post_id=$2 WHERE request_id=$1', [body.requestId, claim.post.id]);
    if (claim.decision !== 'claim') return state(claim.post);
    return { state: 'ready', post: await generateClaimedPost(claim.runId, claim.dateKey, direction) };
  }
  const post = await currentPost(action === 'music-status' ? body.postId : body.id, body.revision);
  if (action === 'music-status') {
    if (![Number(post.primary_music_id), ...(post.alternative_music_ids || []).map(Number)].includes(body.id)) throw new PublisherError(404, 'Musique étrangère à cette création.');
    const musicRows = await query('SELECT revision FROM publisher_music WHERE id=$1', [body.id]);
    if (Number(musicRows[0]?.revision) !== body.musicRevision) throw new PublisherError(409, 'Cette musique a changé. Votre sélection est conservée.');
    const music = await setMusicStatus(body.id, body.status);
    return { music, post: await hydratePostWithMusic(await getPostById(body.postId)) };
  }
  if (action === 'publish') {
    const published = await markPublished(body.id, body.musicId);
    if (!published) throw new PublisherError(409, 'Cette création ne peut pas être marquée comme publiée.');
    return { post: published };
  }
  const claim = await claimRegeneration(body.id);
  if (!claim) throw new PublisherError(409, 'Seul un brouillon prêt peut être régénéré.');
  return { post: await (action === 'regenerate-text' ? regenerateText : regenerateImage)(claim.runId, claim.post) };
}

export async function handlePublisher(request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'session';
    // No legacy login, shared cookie, benchmark override or supplied role path.
    if (!readActions.has(action) && !writeActions.has(action)) throw new PublisherError(404, 'Action Publisher inconnue.');
    const mutation = writeActions.has(action);
    if (request.method !== (mutation ? 'POST' : 'GET')) throw new PublisherError(405, 'Méthode refusée.');
    if (mutation && !sameOrigin(request, url)) throw new PublisherError(403, 'Origine refusée.');
    const auth = await authorize(request, action);
    return await publisherContext.run({ ...auth }, async () => {
      if (!mutation) {
        const response = await read(action, url);
        await auth.check();
        return response;
      }
      if (Number(request.headers.get('content-length')) > 16384) throw new PublisherError(413, 'Demande trop volumineuse.');
      const raw = await request.text();
      if (raw.length > 16384) throw new PublisherError(413, 'Demande trop volumineuse.');
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new PublisherError(400, 'JSON invalide.'); }
      const body = validatedBody(action, parsed);
      publisherContext.getStore().requestId = body.requestId;
      if (['generate', 'regenerate-text', 'regenerate-image'].includes(action)) assertGenerationEnabled();
      await auth.check();
      const operation = await claimOperation(action, body);
      if (!operation.claimed) {
        await auth.check();
        if (operation.result?.recoveryPostId) {
          const post = await hydratePostWithMusic(await currentPost(operation.result.recoveryPostId));
          await auth.check();
          return json(action === 'generate' ? { state: 'ready', post } : { post });
        }
        return json(operation.pending ? { state: 'preparing', id: body.id || null, progress: normalizeGenerationProgress({}, 'generating') } : operation.result, operation.pending ? 202 : 200);
      }
      let result;
      try {
        await auth.check();
        result = await mutate(action, body);
        await finishOperation(body.requestId, result);
      } catch (error) {
        if (error.persistedPostId) {
          await finishOperation(body.requestId, { recoveryPostId: error.persistedPostId });
        } else {
          await finishOperation(body.requestId, null, true);
          error.terminal = true;
        }
        throw error;
      }
      await auth.check();
      return json(result, result.state === 'preparing' ? 202 : 200);
    });
  } catch (error) {
    if (error instanceof PublisherError) return json({ error: error.message, ...(error.terminal ? { terminal: true } : {}) }, error.status);
    // Never serialize provider errors, connection strings, tokens or SQL.
    console.error('Publisher request failed', { type: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'Le Publisher rencontre une erreur temporaire. Votre saisie est conservée.', ...(error?.terminal ? { terminal: true } : {}) }, 503);
  }
}
