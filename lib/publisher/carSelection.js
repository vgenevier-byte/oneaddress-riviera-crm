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

// Brand identifiers are selection metadata, not a change to released references.
const CAR_BRANDS = Object.freeze([
  Object.freeze({ id: 'land-rover', label: 'Land Rover' }),
  Object.freeze({ id: 'porsche', label: 'Porsche' }),
  Object.freeze({ id: 'bentley', label: 'Bentley' }),
  Object.freeze({ id: 'lamborghini', label: 'Lamborghini' }),
  Object.freeze({ id: 'mercedes-benz', label: 'Mercedes-Benz' }),
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

function normalizeBrand(value) {
  if (value === undefined) return 'auto';
  if (value === 'auto' || CAR_BRANDS.some(brand => brand.id === value)) return value;
  throw invalidCarValue('Marque automobile invalide.');
}

function normalizeModel(value) {
  if (value === undefined) return 'auto';
  if (value === 'auto' || CAR_CATALOGUE.some(reference => reference.id === value)) return value;
  throw invalidCarValue('Modèle automobile invalide.');
}

function compatibleWithType(reference, type) {
  return type === 'auto' || reference.types.includes(type);
}

export function availableCarBrands(type = 'auto') {
  const carType = normalizeCarType(type);
  return CAR_BRANDS.filter(brand => CAR_CATALOGUE.some(reference => (
    reference.manufacturer === brand.label && compatibleWithType(reference, carType)
  )));
}

export function availableCarModels(type = 'auto', brand = 'auto') {
  const carType = normalizeCarType(type);
  const carBrand = normalizeBrand(brand);
  if (carBrand === 'auto') return [];
  const manufacturer = CAR_BRANDS.find(candidate => candidate.id === carBrand).label;
  return CAR_CATALOGUE.filter(reference => (
    reference.manufacturer === manufacturer && compatibleWithType(reference, carType)
  ));
}

function selectionValues(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCarValue('Sélection automobile invalide.');
  }
  return {
    carType: normalizeCarType(value.carType),
    carBrand: normalizeBrand(value.carBrand),
    carModel: normalizeModel(value.carModel),
  };
}

export function normalizeCarSelection(value = {}) {
  const selection = selectionValues(value);
  const { carType, carBrand, carModel } = selection;
  if (carBrand !== 'auto' && !availableCarBrands(carType).some(brand => brand.id === carBrand)) {
    throw invalidCarValue('La marque choisie ne propose aucun modèle compatible avec ce type de voiture.');
  }
  if (carModel !== 'auto' && carBrand === 'auto') {
    throw invalidCarValue('Choisissez une marque avant de choisir un modèle automobile.');
  }
  if (carModel !== 'auto' && !availableCarModels(carType, carBrand).some(reference => reference.id === carModel)) {
    throw invalidCarValue('Le modèle choisi est incompatible avec le type de voiture ou la marque.');
  }
  return selection;
}

// UI-only reconciliation: validate identifiers, then clear only incompatible choices.
// Server admission always uses normalizeCarSelection and never silently repairs input.
export function reconcileCarSelection(previous = {}, next = {}) {
  const prior = normalizeCarSelection(previous);
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw invalidCarValue('Sélection automobile invalide.');
  }
  const selection = selectionValues({ ...prior, ...next });
  const reset = { brand: false, model: false };
  if (selection.carBrand !== 'auto' && !availableCarBrands(selection.carType).some(brand => brand.id === selection.carBrand)) {
    selection.carBrand = 'auto';
    reset.brand = true;
  }
  if (selection.carModel !== 'auto' && !availableCarModels(selection.carType, selection.carBrand).some(reference => reference.id === selection.carModel)) {
    selection.carModel = 'auto';
    reset.model = true;
  }
  return { selection, reset };
}
