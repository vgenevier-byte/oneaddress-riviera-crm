import { randomUUID } from 'node:crypto';
import { query, sql } from './database.js';
import { currentOperation } from './context.js';
import { validateCarContext } from './cars.js';
import { hydrateMusic, musicContextForFormat } from './music.js';

import {
  chooseMusic, eligibleMusic,
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
             creation_mode, creative_universe, creative_moment, creative_style, car_context
      FROM publisher_posts
      WHERE generation_status = 'ready'
      ORDER BY post_date DESC
      LIMIT 30
    `,
    sql()`
      SELECT post_date, theme, moment, scene_summary, visual_signature, caption,
             creative_universe, creative_moment, creative_style, car_context
      FROM publisher_posts
      WHERE generation_status = 'ready'
        AND post_date > ${canonicalDateKey}::date - INTERVAL '14 days'
      ORDER BY post_date DESC
    `,
    musicCatalogue(),
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
      car_context = ${generated.car_context ? JSON.stringify(generated.car_context) : null}::jsonb,
      scene_summary = ${generated.scene_summary},
      visual_signature = ${generated.visual_signature},
      caption = ${generated.caption},
      hashtags = ${generated.hashtags},
      primary_music_id = ${primary?.id || null},
      selected_music_id = ${primary?.id || null},
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
  const ids = [...new Set([post.primary_music_id, ...(post.alternative_music_ids || []), ...(post.status === 'published' ? [post.music_used_id] : [])]
    .filter(Boolean)
    .map(Number))];
  const music = ids.length
    ? await musicCatalogue(ids)
    : [];
  const byId = new Map(music.map(song => [Number(song.id), song]));
  const scope = musicContextForFormat(post.format);
  const songs = ids.map(id => byId.get(id)).filter(Boolean).map(song => hydrateMusic(song, scope));
  const confirmed = songs.filter(song => song.availability_status === 'available');
  const selected = Number(post.selected_music_id);
  return {
    ...serializePublisherPost(post),
    selected_music_id: post.status === 'published' ? Number(post.music_used_id) || null
      : confirmed.some(song => song.id === selected) ? selected : null,
    music_context: scope,
    music_state: confirmed.length >= 3 ? 'ready' : confirmed.length ? 'insufficient' : 'none',
    music: songs,
  };
}

async function musicCatalogue(ids = null) {
  return query(`SELECT m.*, COALESCE((SELECT jsonb_agg(c ORDER BY c.checked_at DESC,c.id DESC)
    FROM publisher_music_checks c WHERE c.music_id=m.id),'[]'::jsonb) AS verification_history
    FROM publisher_music m ${ids ? 'WHERE m.id=ANY($1)' : ''} ORDER BY m.times_used ASC,m.id ASC`, ids ? [ids] : []);
}

export async function setMusicStatus(post, id, musicRevision, status, proof) {
  const scope = musicContextForFormat(post.format);
  const rows = await query(`WITH target AS (
      SELECT p.id FROM publisher_posts p WHERE p.id=$1 AND p.revision=$2 AND p.status='draft' AND p.generation_status='ready'
        AND ($3=p.primary_music_id OR $3=ANY(p.alternative_music_ids)) FOR UPDATE
    ), changed AS (
      UPDATE publisher_music SET updated_at=now() WHERE id=$3 AND revision=$4 AND EXISTS(SELECT 1 FROM target) RETURNING *
    ), checked AS (
      INSERT INTO publisher_music_checks(music_id,account,context,status,method,checked_by,title,artist,version,instagram_audio_id,instagram_audio_url)
      SELECT id,$5,$6,$7,'manual_instagram',nullif(current_setting('publisher.actor',true),'')::uuid,title,artist,version,$8,$9 FROM changed RETURNING id
    ) UPDATE publisher_posts SET updated_at=now(),selected_music_id=CASE WHEN $7='confirmed' THEN selected_music_id WHEN selected_music_id=$3 THEN NULL ELSE selected_music_id END
      WHERE id=$1 AND EXISTS(SELECT 1 FROM checked) RETURNING *`,
  [post.id,post.revision,id,musicRevision,scope.account,scope.context,
    status === 'available' ? 'confirmed' : status === 'unavailable' ? 'not_found' : 'unknown',proof?.instagramAudioId || null,proof?.instagramAudioUrl || null]);
  return rows[0] ? hydratePostWithMusic(rows[0]) : null;
}

export async function replacePostMusic(post, musicId) {
  const context = await generationContext(post.post_date);
  const existing = [Number(post.primary_music_id), ...(post.alternative_music_ids || []).map(Number)].filter(Boolean);
  const [replacement] = chooseMusic(eligibleMusic(context.music, context.recentMusicIds, new Date(), musicContextForFormat(post.format))
    .filter(song => !existing.includes(song.id)), [], 1);
  if (!replacement) return { post: await hydratePostWithMusic(post), replacement: null, music_message: 'none' };
  const replacing = musicId || Number(post.selected_music_id || post.primary_music_id) || null;
  const nextIds = [replacement.id, ...existing.filter(id => id !== replacing)].slice(0, 3);
  const rows = await query(`UPDATE publisher_posts SET primary_music_id=$3,selected_music_id=$3,
      alternative_music_ids=$4::bigint[],updated_at=now()
    WHERE id=$1 AND revision=$2 AND status='draft' AND generation_status='ready' RETURNING *`,
  [post.id,post.revision,replacement.id,nextIds.slice(1)]);
  if (!rows[0]) return null;
  return { post: await hydratePostWithMusic(rows[0]), replacement, music_message: 'replaced' };
}

export async function confirmPostMusic(post, reference) {
  const scope = musicContextForFormat(post.format);
  const rows = await query(`WITH target AS (
      SELECT * FROM publisher_posts WHERE id=$1 AND revision=$2 AND status='draft' AND generation_status='ready'
        AND NOT EXISTS(SELECT 1 FROM publisher_music m WHERE lower(m.title)=lower($3) AND lower(m.artist)=lower($4) AND lower(m.version)=lower($5)
          AND (m.last_used_at>=now()-interval '14 days' OR EXISTS(SELECT 1 FROM publisher_posts recent
            WHERE recent.id<>$1 AND ((recent.music_used_id=m.id AND coalesce(recent.published_at,recent.created_at)>=now()-interval '14 days')
              OR (recent.primary_music_id=m.id AND recent.created_at>=now()-interval '14 days'))))) FOR UPDATE
    ), reference AS (
      INSERT INTO publisher_music(title,artist,version,source)
      SELECT $3,$4,$5,'manual_instagram' FROM target
      ON CONFLICT (lower(title),lower(artist),lower(version)) DO UPDATE SET updated_at=now() RETURNING *
    ), checked AS (
      INSERT INTO publisher_music_checks(music_id,account,context,status,method,checked_by,title,artist,version,instagram_audio_id,instagram_audio_url)
      SELECT id,$6,$7,'confirmed','manual_instagram',nullif(current_setting('publisher.actor',true),'')::uuid,title,artist,version,$8,$9 FROM reference RETURNING music_id
    ) UPDATE publisher_posts p SET primary_music_id=c.music_id,selected_music_id=c.music_id,
        alternative_music_ids=(SELECT ARRAY(SELECT DISTINCT song FROM unnest(array_prepend(p.primary_music_id,p.alternative_music_ids)) song WHERE song IS NOT NULL AND song<>c.music_id LIMIT 2)),updated_at=now()
      FROM checked c WHERE p.id=$1 AND EXISTS(SELECT 1 FROM target) RETURNING p.*`,
  [post.id,post.revision,reference.title,reference.artist,reference.version || '',scope.account,scope.context,reference.instagramAudioId || null,reference.instagramAudioUrl || null]);
  return rows[0] ? hydratePostWithMusic(rows[0]) : null;
}

export async function selectPostMusic(post, musicId) {
  const scope = musicContextForFormat(post.format);
  const rows = await query(`UPDATE publisher_posts p SET selected_music_id=$3,updated_at=now()
    WHERE p.id=$1 AND p.revision=$2 AND p.status='draft' AND p.generation_status='ready'
      AND ($3=p.primary_music_id OR $3=ANY(p.alternative_music_ids))
      AND (SELECT c.status FROM publisher_music_checks c WHERE c.music_id=$3 AND c.account=$4 AND c.context=$5
        ORDER BY c.checked_at DESC,c.id DESC LIMIT 1)='confirmed' RETURNING p.*`,
  [post.id,post.revision,musicId,scope.account,scope.context]);
  return rows[0] ? hydratePostWithMusic(rows[0]) : null;
}

export async function markPublished(postId, musicId, revision) {
  await ensurePublisherSchema();
  const rows = await sql()`
    WITH published AS (
      UPDATE publisher_posts SET status = 'published', music_used_id = ${musicId},
        published_at = COALESCE(published_at, NOW()), updated_at = NOW()
      WHERE id = ${postId} AND revision = ${revision} AND generation_status = 'ready' AND status = 'draft'
        AND (${musicId} = primary_music_id OR ${musicId} = ANY(alternative_music_ids))
        AND (SELECT c.status FROM publisher_music_checks c WHERE c.music_id=${musicId} AND c.account='one-address-riviera'
          AND c.context=CASE WHEN format ILIKE 'Reel%' THEN 'reel' ELSE 'feed' END
          ORDER BY c.checked_at DESC,c.id DESC LIMIT 1)='confirmed'
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

export async function finishImageRegeneration(runId, prompt, signature, image, carContext = null, carScenery = null) {
  const rows = await sql()`
    UPDATE publisher_posts SET image_url = ${image.url}, image_pathname = ${image.pathname},
      image_prompt = ${prompt}, visual_signature = ${carScenery?.visual_signature ?? signature},
      scene_summary = COALESCE(${carScenery?.scene_summary ?? null}, scene_summary),
      car_context = ${carContext ? JSON.stringify(carContext) : null}::jsonb,
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
    ...(post.car_context && isCarPost(post) ? { car_context: validateCarContext(post.car_context) } : {}),
    theme: post.theme,
    moment: post.moment,
    scene_summary: post.scene_summary,
    visual_signature: post.visual_signature,
    caption: post.caption,
    hashtags: post.hashtags || [],
    primary_music_id: post.primary_music_id ? Number(post.primary_music_id) : null,
    alternative_music_ids: (post.alternative_music_ids || []).map(Number),
    music_used_id: post.music_used_id ? Number(post.music_used_id) : null,
    selected_music_id: post.selected_music_id ? Number(post.selected_music_id) : null,
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
// Resolution occurs only after admission. The first canonical reference becomes
// durable before any provider call and cannot change on this operation's recovery.
export async function persistOperationCarContext(carContext) {
  const { requestId, actor } = currentOperation();
  const rows = await sql()`
    UPDATE publisher_operations
    SET car_context = COALESCE(car_context, ${JSON.stringify(validateCarContext(carContext))}::jsonb)
    WHERE request_id = ${requestId} AND actor_id = ${actor} AND state = 'running'
    RETURNING car_context
  `;
  if (!rows[0]?.car_context) throw new Error('Contexte automobile non journalisé.');
  return validateCarContext(rows[0].car_context);
}

export async function recentCarReferences() {
  return sql()`SELECT car_context FROM publisher_posts
    WHERE generation_status = 'ready' AND jsonb_typeof(car_context) = 'object'
    ORDER BY created_at DESC LIMIT 30`;
}

export function isCarPost(post) {
  return post.creative_universe === 'Voitures' || post.creative_universe === 'cars'
    || (!post.creative_universe && post.theme === 'automobile');
}
