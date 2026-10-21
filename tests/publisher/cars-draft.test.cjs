require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePublisherDraft, readPublisherDraft, clearPublisherDrafts } = require('../../lib/publisher/draftRecovery.ts');
const { LanguagePreference } = require('../../lib/i18n/preference.ts');
const { translate } = require('../../lib/i18n/engine.ts');
const { specialistMessage } = require('../../lib/i18n/catalogs/specialist.ts');

const account = '00000000-0000-4000-8000-000000000001';
const otherAccount = '00000000-0000-4000-8000-000000000002';
const types = ['auto', 'suv', 'saloon', 'coupe_gt', 'sports_car', 'convertible', 'supercar', 'luxury_van'];

test('all car type labels translate while the account draft and technical values stay intact', () => {
  const language = new LanguagePreference(() => undefined);
  language.bindAccount(account);
  for (const carType of types) {
    const draft = { userId: account, accessRevision: 7, mode: 'guided', post: null,
      direction: { universe: 'cars', moment: 'night', style: 'dynamic', carType, carBrand: 'auto', carModel: 'auto' },
      selectedMusic: 42, requests: { 'fictitious-mutation': 'fictitious-request' } };
    capturePublisherDraft(draft);
    const before = structuredClone(draft);
    for (const locale of ['en', 'fr']) {
      language.choose(locale);
      const translated = translate(`publisher.car.type.${carType}`, locale);
      assert(translated && !translated.startsWith('publisher.'), `${locale} ${carType}`);
      assert.deepEqual(readPublisherDraft(account, 7), before);
    }
  }
  clearPublisherDrafts();
});

test('a hidden car choice stays in same-account memory without replacing moment or style', () => {
  const draft = { userId: account, accessRevision: 7, mode: 'guided', post: null,
    direction: { universe: 'cars', moment: 'morning', style: 'elegant', carType: 'convertible', carBrand: 'porsche', carModel: 'porsche-911-carrera-cabriolet-2024' } };
  capturePublisherDraft(draft);
  capturePublisherDraft({ ...readPublisherDraft(account, 7), direction: { ...draft.direction, universe: 'boats' } });
  assert.deepEqual(readPublisherDraft(account, 7).direction, { universe: 'boats', moment: 'morning', style: 'elegant', carType: 'convertible', carBrand: 'porsche', carModel: 'porsche-911-carrera-cabriolet-2024' });
  assert.equal(readPublisherDraft(otherAccount, 7), null);
  assert.equal(readPublisherDraft(account, 8), null);
  clearPublisherDrafts();
  assert.equal(readPublisherDraft(account, 7), null);
});

test('old drafts and old posts need no car metadata or retroactive reference', () => {
  const legacy = { userId: account, accessRevision: 7, mode: 'daily',
    post: { id: 'fictitious-legacy', creative_universe: 'Voitures', image_src: '/private/old-image' },
    direction: { universe: '', moment: '', style: '' } };
  capturePublisherDraft(legacy);
  assert.deepEqual(readPublisherDraft(account, 7), legacy);
  assert.equal(Object.hasOwn(readPublisherDraft(account, 7).post, 'car_context'), false);
  clearPublisherDrafts();
});

test('car reference summaries translate labels and preserve the exact canonical reference', () => {
  const reference = 'Porsche 911 Carrera — Cabriolet';
  for (const locale of ['fr', 'en']) {
    const summary = translate('publisher.car.summary', locale, { type: translate('publisher.car.type.convertible', locale), reference });
    assert(summary.includes(reference));
    assert(!summary.includes('{reference}'));
    assert(translate('publisher.car.referenceDisclaimer', locale).length > 20);
    assert(translate('publisher.car.legacyImageHint', locale).length > 60);
  }
});

test('brand/model controls and every precise catalogue model label translate without changing selections', async () => {
  const { CAR_CATALOGUE } = await import('../../lib/publisher/carSelection.js');
  const draft = { userId: account, accessRevision: 7, mode: 'guided', post: null,
    direction: { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' } };
  capturePublisherDraft(draft);
  const before = structuredClone(draft);
  for (const locale of ['fr', 'en']) {
    for (const key of ['brandLabel', 'modelLabel', 'anyBrand', 'anyModel', 'modelDisabledHint', 'modelHint', 'reset.brand', 'reset.model', 'reset.brandAndModel']) {
      const translated = translate(`publisher.car.${key}`, locale);
      assert(translated && !translated.startsWith('publisher.'), `${locale} ${key}`);
    }
    for (const reference of CAR_CATALOGUE) {
      const translated = translate(`publisher.car.model.${reference.id}`, locale);
      assert(translated.includes(reference.model), `${locale} ${reference.id} keeps exact model`);
      assert(translated.includes('—'), `${locale} ${reference.id} includes body/generation`);
      assert(!translated.startsWith('publisher.'));
    }
    assert.deepEqual(readPublisherDraft(account, 7), before);
  }
  clearPublisherDrafts();
});

test('old saved car contexts and a recovered explicit selection are not rewritten', () => {
  const context = Object.freeze({ catalogueVersion: '2026-10-21.1', referenceId: 'range-rover-l460-swb-se', requestedType: 'suv',
    manufacturer: 'Land Rover', model: 'Range Rover SE', variant: 'Standard-wheelbase five-door SUV, fixed roof',
    generation: 'Fifth generation (L460), introduced 2021', resolvedType: 'suv', visualFeatures: [] });
  const draft = { userId: account, accessRevision: 7, mode: 'guided',
    post: { id: '19394aed-b069-48dc-ac8d-cdbddfffd93c', car_context: context },
    direction: { universe: 'cars', moment: 'day', style: 'elegant', carType: 'suv', carBrand: 'land-rover', carModel: 'range-rover-l460-swb-se' } };
  capturePublisherDraft(draft);
  assert.equal(readPublisherDraft(account, 7).post.car_context, context);
  assert.equal(Object.hasOwn(context, 'requestedBrand'), false);
  assert.equal(Object.hasOwn(context, 'requestedModel'), false);
  assert.equal(readPublisherDraft(account, 7).direction.carModel, 'range-rover-l460-swb-se');
  clearPublisherDrafts();
});

test('strict selection validation errors stay clear in FR/EN, including the retained-request suffix', () => {
  const errors = [
    ['Type de voiture invalide.', 'Invalid car type.'],
    ['Marque automobile invalide.', 'Invalid car brand.'],
    ['Modèle automobile invalide.', 'Invalid car model.'],
    ['Sélection automobile invalide.', 'Invalid car selection.'],
    ['La marque choisie ne propose aucun modèle compatible avec ce type de voiture.', 'The selected brand has no model compatible with this car type.'],
    ['Choisissez une marque avant de choisir un modèle automobile.', 'Choose a brand before selecting a car model.'],
    ['Le modèle choisi est incompatible avec le type de voiture ou la marque.', 'The selected model is incompatible with the car type or brand.'],
  ];
  const retained = ' La demande est conservée ; « Reprendre l’état » consulte son état sans nouvelle génération.';
  for (const [fr, en] of errors) {
    assert.equal(specialistMessage(fr, key => translate(key, 'fr')), fr);
    assert.equal(specialistMessage(fr, key => translate(key, 'en')), en);
    assert(specialistMessage(fr + retained, key => translate(key, 'en')).startsWith(en));
  }
});
