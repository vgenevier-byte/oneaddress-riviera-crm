import { performance } from 'node:perf_hooks';
import { client, del, put } from './provider.js';
import { zodTextFormat } from 'openai/helpers/zod';
import { PUBLISHER_BLOB_ACCESS } from './constants.js';
import { publisherConfig } from './env.js';
import {
  CreativePlanSchema,
  EditorialPackageSchema,
  RegeneratedImagePromptSchema,
  RegeneratedTextSchema,
  normalizeLocationValue,
  normalizeGeneratedPost,
  normalizeRegeneratedText,
} from './schemas.js';
import {
  chooseMusic,
  eligibleMusic,
  hasRecentContentDuplicate,
  normalizeCreativeDirection,
  normalizeDateKey,
} from './rules.js';
import { isPrivateBlobUrl } from './storage.js';
import {
  cancelRegeneration,
  committedPostForRun,
  failGeneration,
  finishImageRegeneration,
  finishTextRegeneration,
  generationContext,
  hydratePostWithMusic,
  isPublisherImageReferenced,
  saveGeneratedPost,
  updateGenerationProgress,
} from './db.js';

const BRAND_BRIEF = `
One Address Riviera est une conciergerie privée haut de gamme sur la Côte d'Azur.
Ton éditorial: sophistiqué, discret, lumineux et concret; jamais tapageur.
Chaque publication doit évoquer un moment réellement désirable de la Riviera.
Le visuel ne doit contenir aucun texte, logo, filigrane, marque visible ou visage reconnaissable.
Style photographique éditorial premium, lumière naturelle, réalisme subtil, composition verticale 4:5.
La légende Instagram est impérativement en anglais, jamais en français. Elle contient toujours une ou deux phrases courtes, sans emoji ni appel commercial agressif.
Pour une propriété, un hôtel, un restaurant ou une adresse fictive générée par IA, la localisation doit être exactement "Aucun".
Une localisation générique comme "French Riviera" n'est permise que si le visuel ne peut pas être interprété comme la représentation d'une adresse réelle précise.
`;

export async function generateClaimedPost(runId, dateValue, directionValue, options = {}) {
  let image;
  let persistedPostId;
  const totalStartedAt = performance.now();
  const timings = {
    context_ms: 0,
    planning_ms: 0,
    editorial_ms: 0,
    image_generation_ms: 0,
    base64_conversion_ms: 0,
    blob_upload_ms: 0,
    database_ms: 0,
    hydration_ms: 0,
    total_ms: 0,
  };
  try {
    const dateKey = normalizeDateKey(dateValue);
    const direction = normalizeCreativeDirection(directionValue);
    const config = publisherConfig();
    const textModel = allowedTextModel(options.textModel)
      || allowedTextModel(config.textModel)
      || 'gpt-5.6-luna';
    const imageQuality = allowedImageQuality(options.imageQuality)
      || allowedImageQuality(config.imageQuality)
      || 'medium';
    const contextStartedAt = performance.now();
    const context = await generationContext(dateKey);
    timings.context_ms = elapsed(contextStartedAt);
    const candidates = eligibleMusic(
      context.music,
      context.recentMusicIds,
    );
    if (candidates.length < 3) {
      throw new Error('Moins de trois musiques éligibles après la fenêtre de 14 jours.');
    }

    const planningStartedAt = performance.now();
    const plan = await parseStructuredWithRetry({
      model: textModel,
      input: [
        {
          role: 'system',
          content: `${BRAND_BRIEF}\nProduis uniquement le mini-plan visuel demandé. Sois concret et compact.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            date: dateKey,
            direction_creative_obligatoire: {
              univers: direction.universe,
              univers_instruction: direction.universeGuidance,
              moment: direction.moment,
              moment_instruction: direction.momentGuidance,
              style: direction.style,
              style_instruction: direction.styleGuidance,
            },
            theme_impose: direction.theme,
            instruction_de_variation: 'Créer un concept entièrement nouveau. Le sujet principal, la lumière et le rythme doivent refléter exactement les trois choix et se distinguer clairement des créations récentes.',
            contenus_des_14_derniers_jours_a_ne_pas_reprendre: compactRecentContent(context.recentContent),
            contraintes: {
              visuel: 'photoréaliste premium, sans texte intégré',
              format: 'Choisir Feed 4:5 ou Reel selon le concept',
            },
          }),
        },
      ],
      reasoning: { effort: 'none' },
      max_output_tokens: 1400,
      store: false,
      text: {
        format: zodTextFormat(CreativePlanSchema, 'publisher_creative_plan'),
        verbosity: 'low',
      },
    }, CreativePlanSchema, 'planning');
    timings.planning_ms = elapsed(planningStartedAt);
    if (hasRecentContentDuplicate(plan, context.recentContent)) {
      throw new Error('La proposition répète un contenu des 14 derniers jours.');
    }

    const imagePromise = generateAndStoreImage(
      plan.image_prompt,
      dateKey,
      runId,
      direction,
      plan.format,
      {
        quality: imageQuality,
        size: allowedImageSize(options.imageSize),
      },
    ).then(async generatedImage => {
      image = generatedImage;
      Object.assign(timings, generatedImage.timings);
      await updateGenerationProgress(runId, { visual: 'done' });
      return generatedImage;
    }).catch(async error => {
      await updateGenerationProgress(runId, { visual: 'error' }).catch(() => undefined);
      throw error;
    });
    const editorialPromise = generateEditorialPackage(
      plan,
      direction,
      candidates,
      textModel,
    ).then(async result => {
      timings.editorial_ms = result.duration;
      await updateGenerationProgress(runId, { editorial: 'done', music: 'done' });
      return result.package;
    }).catch(async error => {
      await updateGenerationProgress(runId, { editorial: 'error', music: 'error' }).catch(() => undefined);
      throw error;
    });
    const progressPromise = updateGenerationProgress(runId, {
      direction: 'done',
      visual: 'working',
      editorial: 'working',
      music: 'working',
    });
    // Keep the durable admission until both accepted external calls settle,
    // including on partial failure. Do not release it while an image still runs.
    const results = await Promise.allSettled([progressPromise, imagePromise, editorialPromise]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [, generatedImage, editorial] = results.map(result => result.value);
    image = generatedImage;
    const generated = normalizeGeneratedPost({
      ...plan,
      ...editorial,
      location: normalizeLocationValue(editorial.location),
      theme: direction.theme,
      moment: direction.moment,
    });
    generated.creative_universe = direction.universe;
    generated.creative_moment = direction.moment;
    generated.creative_style = direction.style;
    if (hasRecentContentDuplicate(generated, context.recentContent)) {
      throw new Error('La proposition répète un contenu des 14 derniers jours.');
    }
    const selectedMusic = chooseMusic(candidates, editorial.music);
    if (selectedMusic.length !== 3) throw new Error('Sélection musicale incomplète.');
    await updateGenerationProgress(runId, { finalization: 'working' });
    const databaseStartedAt = performance.now();
    const saved = await saveGeneratedPost(runId, generated, selectedMusic, image);
    timings.database_ms = elapsed(databaseStartedAt);
    if (!saved) {
      await safeDelete(image.url);
      throw new Error('La génération a perdu son verrou idempotent.');
    }
    persistedPostId = String(saved.id);
    const hydrationStartedAt = performance.now();
    const hydrated = await hydratePostWithMusic(saved);
    timings.hydration_ms = elapsed(hydrationStartedAt);
    timings.total_ms = elapsed(totalStartedAt);
    const publicTimings = roundedTimings({
      ...timings,
      text_model: textModel,
      image_model: config.imageModel,
      image_quality: image.quality,
      image_size: image.generatedSize,
      image_bytes: image.size,
    });
    console.info('PublisherTiming', JSON.stringify(publicTimings));
    return { ...hydrated, generation_timings: publicTimings };
  } catch (error) {
    persistedPostId ||= await committedPostForRun(runId).catch(() => null);
    if (!persistedPostId) {
      if (image?.url) await safeDelete(image.url);
      await failGeneration(runId, error instanceof Error ? error.message : error);
    } else {
      // A response/hydration failure must not delete an already referenced image
      // or turn a committed ready post into an error. Recovery is read-only.
      error.persistedPostId = persistedPostId;
    }
    timings.total_ms = elapsed(totalStartedAt);
    console.info('PublisherTiming', JSON.stringify({
      ...roundedTimings(timings),
      outcome: 'error',
      error_type: error instanceof Error ? error.name : 'UnknownError',
    }));
    throw error;
  }
}

async function generateEditorialPackage(plan, direction, candidates, textModel) {
  const startedAt = performance.now();
  const editorial = await parseStructuredWithRetry({
    model: textModel,
    input: [
      {
        role: 'system',
        content: `${BRAND_BRIEF}\nComplète le mini-plan avec uniquement la légende, quatre hashtags contextuels, trois musiques parmi la liste et une localisation courte autorisée.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          direction: {
            univers: direction.universe,
            moment: direction.moment,
            style: direction.style,
          },
          mini_plan: plan,
          musiques_eligibles: candidates.map(({ title, artist }) => ({ title, artist })),
          contraintes: {
            langue_legende: 'anglais uniquement',
            longueur_legende: '1 ou 2 phrases courtes',
            hashtags_contextuels: 4,
            musiques: 3,
            localisation_autorisee: ['Aucun', 'French Riviera', 'Côte d’Azur'],
          },
        }),
      },
    ],
    reasoning: { effort: 'none' },
    max_output_tokens: 1200,
    store: false,
    text: {
      format: zodTextFormat(EditorialPackageSchema, 'publisher_editorial_package'),
      verbosity: 'low',
    },
  }, EditorialPackageSchema, 'editorial');
  return {
    package: editorial,
    duration: elapsed(startedAt),
  };
}

export async function regenerateText(runId, post) {
  let persistedPostId;
  try {
    const text = await parseStructuredWithRetry({
      model: allowedTextModel(publisherConfig().textModel) || 'gpt-5.6-luna',
      input: [
        { role: 'system', content: `${BRAND_BRIEF}\nRéécris uniquement la légende en anglais et les hashtags.` },
        { role: 'user', content: JSON.stringify(creativePost(post)) },
      ],
      reasoning: { effort: 'none' },
      max_output_tokens: 900,
      store: false,
      text: {
        format: zodTextFormat(RegeneratedTextSchema, 'publisher_text'),
        verbosity: 'low',
      },
    }, RegeneratedTextSchema, 'text_regeneration');
    const normalizedText = normalizeRegeneratedText(text);
    const saved = await finishTextRegeneration(runId, normalizedText);
    if (!saved) throw new Error('La publication ne peut plus être modifiée.');
    persistedPostId = String(saved.id);
    return await hydratePostWithMusic(saved);
  } catch (error) {
    persistedPostId ||= await committedPostForRun(runId).catch(() => null);
    if (!persistedPostId) await cancelRegeneration(runId, error instanceof Error ? error.message : error);
    else error.persistedPostId = persistedPostId;
    throw error;
  }
}

export async function regenerateImage(runId, post) {
  let image;
  let persistedPostId;
  try {
    const prompt = await parseStructuredWithRetry({
      model: allowedTextModel(publisherConfig().textModel) || 'gpt-5.6-luna',
      input: [
        { role: 'system', content: `${BRAND_BRIEF}\nCrée une nouvelle direction visuelle distincte, sans changer le thème.` },
        { role: 'user', content: JSON.stringify(creativePost(post)) },
      ],
      reasoning: { effort: 'none' },
      max_output_tokens: 1200,
      store: false,
      text: {
        format: zodTextFormat(RegeneratedImagePromptSchema, 'publisher_image_prompt'),
        verbosity: 'low',
      },
    }, RegeneratedImagePromptSchema, 'image_prompt_regeneration');
    image = await generateAndStoreImage(
      prompt.image_prompt,
      normalizeDateKey(post.post_date),
      runId,
      undefined,
      post.format,
    );
    const saved = await finishImageRegeneration(
      runId,
      prompt.image_prompt,
      prompt.visual_signature,
      image,
    );
    if (!saved) throw new Error('La publication ne peut plus être modifiée.');
    persistedPostId = String(saved.id);
    if (post.image_url) await safeDelete(post.image_url);
    return await hydratePostWithMusic(saved);
  } catch (error) {
    persistedPostId ||= await committedPostForRun(runId).catch(() => null);
    if (!persistedPostId) {
      if (image?.url) await safeDelete(image.url);
      await cancelRegeneration(runId, error instanceof Error ? error.message : error);
    } else { error.persistedPostId = persistedPostId; }
    throw error;
  }
}

async function generateAndStoreImage(
  prompt,
  dateKey,
  runId,
  direction,
  format = 'Feed 4:5',
  options = {},
) {
  const directionBrief = direction
    ? `Univers obligatoire: ${direction.universe}. Moment obligatoire: ${direction.moment}. Style obligatoire: ${direction.style}. ${direction.universeGuidance} ${direction.momentGuidance} ${direction.styleGuidance}`
    : '';
  const formatBrief = format === 'Reel'
    ? 'Composition verticale 9:16, sujet et détails essentiels dans la zone centrale, recadrage Reel sûr.'
    : 'Composition verticale 4:5, sujet et détails essentiels dans la zone centrale, recadrage Feed sûr.';
  const { size: generatedSize, quality } = resolveImageGenerationOptions(
    format,
    options,
    publisherConfig().imageQuality,
  );
  const imageStartedAt = performance.now();
  const result = await client().images.generate({
    model: publisherConfig().imageModel,
    prompt: `${BRAND_BRIEF}\n${directionBrief}\n${formatBrief}\nDirection visuelle: ${prompt}`,
    n: 1,
    size: generatedSize,
    quality,
    background: 'opaque',
    output_format: 'jpeg',
    output_compression: 90,
  });
  const imageGenerationMs = elapsed(imageStartedAt);
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("Le modèle d'image n'a retourné aucun visuel.");
  const conversionStartedAt = performance.now();
  const body = Buffer.from(encoded, 'base64');
  const base64ConversionMs = elapsed(conversionStartedAt);
  const uploadStartedAt = performance.now();
  const blob = await put(`publisher/${dateKey}/${runId}.jpg`, body, {
    access: PUBLISHER_BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: 'image/jpeg',
  });
  const blobUploadMs = elapsed(uploadStartedAt);
  if (!isPrivateBlobUrl(blob.url)) {
    await safeDelete(blob.url);
    throw new Error("Le store Blob n'est pas configuré en accès privé.");
  }
  const [width, height] = generatedSize.split('x').map(Number);
  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType || 'image/jpeg',
    size: body.byteLength,
    etag: blob.etag,
    width,
    height,
    quality,
    generatedSize,
    timings: {
      image_generation_ms: imageGenerationMs,
      base64_conversion_ms: base64ConversionMs,
      blob_upload_ms: blobUploadMs,
    },
  };
}

async function safeDelete(url) {
  try {
    // Also protects an ambiguous commit (DB response lost after COMMIT).
    // If the reference cannot be checked, retain the blob for reconciliation.
    if (await isPublisherImageReferenced(url)) return;
    await del(url);
  } catch (error) {
    console.warn('Publisher Blob cleanup failed:', error instanceof Error ? error.name : 'UnknownError');
  }
}

function creativePost(post) {
  return {
    date: normalizeDateKey(post.post_date),
    theme: post.theme,
    moment: post.moment,
    scene_summary: post.scene_summary,
    visual_signature: post.visual_signature,
    creative_universe: post.creative_universe,
    creative_moment: post.creative_moment,
    creative_style: post.creative_style,
    caption: post.caption,
    hashtags: post.hashtags,
    location: post.location,
    format: post.format,
  };
}

function compactRecentContent(posts) {
  return posts.map(post => ({
    date: post.post_date,
    universe: post.creative_universe,
    moment: post.creative_moment,
    style: post.creative_style,
    scene_summary: post.scene_summary,
    visual_signature: post.visual_signature,
  }));
}

function allowedTextModel(value) {
  return ['gpt-5.6-luna', 'gpt-5.6-terra'].includes(value) ? value : '';
}

function allowedImageQuality(value) {
  return ['medium', 'high'].includes(value) ? value : '';
}

function allowedImageSize(value) {
  return ['1024x1280', '1024x1536'].includes(value) ? value : '';
}

export function resolveImageGenerationOptions(format, options = {}, configuredQuality = 'medium') {
  return {
    size: allowedImageSize(options.size)
      || (format === 'Feed 4:5' ? '1024x1280' : '1024x1536'),
    quality: allowedImageQuality(options.quality)
      || allowedImageQuality(configuredQuality)
      || 'medium',
  };
}

async function parseStructuredWithRetry(request, schema, stage) {
  let lastError;
  const fallbackModel = request.model === 'gpt-5.6-luna'
    ? 'gpt-5.6-terra'
    : 'gpt-5.6-luna';
  const models = [request.model, request.model, fallbackModel];
  for (let attempt = 1; attempt <= models.length; attempt += 1) {
    try {
      const model = models[attempt - 1];
      const response = await client().responses.parse({ ...request, model });
      return parseStructuredOutput(response, schema);
    } catch (error) {
      lastError = error;
      console.warn('PublisherStructuredRetry', JSON.stringify({
        stage,
        attempt,
        model: models[attempt - 1],
        error_type: error instanceof Error ? error.name : 'UnknownError',
      }));
    }
  }
  throw lastError;
}

export function parseStructuredOutput(response, schema) {
  if (response?.output_parsed) return schema.parse(response.output_parsed);
  if (response?.output_text) return schema.parse(JSON.parse(response.output_text));
  throw new Error('La réponse structurée du modèle est vide.');
}

function elapsed(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function roundedTimings(timings) {
  return Object.fromEntries(Object.entries(timings).map(([key, value]) => [
    key,
    typeof value === 'number' ? Math.round(value) : value,
  ]));
}
