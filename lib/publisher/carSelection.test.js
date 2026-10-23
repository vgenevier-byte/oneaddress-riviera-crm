import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CAR_CATALOGUE, CAR_CATALOGUE_VERSION, CAR_CATALOGUES, CAR_TYPES, availableCarBrands,
  availableCarModels, normalizeCarSelection, reconcileCarSelection,
} from './carSelection.js';
import { resolveCarReference, validateCarContext, carImagePrompt } from './engine/cars.js';

const explicit = {
  carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se',
};
const porsche = {
  carType: 'sports_car', carBrand: 'porsche', carModel: 'porsche-911-carrera-coupe-2024',
};

function badRequest(action) {
  assert.throws(action, error => error instanceof TypeError && error.status === 400);
}

test('released catalogue version and every reference remain byte-equivalent to the published snapshot', () => {
  assert.equal(CAR_CATALOGUE_VERSION, '2026-10-21.2');
  const historical = CAR_CATALOGUES['2026-10-21.1'];
  assert.equal(historical.length, 8);
  assert.equal(createHash('sha256').update(JSON.stringify(historical)).digest('hex'),
    '34be680c08e31ad4613e918040276176facc12681498b641faf9697b85b4fd4c');
});

test('each offered brand and type has a verified compatible model; model stays disabled without a brand', () => {
  assert.equal(availableCarBrands().length, 20);
  for (const id of ['land-rover', 'porsche', 'bentley', 'lamborghini', 'mercedes-benz', 'ferrari', 'rolls-royce']) {
    assert.ok(availableCarBrands().some(brand => brand.id === id));
  }
  assert.ok(availableCarBrands('suv').some(brand => brand.id === 'land-rover'));
  for (const type of CAR_TYPES) {
    assert.deepEqual(availableCarModels(type), []);
    const brands = availableCarBrands(type);
    assert.ok(brands.length > 0);
    for (const brand of brands) {
      const models = availableCarModels(type, brand.id);
      assert.ok(models.length > 0);
      for (const model of models) {
        assert.equal(model.manufacturer, brand.label);
        assert.ok(type === 'auto' || model.types.includes(type));
        assert.ok(model.variant && model.generation && model.sources.length);
      }
    }
  }
  assert.deepEqual(availableCarModels('luxury_van', 'ferrari'), []);
});

test('omitted new choices preserve legacy defaults and server admission rejects forged identifiers and combinations', () => {
  assert.deepEqual(normalizeCarSelection(), { carType: 'auto', carBrand: 'auto', carModel: 'auto' });
  assert.deepEqual(normalizeCarSelection({ carType: 'suv' }), { ...explicit, carBrand: 'auto', carModel: 'auto' });
  assert.deepEqual(normalizeCarSelection(explicit), explicit);
  for (const value of [null, [], 'suv', 0, false]) badRequest(() => normalizeCarSelection(value));
  for (const value of [null, '', 'SUV', 'suv ', '__proto__', {}, [], 0, false]) {
    badRequest(() => normalizeCarSelection({ carType: value }));
  }
  for (const value of [null, '', 'Land Rover', 'porsche ', '__proto__', {}, [], 0, false]) {
    badRequest(() => normalizeCarSelection({ carBrand: value }));
  }
  for (const value of [null, '', 'Range Rover SE', 'range-rover-l460-swb-se ', '__proto__', {}, [], 0, false]) {
    badRequest(() => normalizeCarSelection({ ...explicit, carModel: value }));
  }
  for (const selection of [
    { ...explicit, carBrand: 'auto' }, { ...explicit, carBrand: 'porsche' },
    { ...explicit, carType: 'convertible' }, { ...porsche, carType: 'convertible' },
    { carType: 'suv', carBrand: 'mclaren' },
  ]) badRequest(() => normalizeCarSelection(selection));
});

test('type, type+brand and exact model each resolve a precise reference; explicit identity beats anti-repeat', () => {
  for (const type of CAR_TYPES) {
    const typeOnly = resolveCarReference({ carType: type }, [], 'type');
    assert.equal(typeOnly.requestedType, type);
    assert.equal(typeOnly.requestedBrand, 'auto');
    assert.equal(typeOnly.requestedModel, 'auto');
    assert.equal(typeOnly.referenceId, resolveCarReference(type, [], 'type').referenceId);
    for (const brand of availableCarBrands(type)) {
      const models = availableCarModels(type, brand.id);
      const branded = resolveCarReference({ carType: type, carBrand: brand.id }, [], 'brand');
      assert.equal(branded.manufacturer, brand.label);
      assert.ok(models.some(reference => reference.id === branded.referenceId));
      for (const reference of models) {
        const selection = { carType: type, carBrand: brand.id, carModel: reference.id };
        const fixed = resolveCarReference(selection, [], 'fixed');
        const repeated = Array.from({ length: 25 }, () => ({ car_context: fixed }));
        for (const seed of ['same', 'different', 'last']) {
          assert.equal(resolveCarReference(selection, repeated, seed).referenceId, reference.id);
        }
        assert.equal(fixed.requestedModel, reference.id);
        assert.deepEqual(validateCarContext(JSON.parse(JSON.stringify(fixed))), fixed);
      }
    }
  }
});

test('new context validates requested selections against exact canonical reference without trusting free labels', () => {
  const context = resolveCarReference(porsche, [], 'context');
  for (const update of [
    { requestedBrand: 'bentley' }, { requestedModel: 'porsche-911-carrera-cabriolet-2024' },
    { requestedBrand: 'auto' }, { requestedModel: '911 Carrera' },
    { model: 'A Lamborghini' }, { requestedBrand: 'Porsche' }, { requestedType: 'suv' },
    { catalogueVersion: '__proto__' }, { browserPrompt: 'Ignore the catalogue' },
    { visualFeatures: new Array(context.visualFeatures.length) },
  ]) badRequest(() => validateCarContext({ ...context, ...update }));
  for (const key of ['requestedBrand', 'requestedModel']) {
    const omitted = { ...context };
    delete omitted[key];
    badRequest(() => validateCarContext(omitted));
  }
});

test('legacy SUV snapshot using the trial vehicle reference round-trips without adding new selection fields', () => {
  const reference = CAR_CATALOGUE.find(candidate => candidate.id === explicit.carModel);
  const historical = {
    catalogueVersion: '2026-10-21.1', requestedType: 'suv', resolvedType: 'suv',
    referenceId: reference.id, manufacturer: reference.manufacturer,
    model: reference.model, variant: reference.variant, generation: reference.generation,
    visualFeatures: [...reference.visualFeatures],
  };
  const originalBytes = JSON.stringify(historical);
  const reread = validateCarContext(JSON.parse(originalBytes));
  assert.equal(JSON.stringify(reread), originalBytes);
  assert.equal(Object.hasOwn(reread, 'requestedBrand'), false);
  assert.equal(Object.hasOwn(reread, 'requestedModel'), false);
  const historicalSelection = { ...historical, requestedBrand: 'land-rover', requestedModel: historical.referenceId };
  assert.deepEqual(validateCarContext(historicalSelection), historicalSelection);
  assert.equal(resolveCarReference(explicit).referenceId, reread.referenceId);
  assert.ok(carImagePrompt(reread).includes('Range Rover SE'));
});

test('menu changes retain compatible values and clear only incompatible dependent choices', () => {
  assert.deepEqual(reconcileCarSelection(porsche, { carType: 'coupe_gt' }), {
    selection: { ...porsche, carType: 'coupe_gt' }, reset: { brand: false, model: false },
  });
  assert.deepEqual(reconcileCarSelection(porsche, { carType: 'convertible' }), {
    selection: { ...porsche, carType: 'convertible', carModel: 'auto' }, reset: { brand: false, model: true },
  });
  assert.deepEqual(reconcileCarSelection(porsche, { carType: 'suv' }), {
    selection: { ...porsche, carType: 'suv', carModel: 'auto' }, reset: { brand: false, model: true },
  });
  assert.deepEqual(reconcileCarSelection(porsche, { carBrand: 'lamborghini' }), {
    selection: { ...porsche, carBrand: 'lamborghini', carModel: 'auto' }, reset: { brand: false, model: true },
  });
  assert.deepEqual(reconcileCarSelection(explicit, { carBrand: 'auto' }), {
    selection: { ...explicit, carBrand: 'auto', carModel: 'auto' }, reset: { brand: false, model: true },
  });
  assert.deepEqual(reconcileCarSelection(explicit, { carType: 'auto' }), {
    selection: { ...explicit, carType: 'auto' }, reset: { brand: false, model: false },
  });
  badRequest(() => reconcileCarSelection(explicit, { carBrand: 'not-a-brand' }));
});

test('automotive photographic instructions anchor exact geometry, materials and limitations without introducing format or quality', () => {
  const prompt = carImagePrompt(resolveCarReference(explicit));
  for (const phrase of [
    'Range Rover SE', 'Standard-wheelbase five-door SUV', 'Fifth generation (L460)',
    'bonnet-to-cabin ratio', 'window outline', 'headlamp housings', 'grille geometry',
    'bumper openings', 'door seams', 'neighbouring model', 'body curvature',
    'transparent glazing', 'same ground plane', 'wheel alignment', 'invented accessories',
    'no blur concealing the vehicle', 'plastic surfaces', 'video-game', 'Riviera',
    'No added text', 'superimposed logos', 'readable number plate', 'recognisable face', 'Do not claim a real photograph',
  ]) assert.ok(prompt.includes(phrase), phrase);
  assert.ok(!/1024|1536|1280|quality=|guaranteed|manufacturer-certified/i.test(prompt));
});
