/** Catalogue contracts only: no Auth, database, network or paid provider. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CAR_CATALOGUE, CAR_CATALOGUE_VERSION, CAR_CATALOGUES, CAR_TYPES,
  availableCarBrands, availableCarModels, normalizeCarSelection,
} from '../../lib/publisher/carSelection.js';
import { resolveCarReference, validateCarContext } from '../../lib/publisher/engine/cars.js';

const brandDomains = {
  'land-rover': ['rangerover.com', 'landrover.com', 'jlr.com'],
  porsche: ['porsche.com'],
  bentley: ['bentleymotors.com', 'bentleymedia.com'],
  lamborghini: ['lamborghini.com'],
  'mercedes-benz': ['mercedes-benz.com', 'mercedes-benz.co.uk', 'mbusa.com'],
  ferrari: ['ferrari.com'],
  'rolls-royce': ['rolls-roycemotorcars.com'],
  'aston-martin': ['astonmartin.com'],
  mclaren: ['mclaren.com'],
  bmw: ['bmwgroup.com', 'bmw.com'],
  audi: ['audi.com', 'audi-mediacenter.com'],
  maserati: ['maserati.com'],
  alpine: ['alpinecars.com', 'renaultgroup.com'],
  lotus: ['lotuscars.com', 'lotuscars.com.cn'],
  bugatti: ['bugatti.com'],
  pagani: ['pagani.com'],
  koenigsegg: ['koenigsegg.com'],
  lexus: ['lexus.com', 'lexus.eu', 'global.toyota'],
  cadillac: ['cadillac.com'],
  jaguar: ['jlr.com', 'jaguar.com'],
};
const brands = availableCarBrands('auto');
const brandFor = reference => brands.find(brand => brand.label === reference.manufacturer);
const ids = references => references.map(reference => reference.id);
const clone = value => JSON.parse(JSON.stringify(value));
const badRequest = action => assert.throws(action, error => error instanceof TypeError && error.status === 400);
const exactSelection = (reference, type = 'auto') => ({
  carType: type, carBrand: brandFor(reference).id, carModel: reference.id,
});

test('the expansion offers exactly the twenty requested brands and at least sixty distinct references', () => {
  assert.deepEqual(brands.map(brand => brand.id).sort(), Object.keys(brandDomains).sort());
  assert.equal(new Set(brands.map(brand => brand.label)).size, 20);
  assert.ok(CAR_CATALOGUE.length >= 60);
  assert.equal(new Set(ids(CAR_CATALOGUE)).size, CAR_CATALOGUE.length);
  const identities = CAR_CATALOGUE.map(({ manufacturer, model, variant, generation }) => (
    JSON.stringify([manufacturer, model, variant, generation])
  ));
  assert.equal(new Set(identities).size, identities.length, 'No duplicate model/body/generation under another ID');
  for (const id of ['amg', 'mercedes-amg', 'maybach', 'mercedes-maybach']) {
    badRequest(() => normalizeCarSelection({ carBrand: id }));
  }
  for (const reference of CAR_CATALOGUE.filter(reference => /AMG|Maybach/.test(reference.model))) {
    assert.equal(brandFor(reference)?.id, 'mercedes-benz', reference.id);
  }
});

for (const [type, minimum] of Object.entries({ suv: 8, convertible: 6, coupe_gt: 6, saloon: 5, supercar: 5 })) {
  test(`${type} offers models from at least ${minimum} distinct brands`, () => {
    assert.ok(availableCarBrands(type).length >= minimum);
  });
}

test('every brand menu contains its complete catalogue projection for each type', async t => {
  for (const brand of brands) {
    await t.test(brand.id, () => {
      const own = CAR_CATALOGUE.filter(reference => reference.manufacturer === brand.label);
      assert.ok(own.length > 0, 'Every requested brand is selectable');
      for (const type of CAR_TYPES) {
        const expected = own.filter(reference => type === 'auto' || reference.types.includes(type));
        assert.deepEqual(ids(availableCarModels(type, brand.id)), ids(expected), `${brand.id}/${type}`);
        assert.equal(availableCarBrands(type).some(candidate => candidate.id === brand.id), expected.length > 0);
      }
    });
  }
  assert.deepEqual(ids(brands.flatMap(brand => availableCarModels('auto', brand.id))).sort(), ids(CAR_CATALOGUE).sort());
});

for (const [brand, required] of [
  ['ferrari', ['Purosangue', 'Roma Spider', '296 GTB', '12Cilindri']],
  ['bentley', ['Bentayga', 'Continental GT Speed', 'Continental GTC Speed', 'Flying Spur Speed']],
  ['rolls-royce', ['Cullinan', 'Ghost', 'Phantom', 'Spectre', 'Wraith', 'Dawn']],
]) {
  test(`${brand} retains every requested model family without a menu cap`, () => {
    const models = availableCarModels('auto', brand);
    for (const model of required) assert.ok(models.some(reference => reference.model === model), model);
    assert.ok(models.length >= required.length);
  });
}

test('every reference has a stable ID, complete identity, unique types and sources belonging to its manufacturer', () => {
  // cars.test.js already checks the shared official-domain allowlist and roof anatomy.
  // This additionally rejects a reference attributed to another manufacturer's official source.
  for (const reference of CAR_CATALOGUE) {
    const brand = brandFor(reference);
    assert.ok(brand, reference.id);
    assert.match(reference.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const field of ['manufacturer', 'model', 'variant', 'generation']) {
      assert.equal(typeof reference[field], 'string', `${reference.id}/${field}`);
      assert.ok(reference[field].trim(), `${reference.id}/${field}`);
    }
    assert.ok(reference.types.length > 0, reference.id);
    assert.equal(new Set(reference.types).size, reference.types.length, reference.id);
    assert.ok(reference.types.every(type => type !== 'auto' && CAR_TYPES.includes(type)), reference.id);
    assert.ok(reference.sources.length > 0, reference.id);
    assert.equal(new Set(reference.sources).size, reference.sources.length, reference.id);
    for (const source of reference.sources) {
      const { hostname } = new URL(source);
      assert.ok(brandDomains[brand.id].some(domain => hostname === domain || hostname.endsWith('.' + domain)),
        `${reference.id}: source belongs to another manufacturer: ${hostname}`);
    }
  }
});

test('all model/type/brand combinations admit exactly their declared compatibility', () => {
  for (const reference of CAR_CATALOGUE) {
    for (const type of CAR_TYPES) {
      const selection = exactSelection(reference, type);
      if (type === 'auto' || reference.types.includes(type)) {
        assert.deepEqual(normalizeCarSelection(selection), selection, `${reference.id}/${type}`);
      } else {
        badRequest(() => normalizeCarSelection(selection));
      }
    }
    for (const brand of brands.filter(candidate => candidate.id !== brandFor(reference).id)) {
      badRequest(() => normalizeCarSelection({ ...exactSelection(reference), carBrand: brand.id }));
    }
  }
});

test('automatic selection can reach every reference across the whole expanded catalogue', () => {
  const contexts = CAR_CATALOGUE.map(reference => resolveCarReference(exactSelection(reference), [], 'catalogue-coverage'));
  for (const context of contexts) {
    const recent = contexts.filter(candidate => candidate.referenceId !== context.referenceId)
      .map(candidate => ({ car_context: candidate }));
    const resolved = resolveCarReference({ carType: 'auto', carBrand: 'auto', carModel: 'auto' }, recent, 'catalogue-coverage');
    assert.equal(resolved.referenceId, context.referenceId, context.referenceId);
    assert.equal(resolved.catalogueVersion, '2026-10-21.2');
  }
});

test('version one stays byte-identical while every new version-two reference rejects a forged version-one context', async t => {
  const historical = CAR_CATALOGUES['2026-10-21.1'];
  assert.equal(createHash('sha256').update(JSON.stringify(historical)).digest('hex'),
    '34be680c08e31ad4613e918040276176facc12681498b641faf9697b85b4fd4c');
  assert.deepEqual(CAR_CATALOGUE.slice(0, historical.length), historical);
  assert.equal(CAR_CATALOGUE_VERSION, '2026-10-21.2');
  assert.equal(CAR_CATALOGUES[CAR_CATALOGUE_VERSION], CAR_CATALOGUE);
  const historicalIds = new Set(ids(historical));
  for (const reference of CAR_CATALOGUE.filter(candidate => !historicalIds.has(candidate.id))) {
    await t.test(reference.id, () => {
      const current = resolveCarReference(exactSelection(reference), [], 'new-snapshot');
      assert.equal(current.catalogueVersion, '2026-10-21.2');
      assert.equal(current.referenceId, reference.id);
      assert.deepEqual(validateCarContext(clone(current)), current);
      badRequest(() => validateCarContext({ ...clone(current), catalogueVersion: '2026-10-21.1' }));
      const withoutMenus = clone(current);
      delete withoutMenus.requestedBrand;
      delete withoutMenus.requestedModel;
      badRequest(() => validateCarContext({ ...withoutMenus, catalogueVersion: '2026-10-21.1' }));
    });
  }
});

for (const id of ['koenigsegg-jesko-attack-coupe', 'koenigsegg-regera-2015-coupe']) {
  test(`${id} remains the closed coupé with its removable hardtop fitted`, () => {
    const reference = CAR_CATALOGUE.find(candidate => candidate.id === id);
    assert.ok(reference);
    assert.match(reference.variant, /(?:removable|detachable) hardtop fitted/i);
    assert.ok(reference.types.includes('coupe_gt'));
    assert.equal(reference.types.includes('convertible'), false);
    assert.ok(availableCarModels('coupe_gt', 'koenigsegg').some(candidate => candidate.id === id));
    assert.equal(availableCarModels('convertible', 'koenigsegg').some(candidate => candidate.id === id), false);
  });
}
