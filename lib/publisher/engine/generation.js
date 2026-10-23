import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { client, del, put } from './provider.js';
import { zodTextFormat } from 'openai/helpers/zod';
import { PUBLISHER_BLOB_ACCESS, CREATIVE_MOMENTS, CREATIVE_STYLES } from './constants.js';
import { carContextForPrompt, carImagePrompt, resolveCarReference, validateCarContext } from './cars.js';
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
import { musicContextForFormat } from './music.js';
import {
  cancelRegeneration,
  committedPostForRun,
  failGeneration,
  finishImageRegeneration,
  finishTextRegeneration,
  generationContext,
  hydratePostWithMusic,
  isCarPost,
  persistOperationCarContext,
  recentCarReferences,
  isPublisherImageReferenced,
  saveGeneratedPost,
  updateGenerationProgress,
} from './db.js';

const BRAND_BRIEF = (isCar = false) => `
One Address Riviera est une conciergerie privée haut de gamme sur la Côte d'Azur.
Ton éditorial: sophistiqué, discret, lumineux et concret; jamais tapageur.
Chaque publication doit évoquer un moment réellement désirable de la Riviera.
${isCar
  ? 'Les marquages physiques constructeur d’origine sur la voiture doivent rester fidèles à la référence automobile verrouillée, y compris les emblèmes, monogrammes et lettrages avant et arrière aux emplacements prévus lorsque ces zones sont visibles. Ces marquages se distinguent des éléments ajoutés par-dessus l’image : aucun texte publicitaire, logo superposé, filigrane ou signature. Aucune plaque lisible ni visage reconnaissable.'
  : 'Le visuel ne doit contenir aucun texte, logo, filigrane, marque visible ou visage reconnaissable.'}
Style photographique éditorial premium, lumière naturelle, réalisme subtil, composition verticale ${isCar ? 'adaptée au format demandé' : '4:5'}.
La légende Instagram est impérativement en anglais, jamais en français : exactement deux phrases courtes, 36 mots maximum au total, sans emoji.
La première phrase est une accroche évocatrice adaptée au visuel, qui donne envie de vivre l’expérience. La seconde et dernière phrase invite explicitement à réserver avec One Address Riviera, en utilisant « Book » ou « Reserve » et en mentionnant « with One Address Riviera ».
Le ton reste élégant, chaleureux et vendeur. Un appel clair à la réservation est obligatoire et ne constitue pas un ton commercial agressif. Cette invitation appartient à la légende avant les hashtags, jamais au visuel.
Adapter l’invitation au sujet : séjour, villa ou immobilier => next stay on the French Riviera ; paysage ou expérience Riviera => next escape to the French Riviera ; voyage => next trip to the French Riviera ; voiture => next ride on the French Riviera ; yacht ou bateau => next yacht experience on the French Riviera. Varier naturellement les formulations tout en conservant cette adaptation.
Ne jamais inventer un prix, une disponibilité à une date donnée, la propriété d’un véhicule ni un partenariat constructeur. Pour une villa ou une adresse fictive, inviter à un séjour sur la Riviera, sans présenter le bâtiment généré comme un bien réellement disponible.
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
    if (direction.universeKey === 'cars') {
      direction.carContext = await persistOperationCarContext(
        resolveCarReference(direction, context.recentContent, runId),
      );
    }
    timings.context_ms = elapsed(contextStartedAt);
    const planningStartedAt = performance.now();
    const proposedPlan = await parseStructuredWithRetry({
      model: textModel,
      input: [
        {
          role: 'system',
          content: `${BRAND_BRIEF(Boolean(direction.carContext))}\nProduis uniquement le mini-plan visuel demandé. Sois concret et compact.`,
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
            ...(direction.carContext ? {
              reference_automobile_immuable: carContextForPrompt(direction.carContext),
              regles_automobiles: carImagePrompt(direction.carContext),
            } : {}),
            theme_impose: direction.theme,
            instruction_de_variation: 'Créer un concept entièrement nouveau. Le sujet principal, la lumière et le rythme doivent refléter exactement les trois choix et se distinguer clairement des créations récentes.',
            contenus_des_14_derniers_jours_a_ne_pas_reprendre: compactRecentContent(context.recentContent),
            contraintes: {
              visuel: direction.carContext
                ? 'photoréaliste premium, marquages physiques constructeur d’origine fidèles à la référence verrouillée, sans texte ni logo superposé'
                : 'photoréaliste premium, sans texte intégré',
              format: 'Choisir Feed 4:5 ou Reel selon le concept',
              ...(direction.carContext ? {
                descriptions_scene: 'scene_summary et visual_signature forment une seule paire cohérente de décor et cadrage, en anglais avec les seuls mots du vocabulaire_scene_autorise. Une voiture stationnée sera ajoutée par le serveur : ne décrire aucun constructeur, modèle, variante, carrosserie ni anatomie. Ne pas imposer de moment ou de lumière contraire au choix Moment. Varier le décor et le cadrage par rapport aux créations récentes sans changer la référence automobile.',
                vocabulaire_scene_autorise: CAR_SCENERY_VOCABULARY,
                image_prompt: 'Le serveur impose seul l’identité du véhicule et la scène photographique. Toute identité ou anatomie automobile libre dans image_prompt sera ignorée.',
              } : {}),
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
    // A valid structured response can still contradict the chosen vehicle.
    // Keep variable, vehicle-free scenery, but replace any competing identity
    // before forwarding the mini-plan to editorial or saving its descriptors.
    const plan = direction.carContext
      ? canonicalCarPlan(proposedPlan, direction, runId)
      : proposedPlan;
    const carScenery = direction.carContext
      ? { scene_summary: plan.scene_summary, visual_signature: plan.visual_signature }
      : undefined;
    timings.planning_ms = elapsed(planningStartedAt);
    if (hasRecentContentDuplicate(plan, context.recentContent)) {
      throw new Error('La proposition répète un contenu des 14 derniers jours.');
    }

    const candidates = eligibleMusic(
      context.music,
      context.recentMusicIds,
      new Date(),
      musicContextForFormat(plan.format),
    );

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
      carScenery,
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
    }, {
      creative_universe: direction.universe,
      theme: direction.theme,
      car_context: direction.carContext,
    });
    generated.creative_universe = direction.universe;
    generated.creative_moment = direction.moment;
    generated.creative_style = direction.style;
    if (direction.carContext) {
      generated.car_context = direction.carContext;
      generated.image_prompt = image.prompt;
    }
    if (hasRecentContentDuplicate(generated, context.recentContent)) {
      throw new Error('La proposition répète un contenu des 14 derniers jours.');
    }
    const selectedMusic = chooseMusic(candidates, editorial.music);
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
        content: `${BRAND_BRIEF(Boolean(direction.carContext))}\nComplète le mini-plan avec uniquement la légende, quatre hashtags contextuels, jusqu'à trois musiques parmi la liste confirmée et une localisation courte autorisée. Reprends exactement le titre, l'artiste et la version des références fournies; conserve null lorsqu'aucune version n'est indiquée. Ne complète jamais la liste avec une autre référence. Si la liste est vide, renvoie music: [].`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          direction: {
            univers: direction.universe,
            moment: direction.moment,
            style: direction.style,
          },
          ...(direction.carContext ? { reference_automobile_immuable: carContextForPrompt(direction.carContext) } : {}),
          mini_plan: plan,
          musiques_eligibles: candidates.map(({ title, artist, version }) => ({ title, artist, version: version || null })),
          contraintes: {
            langue_legende: 'anglais uniquement',
            longueur_legende: 'Exactement deux phrases courtes, 36 mots maximum au total, sans emoji : une accroche évocatrice puis une invitation explicite Book ou Reserve avec One Address Riviera, adaptée au sujet. La légende précède les hashtags.',
            hashtags_contextuels: 4,
            musiques: Math.min(candidates.length, 3),
            localisation_autorisee: ['Aucun', 'French Riviera', 'Côte d’Azur'],
            ...(direction.carContext ? { automobile: CAR_EDITORIAL_BRIEF } : {}),
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
    if (isCarPost(post) && post.car_context) {
      await persistOperationCarContext(validateCarContext(post.car_context));
    }
    const text = await parseStructuredWithRetry({
      model: allowedTextModel(publisherConfig().textModel) || 'gpt-5.6-luna',
      input: [
        { role: 'system', content: `${BRAND_BRIEF(isCarPost(post))}\nRéécris uniquement la légende en anglais et les hashtags.${isCarPost(post) ? `\n${CAR_EDITORIAL_BRIEF}` : ''}` },
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
    const normalizedText = normalizeRegeneratedText(text, post);
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
    const direction = isCarPost(post) ? carDirectionForPost(post) : undefined;
    if (direction) {
      direction.carContext = await persistOperationCarContext(
        validateCarContext(post.car_context)
          || resolveCarReference('auto', await recentCarReferences(), runId),
      );
    }
    const previousCreative = creativePost(post, direction?.carContext);
    if (direction) {
      // Request a new autonomous description instead of imposing either the
      // previous scenery or a fallback that the response may legitimately vary.
      delete previousCreative.scene_summary;
      delete previousCreative.visual_signature;
    }
    const prompt = await parseStructuredWithRetry({
      model: allowedTextModel(publisherConfig().textModel) || 'gpt-5.6-luna',
      input: [
        { role: 'system', content: `${BRAND_BRIEF(Boolean(direction))}\nCrée une nouvelle direction visuelle distincte, sans changer le thème.` },
        { role: 'user', content: JSON.stringify({
          ...previousCreative,
          ...(direction ? {
            reference_automobile_immuable: carContextForPrompt(direction.carContext),
            regles_automobiles: carImagePrompt(direction.carContext),
            consigne_signature: 'visual_signature est une description autonome et complète du nouveau décor et cadrage, en anglais avec les seuls mots du vocabulaire_scene_autorise. Elle servira de scène et de signature à la même image. Une voiture stationnée sera ajoutée par le serveur : aucune identité ni anatomie automobile. Ne pas imposer de moment ou lumière contraire au Moment enregistré. image_prompt ne sera pas utilisé pour ce décor ni pour le véhicule.',
            vocabulaire_scene_autorise: CAR_SCENERY_VOCABULARY,
          } : {}),
        }) },
      ],
      reasoning: { effort: 'none' },
      max_output_tokens: 1200,
      store: false,
      text: {
        format: zodTextFormat(RegeneratedImagePromptSchema, 'publisher_image_prompt'),
        verbosity: 'low',
      },
    }, RegeneratedImagePromptSchema, 'image_prompt_regeneration');
    const carScenery = direction ? canonicalCarScenery({
      scene_summary: prompt.visual_signature,
      visual_signature: prompt.visual_signature,
    }, direction, runId) : undefined;
    image = await generateAndStoreImage(
      prompt.image_prompt,
      normalizeDateKey(post.post_date),
      runId,
      direction,
      post.format,
      {},
      carScenery,
    );
    const saved = await finishImageRegeneration(
      runId,
      direction ? image.prompt : prompt.image_prompt,
      carScenery?.visual_signature || prompt.visual_signature,
      image,
      direction?.carContext || null,
      carScenery,
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
  carScenery,
) {
  const finalPrompt = buildImagePrompt(prompt, direction, format, runId, carScenery);
  const { size: generatedSize, quality } = resolveImageGenerationOptions(
    format,
    options,
    publisherConfig().imageQuality,
  );
  const imageStartedAt = performance.now();
  const result = await client().images.generate({
    model: publisherConfig().imageModel,
    prompt: finalPrompt,
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
    prompt: finalPrompt,
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

function creativePost(post, carContext = post.car_context) {
  const reference = isCarPost(post) && carContext
    ? validateCarContext(carContext) : null;
  // A historical post may predate the scene-only mini-plan constraint. Its
  // stored prose remains untouched, but must not compete with a known vehicle
  // when preparing a new provider request. Captions/hashtags are regenerated
  // from the reference and creative direction rather than copied as authority.
  const scenery = reference ? acceptedCarScenery(post, carDirectionForPost(post)) : null;
  const descriptions = reference ? {
    ...(scenery || {}),
    car_context: reference,
  } : {
    scene_summary: post.scene_summary,
    visual_signature: post.visual_signature,
    caption: post.caption,
    hashtags: post.hashtags,
  };
  return {
    date: normalizeDateKey(post.post_date),
    theme: post.theme,
    moment: post.moment,
    ...descriptions,
    creative_universe: post.creative_universe,
    creative_moment: post.creative_moment,
    creative_style: post.creative_style,
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

const CAR_EDITORIAL_BRIEF = 'La seconde phrase de la légende invite à réserver une prochaine sortie en voiture sur la French Riviera avec One Address Riviera. Lorsqu’un car_context verrouillé est fourni par le serveur, reprendre exactement son constructeur et son modèle dans cette invitation commerciale : leur mention est explicitement autorisée et requise dans la légende, sans imposer de hashtag de marque. Ne déduire aucune identité automobile d’une ancienne légende, de hashtags, d’une description libre ni d’un image_prompt. Sans car_context fiable, utiliser une invitation générique comme « Book your next ride on the French Riviera with One Address Riviera. » ; une régénération de texte ne choisit jamais un nouveau véhicule. Ne prétendre ni représenter une photographie réelle de notre flotte, ni disponibilité à une date donnée, prix, partenariat constructeur ou adresse effectivement photographiée. La référence indique le modèle demandé, jamais une certification du véhicule généré.';

// Server fallbacks contain only scenery/composition. They remain neutral to the
// selected moment and pass the same closed vocabulary gate as accepted proposals.
const CAR_FALLBACK_SCENERY = Object.freeze([
  Object.freeze({
    scene_summary: 'A quiet coastal turnout overlooks the open sea beside dry tarmac.',
    visual_signature: 'The wide horizon meets pale stone and coarse foreground textures.',
  }),
  Object.freeze({
    scene_summary: 'A mineral courtyard rests between tall pines and a shaded stone wall.',
    visual_signature: 'The composition layers cream paving and irregular foliage shadows.',
  }),
  Object.freeze({
    scene_summary: 'A peaceful hillside lane meets a low stone bank beside native shrubs.',
    visual_signature: 'The diagonal view pairs rough masonry with distant layered hills.',
  }),
  Object.freeze({
    scene_summary: 'A plain esplanade faces a calm open bay beneath a wide sky.',
    visual_signature: 'The horizontal composition balances the sea horizon with smooth pale paving.',
  }),
]);

function fallbackCarScenery(runId) {
  const hash = createHash('sha256').update(String(runId)).digest();
  return CAR_FALLBACK_SCENERY[hash.readUInt32BE(0) % CAR_FALLBACK_SCENERY.length];
}

export function carSceneForRun(runId) {
  return fallbackCarScenery(runId).scene_summary;
}

function acceptedCarScenery(proposal, direction) {
  const scene = vehicleFreeScenery(proposal?.scene_summary, direction);
  const signature = vehicleFreeScenery(proposal?.visual_signature, direction);
  // Both descriptors govern the same image. Refusing either refuses the pair;
  // mixing a proposed courtyard with a fallback coast would contradict it.
  return scene && signature && scene.length >= 12 && scene.length <= 320
    && signature.length >= 8 && signature.length <= 180
    ? Object.freeze({ scene_summary: scene, visual_signature: signature }) : null;
}

function canonicalCarScenery(proposal, direction, runId) {
  return acceptedCarScenery(proposal, direction) || fallbackCarScenery(runId);
}

function canonicalCarPlan(plan, direction, runId) {
  const reference = validateCarContext(direction.carContext);
  const scenery = canonicalCarScenery(plan, direction, runId);
  return {
    ...scenery,
    image_prompt: `${reference.manufacturer} ${reference.model}. Exact variant: ${reference.variant}. Generation: ${reference.generation}. ${scenery.scene_summary} ${scenery.visual_signature}`,
    format: plan.format,
  };
}

// A closed vocabulary allows variable scenery/composition without accepting
// an unbounded stream of vehicle names, variants or anatomical instructions.
// Every free token must belong to these reviewed environment words. Unknown
// vocabulary replaces the whole field; it never changes the catalogue identity.
const CAR_SCENERY_VOCABULARY = Object.freeze(`
a above across afternoon against almond along amber an anchorage and angular
approach arcades arched arches aromatic arrival azure background balanced balances
balustrade band bands bank basin baskets bay beige beneath beside between beyond
bleached blossoms blue bluff blurred bordered borders bougainvillea branches brick
broad by calm canopy catches chalk chalky circular citrus clay clearing cliffs
climbing clipped close clouds coarse coastal cobbles colonnades composition conifers
cool copper coral courtyard cove cover cream crest cross crosses curves cut cypress
damp dappled dark deep delicate diagonal diagonally discreet distance distant draws
driftwood dry dune earth edge edged edges edging elevated empty entrance esplanade
estuary evening eye facade faces fallen fig flagstones flight foliage forecourt
foreground fountain fragments fragrant frame framed from garden gentle geometric
glowing gnarled golden grains grasses grassy gravel green greens grey ground grove
hangs harbour haze hazy headlands hedges high highlights hills hillside hilltop
holds horizon horizontal illuminates in inland inlet into irregular is ivory
jasmine joins landing lane late lavender layered layers leads leafy leaves lentisk
lies light limestone lined long low magenta masonry meet meets mineral mist morning
mosaic mottled muted narrow native natural ochre of offers offshore old olive onto
open opens orchard overcast overlook overlooks pairs pale passage past path patio
paved paving peaceful peach pearl pebbles pergola petals pines places plain planters
planting plaster plaza pool private punctuate quiet recede recess reed reeds
reflecting reflections restrained rests retaining reveals rhythm ridgelines rill
rippled ripples rocky rose rosemary rough sage sandstone sandy scrub sculpted sea
seaside secluded settles shaded shadowed shadows shallow shaped sheltered shrubs
side sidelight silt silver silvery sits sky skyline slate slender small smooth soft
softens softly soil sparse square steps still stone stripe stucco succulents sun
surf surfaces symmetrical tall tarmac terrace terraced terraces terracotta textured
textures the thin thyme tiled tiles tonal tones towards traces trees trunks tufts
turnout turquoise uncluttered under undulating uninterrupted valleys view village
vineyard wall warm washes water wave weathered while wide wild wind with worn woven
`.trim().split(/\s+/));
const CAR_SCENERY_WORDS = new Set(CAR_SCENERY_VOCABULARY);

function vehicleFreeScenery(value, direction) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/^[a-z\s.,;:'’()/-]+$/.test(normalized)) return '';
  const tokens = normalized.match(/[a-z]+/g) || [];
  if (!tokens.length || !tokens.every(token => CAR_SCENERY_WORDS.has(token))) return '';
  const momentKey = direction?.momentKey || Object.entries(CREATIVE_MOMENTS)
    .find(([, moment]) => moment.label === direction?.moment)?.[0];
  const explicitMoments = { morning: 'morning', afternoon: 'day', evening: 'evening' };
  if (Object.entries(explicitMoments).some(([word, key]) => tokens.includes(word) && momentKey !== key)) return '';
  if (tokens.includes('sun') && !['morning', 'day', 'evening'].includes(momentKey)) return '';
  if (momentKey === 'day' && /\blow[-\s]+afternoon[-\s]+light\b/.test(normalized)) return '';
  return value;
}

export function buildImagePrompt(prompt, direction, format = 'Feed 4:5', runId = '', carScenery) {
  const directionBrief = direction
    ? `Univers obligatoire: ${direction.universe}. Moment obligatoire: ${direction.moment}. Style obligatoire: ${direction.style}. ${direction.universeGuidance || ''} ${direction.momentGuidance || ''} ${direction.styleGuidance || ''}`
    : '';
  const formatBrief = format === 'Reel'
    ? 'Composition verticale 9:16, sujet et détails essentiels dans la zone centrale, recadrage Reel sûr.'
    : 'Composition verticale 4:5, sujet et détails essentiels dans la zone centrale, recadrage Feed sûr.';
  if (direction?.carContext) {
    const carBrandBrief = BRAND_BRIEF(true);
    const scenery = canonicalCarScenery(carScenery, direction, runId);
    return `${carBrandBrief}\n${directionBrief}\n${formatBrief}\n${carImagePrompt(direction.carContext)}\nScène photographique canonique: ${scenery.scene_summary}\nCadrage canonique: ${scenery.visual_signature}\nUne seule voiture stationnée. Adapter la lumière au moment et le cadrage au style demandés sans changer le véhicule, sa carrosserie ou le décor canonique. Ne pas ajouter de véhicule secondaire.`;
  }
  return `${BRAND_BRIEF()}\n${directionBrief}\n${formatBrief}\nDirection visuelle: ${prompt}`;
}

function carDirectionForPost(post) {
  const moment = Object.values(CREATIVE_MOMENTS).find(item => item.label === post.creative_moment || item.label === post.moment);
  const style = Object.values(CREATIVE_STYLES).find(item => item.label === post.creative_style);
  return {
    universeKey: 'cars', universe: 'Voitures',
    moment: post.creative_moment || post.moment || 'Moment enregistré',
    momentGuidance: moment?.guidance || '',
    style: post.creative_style || 'Éditorial',
    styleGuidance: style?.guidance || '',
  };
}
