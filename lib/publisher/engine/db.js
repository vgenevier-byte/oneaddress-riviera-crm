import { randomUUID } from 'node:crypto';
import { sql } from './database.js';

import {
  chooseMusic,
  generationClaimDecision,
  normalizeDateKey,
  todayInTimezone,
} from './rules.js';


const INITIAL_PROGRESS = {
  direction: 'working',
  visual: 'pending',
  editorial: 'pending',
  music: 'pending',
  finalization: 'pending',
};

const COMPLETE_PROGRESS = {
  direction: 'done',
  visual: 'done',
  editorial: 'done',
  music: 'done',
  finalization: 'done',
};

// Schema installation is an explicit release step, never a side effect of a read.
export async function ensurePublisherSchema() {
  await sql()`SELECT revision, created_by, updated_by FROM publisher_posts LIMIT 0`;
}

export async function getPostById(id) {
  await ensurePublisherSchema();
  const rows = await sql()`SELECT * FROM publisher_posts WHERE id = ${id}`;
  return rows[0] || null;
}

export async function isPublisherImageReferenced(url) {
  const rows = await sql()`SELECT 1 FROM publisher_posts WHERE image_url = ${url} LIMIT 1`;
  return rows.length > 0;
}

export async function committedPostForRun(runId) {
  const rows = await sql()`SELECT id FROM publisher_posts WHERE generation_run_id = ${runId} AND generation_status = 'ready' LIMIT 1`;
  return rows[0]?.id || null;
}

export async function getPostByRequestId(requestId) {
  await ensurePublisherSchema();
  const rows = await sql()`
    SELECT * FROM publisher_posts WHERE generation_request_id = ${requestId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getTodayPost(timezone) {
  await ensurePublisherSchema();
  const dateKey = todayInTimezone(timezone);
  const rows = await sql()`
    SELECT * FROM publisher_posts
    WHERE post_date = ${dateKey} AND creation_mode = 'daily'
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function claimTodayGeneration(timezone, direction, requestId) {
  await ensurePublisherSchema();
  const dateKey = todayInTimezone(timezone);
  const runId = randomUUID();
  const existingRows = await sql()`
    SELECT * FROM publisher_posts
    WHERE post_date = ${dateKey} AND creation_mode = 'daily'
    LIMIT 1
  `;
  const existing = existingRows[0];
  const decision = generationClaimDecision(existing);
  if (decision !== 'claim') {
    return { decision, dateKey, post: existing || null };
  }

  const rows = await sql()`
    INSERT INTO publisher_posts (
      id, post_date, creation_mode, creative_universe, creative_moment,
      creative_style, generation_request_id, generation_status,
      generation_run_id, generation_started_at, generation_progress
    ) VALUES (
      ${randomUUID()}, ${dateKey}, 'daily', ${direction.universe},
      ${direction.moment}, ${direction.style}, ${requestId}, 'generating',
      ${runId}, NOW(), ${JSON.stringify(INITIAL_PROGRESS)}::jsonb
    )
    ON CONFLICT (post_date) WHERE creation_mode = 'daily' DO UPDATE SET
      creative_universe = ${direction.universe},
      creative_moment = ${direction.moment},
      creative_style = ${direction.style},
      generation_request_id = ${requestId},
      generation_status = 'generating',
      generation_run_id = ${runId},
      generation_started_at = NOW(),
      generation_progress = ${JSON.stringify(INITIAL_PROGRESS)}::jsonb,
      error_message = NULL,
      updated_at = NOW()
    WHERE publisher_posts.generation_status = 'error'
       OR publisher_posts.generation_started_at < NOW() - INTERVAL '5 minutes'
    RETURNING *
  `;
  if (rows[0]) {
    return { decision: 'claim', runId, dateKey, post: rows[0] };
  }
  const current = await getTodayPost(timezone);
  return {
    decision: current?.generation_status === 'ready' ? 'ready' : 'wait',
    dateKey,
    post: current,
  };
}

export async function claimGuidedGeneration(timezone, direction, requestId) {
  await ensurePublisherSchema();
  const dateKey = todayInTimezone(timezone);
  const runId = randomUUID();
  const rows = await sql()`
    INSERT INTO publisher_posts (
      id, post_date, creation_mode, creative_universe, creative_moment,
      creative_style, generation_request_id, generation_status,
      generation_run_id, generation_started_at, generation_progress
    ) VALUES (
      ${randomUUID()}, ${dateKey}, 'guided', ${direction.universe},
      ${direction.moment}, ${direction.style}, ${requestId}, 'generating',
      ${runId}, NOW(), ${JSON.stringify(INITIAL_PROGRESS)}::jsonb
    )
    ON CONFLICT (generation_request_id) WHERE generation_request_id IS NOT NULL
    DO NOTHING
    RETURNING *
  `;
  if (rows[0]) {
    return { decision: 'claim', runId, dateKey, post: rows[0] };
  }
  const existingRows = await sql()`
    SELECT * FROM publisher_posts WHERE generation_request_id = ${requestId}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;
  const decision = generationClaimDecision(existing);
  if (decision === 'claim' && existing) {
    const reclaimedRows = await sql()`
      UPDATE publisher_posts SET
        generation_status = 'generating',
        generation_run_id = ${runId},
        generation_started_at = NOW(),
        generation_progress = ${JSON.stringify(INITIAL_PROGRESS)}::jsonb,
        error_message = NULL,
        updated_at = NOW()
      WHERE generation_request_id = ${requestId}
        AND (
          generation_status = 'error'
          OR generation_started_at < NOW() - INTERVAL '5 minutes'
        )
      RETURNING *
    `;
    if (reclaimedRows[0]) {
      return { decision: 'claim', runId, dateKey, post: reclaimedRows[0] };
    }
  }
  return {
    decision: existing?.generation_status === 'ready' ? 'ready' : 'wait',
    dateKey,
    post: existing,
  };
}

export async function generationContext(dateKey) {
  await ensurePublisherSchema();
  const canonicalDateKey = normalizeDateKey(dateKey);
  const [history, recentContent, music, recentMusic] = await Promise.all([
    sql()`
      SELECT id, post_date, theme, moment, scene_summary, visual_signature,
             caption, hashtags, location, primary_music_id, alternative_music_ids,
             creation_mode, creative_universe, creative_moment, creative_style
      FROM publisher_posts
      WHERE generation_status = 'ready'
      ORDER BY post_date DESC
      LIMIT 30
    `,
    sql()`
      SELECT post_date, theme, moment, scene_summary, visual_signature, caption,
             creative_universe, creative_moment, creative_style
      FROM publisher_posts
      WHERE generation_status = 'ready'
        AND post_date > ${canonicalDateKey}::date - INTERVAL '14 days'
      ORDER BY post_date DESC
    `,
    sql()`SELECT * FROM publisher_music ORDER BY times_used ASC, id ASC`,
    sql()`
      SELECT DISTINCT music_id FROM (
        SELECT music_used_id AS music_id
        FROM publisher_posts
        WHERE music_used_id IS NOT NULL
          AND COALESCE(published_at, created_at) >= NOW() - INTERVAL '14 days'
        UNION ALL
        SELECT primary_music_id AS music_id
        FROM publisher_posts
        WHERE primary_music_id IS NOT NULL
          AND created_at >= NOW() - INTERVAL '14 days'
      ) recent
    `,
  ]);
  return {
    history: history.map(normalizeContextPostDate),
    recentContent: recentContent.map(normalizeContextPostDate),
    music,
    recentMusicIds: recentMusic.map(item => Number(item.music_id)),
  };
}

export async function updateGenerationProgress(runId, progress) {
  const rows = await sql()`
    UPDATE publisher_posts SET
      generation_progress = COALESCE(generation_progress, '{}'::jsonb)
        || ${JSON.stringify(progress)}::jsonb,
      updated_at = NOW()
    WHERE generation_run_id = ${runId} AND generation_status = 'generating'
    RETURNING id
  `;
  return Boolean(rows[0]);
}

export async function saveGeneratedPost(runId, generated, selectedMusic, image) {
  const [primary, ...alternatives] = selectedMusic;
  const rows = await sql()`
    UPDATE publisher_posts SET
      theme = ${generated.theme},
      moment = ${generated.moment},
      creative_universe = ${generated.creative_universe},
      creative_moment = ${generated.creative_moment},
      creative_style = ${generated.creative_style},
      scene_summary = ${generated.scene_summary},
      visual_signature = ${generated.visual_signature},
      caption = ${generated.caption},
      hashtags = ${generated.hashtags},
      primary_music_id = ${primary.id},
      alternative_music_ids = ${alternatives.map(song => Number(song.id))},
      location = ${generated.location},
      format = ${generated.format},
      image_url = ${image.url},
      image_pathname = ${image.pathname},
      image_prompt = ${generated.image_prompt},
      image_content_type = ${image.contentType},
      image_width = ${image.width},
      image_height = ${image.height},
      image_bytes = ${image.size},
      image_etag = ${image.etag || null},
      generation_progress = ${JSON.stringify(COMPLETE_PROGRESS)}::jsonb,
      generation_status = 'ready',
      error_message = NULL,
      updated_at = NOW()
    WHERE generation_run_id = ${runId} AND generation_status = 'generating'
    RETURNING *
  `;
  return rows[0] || null;
}

export async function failGeneration(runId, error) {
  await sql()`
    UPDATE publisher_posts SET
      generation_status = 'error',
      generation_progress = COALESCE(generation_progress, '{}'::jsonb)
        || ${JSON.stringify({ finalization: 'error' })}::jsonb,
      error_message = ${'La génération a été interrompue. Consultez son état avant toute nouvelle demande.'},
      updated_at = NOW()
    WHERE generation_run_id = ${runId} AND generation_status = 'generating'
  `;
}

export async function cancelRegeneration(runId, error) {
  await sql()`
    UPDATE publisher_posts SET
      generation_status = 'ready',
      error_message = ${'La génération a été interrompue. Consultez son état avant toute nouvelle demande.'},
      updated_at = NOW()
    WHERE generation_run_id = ${runId} AND status = 'draft' AND generation_status = 'generating'
  `;
}

export async function listHistory(limit = 30) {
  await ensurePublisherSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 30);
  const rows = await sql()`
    SELECT * FROM publisher_posts
    WHERE generation_status = 'ready'
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return Promise.all(rows.map(hydratePostWithMusic));
}

export async function hydratePostWithMusic(post) {
  if (!post) return null;
  const ids = [post.primary_music_id, ...(post.alternative_music_ids || [])]
    .filter(Boolean)
    .map(Number);
  const music = ids.length
    ? await sql()`SELECT * FROM publisher_music WHERE id = ANY(${ids})`
    : [];
  const byId = new Map(music.map(song => [Number(song.id), song]));
  return {
    ...serializePublisherPost(post),
    music: ids.map(id => byId.get(id)).filter(Boolean).map(hydrateMusic),
  };
}

export async function setMusicStatus(id, status) {
  await ensurePublisherSchema();
  if (!['available', 'unavailable', 'unknown'].includes(status)) return null;
  const rows = await sql()`
    UPDATE publisher_music SET availability_status = ${status}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ? hydrateMusic(rows[0]) : null;
}

export async function markPublished(postId, musicId) {
  await ensurePublisherSchema();
  const rows = await sql()`
    WITH published AS (
      UPDATE publisher_posts SET status = 'published', music_used_id = ${musicId},
        published_at = COALESCE(published_at, NOW()), updated_at = NOW()
      WHERE id = ${postId} AND generation_status = 'ready' AND status = 'draft'
        AND (${musicId} = primary_music_id OR ${musicId} = ANY(alternative_music_ids))
        AND EXISTS (SELECT 1 FROM publisher_music WHERE id = ${musicId} AND availability_status <> 'unavailable')
      RETURNING *
    ), music_update AS (
      UPDATE publisher_music SET last_used_at = NOW(), times_used = times_used + 1, updated_at = NOW()
      WHERE id = ${musicId} AND EXISTS (SELECT 1 FROM published) RETURNING id
    ) SELECT * FROM published
  `;
  if (!rows[0]) return null;
  return hydratePostWithMusic(rows[0]);
}

export async function claimRegeneration(postId) {
  await ensurePublisherSchema();
  const runId = randomUUID();
  const rows = await sql()`
    UPDATE publisher_posts SET
      generation_status = 'generating', generation_run_id = ${runId},
      generation_started_at = NOW(),
      generation_progress = ${JSON.stringify(INITIAL_PROGRESS)}::jsonb,
      error_message = NULL, updated_at = NOW()
    WHERE id = ${postId} AND status = 'draft' AND generation_status = 'ready'
    RETURNING *
  `;
  return rows[0] ? { runId, post: rows[0] } : null;
}

export async function finishTextRegeneration(runId, text) {
  const rows = await sql()`
    UPDATE publisher_posts SET caption = ${text.caption}, hashtags = ${text.hashtags},
      generation_status = 'ready', updated_at = NOW()
    WHERE generation_run_id = ${runId} AND status = 'draft'
    RETURNING *
  `;
  return rows[0] || null;
}

export async function finishImageRegeneration(runId, prompt, signature, image) {
  const rows = await sql()`
    UPDATE publisher_posts SET image_url = ${image.url}, image_pathname = ${image.pathname},
      image_prompt = ${prompt}, visual_signature = ${signature},
      image_content_type = ${image.contentType}, image_width = ${image.width}, image_height = ${image.height},
      image_bytes = ${image.size}, image_etag = ${image.etag || null},
      generation_status = 'ready', updated_at = NOW()
    WHERE generation_run_id = ${runId} AND status = 'draft'
    RETURNING *
  `;
  return rows[0] || null;
}

export function serializePublisherPost(post) {
  return {
    id: String(post.id),
    revision: Number(post.revision),
    created_by: post.created_by || null,
    updated_by: post.updated_by || null,
    created_at: post.created_at,
    updated_at: post.updated_at,
    post_date: normalizeDateKey(post.post_date),
    creation_mode: post.creation_mode || 'daily',
    creative_universe: post.creative_universe || legacyUniverse(post.theme),
    creative_moment: post.creative_moment || post.moment || '—',
    creative_style: post.creative_style || 'Éditorial',
    theme: post.theme,
    moment: post.moment,
    scene_summary: post.scene_summary,
    visual_signature: post.visual_signature,
    caption: post.caption,
    hashtags: post.hashtags || [],
    primary_music_id: post.primary_music_id ? Number(post.primary_music_id) : null,
    alternative_music_ids: (post.alternative_music_ids || []).map(Number),
    music_used_id: post.music_used_id ? Number(post.music_used_id) : null,
    location: post.location,
    format: post.format,
    status: post.status,
    generation_status: post.generation_status,
    generation_progress: normalizeGenerationProgress(post.generation_progress, post.generation_status),
    published_at: post.published_at,
    image_src: post.image_pathname
      ? `/api/publisher?action=image&id=${encodeURIComponent(post.id)}`
      : null,
  };
}

export function normalizeGenerationProgress(progress, status) {
  if (status === 'ready') return { ...COMPLETE_PROGRESS };
  const candidate = progress && typeof progress === 'object' ? progress : {};
  const allowed = new Set(['pending', 'working', 'done', 'error']);
  return Object.fromEntries(
    Object.entries(INITIAL_PROGRESS).map(([key, fallback]) => [
      key,
      allowed.has(candidate[key]) ? candidate[key] : fallback,
    ]),
  );
}

function legacyUniverse(theme) {
  const universes = {
    paysage: 'Paysages',
    plage: 'Paysages',
    immobilier: 'Immobilier',
    yacht: 'Bateaux',
    automobile: 'Voitures',
  };
  return universes[theme] || theme || 'Éditorial';
}

function normalizeContextPostDate(post) {
  return {
    ...post,
    post_date: normalizeDateKey(post.post_date),
  };
}

function hydrateMusic(song) {
  return {
    id: Number(song.id),
    revision: Number(song.revision),
    title: song.title,
    artist: song.artist,
    availability_status: song.availability_status,
    last_used_at: song.last_used_at,
    times_used: Number(song.times_used),
  };
}
