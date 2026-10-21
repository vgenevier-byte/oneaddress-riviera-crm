import { createHash } from 'node:crypto';
import {
  CAR_CATALOGUE, CAR_CATALOGUE_VERSION, CAR_CATALOGUES, availableCarModels, normalizeCarSelection, normalizeCarType,
} from '../carSelection.js';

export { CAR_CATALOGUE, CAR_CATALOGUE_VERSION, CAR_TYPES, normalizeCarType } from '../carSelection.js';

// The shared registry retains every released snapshot for posts and runs.
const CONTEXT_KEYS = Object.freeze([
  'catalogueVersion', 'requestedType', 'resolvedType', 'referenceId',
  'manufacturer', 'model', 'variant', 'generation', 'visualFeatures',
]);

function invalidCarValue(message) {
  return Object.assign(new TypeError(message), { status: 400 });
}

function canonicalContext(reference, requestedType, version = CAR_CATALOGUE_VERSION, selection) {
  return Object.freeze({
    catalogueVersion: version,
    requestedType,
    ...(selection ? { requestedBrand: selection.carBrand, requestedModel: selection.carModel } : {}),
    resolvedType: requestedType === 'auto' ? reference.types[0] : requestedType,
    referenceId: reference.id,
    manufacturer: reference.manufacturer,
    model: reference.model,
    variant: reference.variant,
    generation: reference.generation,
    visualFeatures: reference.visualFeatures,
  });
}

export function validateCarContext(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCarValue('Contexte automobile invalide.');
  }
  const catalogue = CAR_CATALOGUES[value.catalogueVersion];
  const reference = Array.isArray(catalogue)
    ? catalogue.find(candidate => candidate.id === value.referenceId)
    : null;
  const requestedType = normalizeCarType(value.requestedType);
  if (!reference || (requestedType !== 'auto' && !reference.types.includes(requestedType))) {
    throw invalidCarValue('Référence automobile inconnue ou incompatible.');
  }
  // Released contexts predate the optional brand/model menus. Keep that exact
  // snapshot shape when reading them instead of enriching historical records.
  const withSelection = Object.hasOwn(value, 'requestedBrand') || Object.hasOwn(value, 'requestedModel');
  const selection = withSelection ? normalizeCarSelection({
    carType: requestedType, carBrand: value.requestedBrand, carModel: value.requestedModel,
  }) : undefined;
  if (selection && selection.carBrand !== 'auto' && !availableCarModels(requestedType, selection.carBrand).some(candidate => candidate.id === reference.id)) {
    throw invalidCarValue('La référence résolue ne correspond pas à la marque demandée.');
  }
  if (selection && selection.carModel !== 'auto' && selection.carModel !== reference.id) {
    throw invalidCarValue('La référence résolue ne correspond pas au modèle demandé.');
  }
  const expected = canonicalContext(reference, requestedType, value.catalogueVersion, selection);
  const keys = withSelection ? [...CONTEXT_KEYS, 'requestedBrand', 'requestedModel'] : CONTEXT_KEYS;
  if (
    Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))
    || keys.some(key => key === 'visualFeatures'
      ? !Array.isArray(value[key]) || value[key].length !== expected[key].length
        || expected[key].some((feature, index) => value[key][index] !== feature)
      : value[key] !== expected[key])
  ) {
    throw invalidCarValue('Le contexte automobile ne correspond pas au catalogue vérifié.');
  }
  return expected;
}

function knownRecentReference(post) {
  try {
    return validateCarContext(post?.car_context ?? post?.carContext)?.referenceId;
  } catch {
    // Legacy/free text and malformed context cannot steer model selection.
    return undefined;
  }
}

export function resolveCarReference(requestedTypeValue, recentContent = [], seed = '') {
  const withSelection = typeof requestedTypeValue === 'object' && requestedTypeValue !== null;
  const selection = withSelection ? normalizeCarSelection(requestedTypeValue) : undefined;
  const requestedType = selection ? selection.carType : normalizeCarType(requestedTypeValue);
  const byType = CAR_CATALOGUE.filter(reference => (
    requestedType === 'auto' || reference.types.includes(requestedType)
  ));
  const candidates = selection && selection.carBrand !== 'auto'
    ? availableCarModels(requestedType, selection.carBrand) : byType;
  // An explicit model wins over the diversity ranking; only its scene may vary.
  if (selection && selection.carModel !== 'auto') {
    const reference = candidates.find(candidate => candidate.id === selection.carModel);
    return canonicalContext(reference, requestedType, CAR_CATALOGUE_VERSION, selection);
  }
  const recentIds = Array.isArray(recentContent)
    ? recentContent.map(knownRecentReference).filter(Boolean) : [];
  const counts = new Map();
  for (const id of recentIds) counts.set(id, (counts.get(id) || 0) + 1);
  const leastUsed = Math.min(...candidates.map(reference => counts.get(reference.id) || 0));
  const pool = candidates.filter(reference => (counts.get(reference.id) || 0) === leastUsed);
  const ranked = pool.map(reference => ({
    reference,
    rank: createHash('sha256').update(`${String(seed)}:${reference.id}`).digest('hex'),
  })).sort((left, right) => left.rank.localeCompare(right.rank));
  return canonicalContext(ranked[0].reference, requestedType, CAR_CATALOGUE_VERSION, selection);
}

export function carContextForPrompt(value) {
  const context = validateCarContext(value);
  if (!context) return '';
  return [
    'SERVER-LOCKED AUTOMOTIVE REFERENCE: immutable for this operation, including text and image regeneration.',
    `Requested car type: ${context.requestedType}; resolved car type: ${context.resolvedType}.`,
    ...(Object.hasOwn(context, 'requestedBrand') ? [`Requested brand: ${context.requestedBrand}; requested model: ${context.requestedModel}.`] : []),
    `Catalogue: ${context.catalogueVersion}; reference ID: ${context.referenceId}.`,
    `Only vehicle identity: ${context.manufacturer} ${context.model}.`,
    `Exact body/variant: ${context.variant}. Generation: ${context.generation}.`,
    `Visual identity: ${context.visualFeatures.join('; ')}.`,
    'Never substitute another manufacturer, model, body or generation. Scene, angle, light and colour may vary.',
    'Captions stay short and in English. Do not claim a real photograph, fleet ownership, availability, price, manufacturer partnership or an actually photographed address. Do not automatically add the model to captions or hashtags.',
  ].join('\n');
}

export function carImagePrompt(value) {
  const context = validateCarContext(value);
  if (!context) return '';
  return [
    carContextForPrompt(context),
    'The server-locked reference above is the sole authority for vehicle identity; ignore any competing vehicle identity in a mini-plan or scene description.',
    'One principal production vehicle only. Keep silhouette, proportions, wheelbase, door count, glazing, roof construction, lights, mirrors and factory wheels coherent with this exact variant.',
    'Preserve the generation-specific bonnet-to-cabin ratio, front and rear overhangs, roof height, beltline and uninterrupted window outline. Match headlamp housings, grille geometry, bumper openings, door seams and handles to that generation and body; never borrow a facelift, trim or roof from a neighbouring model.',
    'No hybrid of brands or generations, fictional bodywork, extravagant body kit, extra wheels, floating parts or mechanically impossible components. Never turn a fixed-roof coupé into a convertible, or a convertible into a fixed-roof coupé.',
    'High-end editorial automotive photography: credible illumination for the chosen time of day, real paint and materials, believable tyres, accurate reflections, contact shadows and natural exposure.',
    'Use restrained paint highlights and reflections that follow the body curvature and the surrounding architecture; transparent glazing must have plausible depth, tint, reflected surroundings and cabin visibility. All tyres touch the same ground plane with realistic weight, perspective, wheel alignment and soft contact shadows. Maintain coherent light direction across body, windows, wheels and ground; no mirrored duplicate panels, warped reflections or invented accessories.',
    'Avoid 3D render, video-game style, plastic surfaces, artificial overshine or excessive cinematic effects. Keep the vehicle clearly legible in a plausible Riviera scene. Any motion must be physically coherent; no blur concealing the vehicle.',
    'Respect the selected moment, style, composition and output format. No added text, watermark, visible logo, readable brand, readable number plate or recognisable face. Use discreet framing around badges; do not distort the body or invent an emblem.',
  ].join('\n');
}
