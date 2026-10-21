import { createHash } from 'node:crypto';

export const CAR_TYPES = Object.freeze([
  'auto', 'suv', 'saloon', 'coupe_gt', 'sports_car', 'convertible', 'supercar', 'luxury_van',
]);
export const CAR_CATALOGUE_VERSION = '2026-10-21.1';

function freezeReference(reference) {
  return Object.freeze({
    ...reference,
    types: Object.freeze(reference.types),
    visualFeatures: Object.freeze(reference.visualFeatures),
    sources: Object.freeze(reference.sources),
    verifiedOn: '2026-10-21',
  });
}

// Editorial references, not a fleet, availability or manufacturer partnership.
// Preserve released snapshots verbatim in CAR_CATALOGUES when adding a version.
export const CAR_CATALOGUE = Object.freeze([
  {
    id: 'range-rover-l460-swb-se', manufacturer: 'Land Rover', model: 'Range Rover SE',
    variant: 'Standard-wheelbase five-door SUV, fixed roof',
    generation: 'Fifth generation (L460), introduced 2021',
    types: ['suv'],
    visualFeatures: ['Upright five-door SUV proportions and standard wheelbase', 'Clean continuous beltline, near-flush glazing and floating fixed roof', 'Slim horizontal headlamps and concealed vertical rear lamps'],
    sources: ['https://www.rangerover.com/fr-fr/range-rover/models-and-specifications.html', 'https://media.landrover.com/news/2021/10/new-range-rover-world-premiere-breathtaking-modernity-peerless-refinement-and-0'],
  },
  {
    id: 'porsche-911-carrera-coupe-2024', manufacturer: 'Porsche', model: '911 Carrera',
    variant: 'Two-door Coupé, fixed roof, rear-wheel drive',
    generation: '911 model update introduced May 2024',
    types: ['sports_car', 'coupe_gt'],
    visualFeatures: ['Low rear-engined silhouette with rounded fixed roof flowing into the rear', 'Round-looking oval headlamps with four-point light signature', 'Wide rear shoulders, horizontal front cooling intakes and continuous rear light strip; standard Carrera, without GTS vertical cooling flaps'],
    sources: ['https://www.porsche.com/france/models/911/carrera-models/911-carrera/', 'https://newsroom.porsche.com/en/2024/products/porsche-new-911-world-premiere-hybrid-36322.html'],
  },
  {
    id: 'porsche-911-carrera-cabriolet-2024', manufacturer: 'Porsche', model: '911 Carrera Cabriolet',
    variant: 'Two-door Cabriolet, retractable fabric roof, rear-wheel drive',
    generation: '911 model update introduced May 2024',
    types: ['convertible', 'sports_car'],
    visualFeatures: ['Low rear-engined convertible with correct fabric-roof mechanism and windshield frame', 'Round-looking oval headlamps with four-point light signature', 'Wide rear shoulders, horizontal front cooling intakes and continuous rear light strip; no Targa bar or GTS vertical cooling flaps'],
    sources: ['https://www.porsche.com/france/models/911/carrera-cabriolet-models/911-carrera-cabriolet/', 'https://newsroom.porsche.com/en/2024/products/porsche-new-911-world-premiere-hybrid-36322.html'],
  },
  {
    id: 'bentley-continental-gt-speed-gen4', manufacturer: 'Bentley', model: 'Continental GT Speed',
    variant: 'Two-door Grand Touring Coupé, fixed roof',
    generation: 'Fourth generation, introduced 2024',
    types: ['coupe_gt'],
    visualFeatures: ['Long bonnet, muscular rear haunches and flowing fixed coupé roof', 'One main headlamp on each side with horizontal eyebrow, not the older four-lamp front', 'Broad dark matrix grille and oval rear lamps'],
    sources: ['https://www.bentleymotors.com/de/de/models/continental-gt.html', 'https://www.bentleymedia.com/en/newsitem/1650-bentley-continental-gt-and-gtc-speed-to-make-italian-public-debut-at-milano-autoclassica-2024'],
  },
  {
    id: 'bentley-continental-gtc-speed-gen4', manufacturer: 'Bentley', model: 'Continental GTC Speed',
    variant: 'Two-door Grand Touring convertible, retractable fabric roof',
    generation: 'Fourth generation, introduced 2024',
    types: ['convertible'],
    visualFeatures: ['Long bonnet, muscular rear haunches and correct fabric-roof convertible structure', 'One main headlamp on each side with horizontal eyebrow, not the older four-lamp front', 'Broad dark matrix grille and oval rear lamps; never a fixed coupé roof'],
    sources: ['https://www.bentleymotors.com/de/de/models/continental-gtc.html', 'https://www.bentleymedia.com/en/newsitem/1650-bentley-continental-gt-and-gtc-speed-to-make-italian-public-debut-at-milano-autoclassica-2024'],
  },
  {
    id: 'bentley-flying-spur-speed-gen4', manufacturer: 'Bentley', model: 'Flying Spur Speed',
    variant: 'Four-door saloon, fixed roof',
    generation: 'Fourth generation, introduced September 2024',
    types: ['saloon'],
    visualFeatures: ['Long-wheelbase four-door saloon with separate boot and long bonnet', 'Broad Speed-specific matrix grille, four round front lamps and muscular rear haunches', 'Continuous fixed saloon roof and dark exterior brightware'],
    sources: ['https://www.bentleymedia.com/en/newsitem/1621-the-new-flying-spur-the-most-powerful-bentley-four-door-ever'],
  },
  {
    id: 'lamborghini-huracan-evo-coupe-2019', manufacturer: 'Lamborghini', model: 'Huracán EVO',
    variant: 'Two-door Coupé, fixed roof, four-wheel drive',
    generation: 'EVO introduced 2019',
    types: ['supercar', 'sports_car', 'coupe_gt'],
    visualFeatures: ['Low wedge-shaped mid-engined coupé with fixed roof and hexagonal side glazing', 'Y-shaped front air-intake design and sharp angular headlamp housings', 'High-mounted central twin exhaust outlets and integrated rear spoiler; no added racing wing, not EVO RWD or Spyder'],
    sources: ['https://www.lamborghini.com/history/huracan-evo', 'https://www.lamborghini.com/en-en/news/huracan-evo-spyder-and-coupe-road-trip-tuscany'],
  },
  {
    id: 'mercedes-v-class-avantgarde-2024', manufacturer: 'Mercedes-Benz', model: 'V-Class AVANTGARDE',
    variant: 'Long luxury passenger van, fixed roof, sliding rear side doors',
    generation: 'V447 facelift introduced for 2024',
    types: ['luxury_van'],
    visualFeatures: ['Long passenger-van silhouette with upright rear and continuous fixed roof', 'Large side glazing and sliding rear side doors on both sides', '2024 redesigned grille and bumper, slim sculpted front lamps and vertical rear lamps; no camper pop-top or EXCLUSIVE bonnet ornament'],
    sources: ['https://media.mercedes-benz.com/article/33e42655-6865-486a-ae87-2416a8fa6706', 'https://www.mercedes-benz.co.uk/passengercars/models/7-seater.html', 'https://static.oneweb.mercedes-benz.com/css-oom-assets/en-do/pdf/mercedes-v-class-van-2024-june-v447-mbux-owners-manual-1.pdf'],
  },
].map(freezeReference));

// Append a new frozen array/version; retain earlier arrays for stored posts/runs.
const CAR_CATALOGUES = Object.freeze({ [CAR_CATALOGUE_VERSION]: CAR_CATALOGUE });
const CONTEXT_KEYS = Object.freeze([
  'catalogueVersion', 'requestedType', 'resolvedType', 'referenceId',
  'manufacturer', 'model', 'variant', 'generation', 'visualFeatures',
]);

function invalidCarValue(message) {
  return Object.assign(new TypeError(message), { status: 400 });
}

export function normalizeCarType(value) {
  if (value === undefined) return 'auto';
  if (typeof value !== 'string' || !CAR_TYPES.includes(value)) {
    throw invalidCarValue('Type de voiture invalide.');
  }
  return value;
}

function canonicalContext(reference, requestedType, version = CAR_CATALOGUE_VERSION) {
  return Object.freeze({
    catalogueVersion: version,
    requestedType,
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
  const expected = canonicalContext(reference, requestedType, value.catalogueVersion);
  if (
    Object.keys(value).length !== CONTEXT_KEYS.length
    || CONTEXT_KEYS.some(key => !Object.hasOwn(value, key))
    || CONTEXT_KEYS.some(key => key === 'visualFeatures'
      ? !Array.isArray(value[key]) || value[key].length !== expected[key].length
        || value[key].some((feature, index) => feature !== expected[key][index])
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
  const requestedType = normalizeCarType(requestedTypeValue);
  const candidates = CAR_CATALOGUE.filter(reference => (
    requestedType === 'auto' || reference.types.includes(requestedType)
  ));
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
  return canonicalContext(ranked[0].reference, requestedType);
}

export function carContextForPrompt(value) {
  const context = validateCarContext(value);
  if (!context) return '';
  return [
    'SERVER-LOCKED AUTOMOTIVE REFERENCE: immutable for this operation, including text and image regeneration.',
    `Requested car type: ${context.requestedType}; resolved car type: ${context.resolvedType}.`,
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
    'No hybrid of brands or generations, fictional bodywork, extravagant body kit, extra wheels, floating parts or mechanically impossible components. Never turn a fixed-roof coupé into a convertible, or a convertible into a fixed-roof coupé.',
    'High-end editorial automotive photography: credible illumination for the chosen time of day, real paint and materials, believable tyres, accurate reflections, contact shadows and natural exposure.',
    'Avoid 3D render, video-game style, plastic surfaces, artificial overshine or excessive cinematic effects. Keep the vehicle clearly legible in a plausible Riviera scene. Any motion must be physically coherent; no blur concealing the vehicle.',
    'Respect the selected moment, style, composition and output format. No added text, watermark, visible logo, readable brand, readable number plate or recognisable face. Use discreet framing around badges; do not distort the body or invent an emblem.',
  ].join('\n');
}
