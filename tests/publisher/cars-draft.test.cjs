require('../i18n/register-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePublisherDraft, readPublisherDraft, clearPublisherDrafts } = require('../../lib/publisher/draftRecovery.ts');
const { LanguagePreference } = require('../../lib/i18n/preference.ts');
const { translate } = require('../../lib/i18n/engine.ts');

const account = '00000000-0000-4000-8000-000000000001';
const otherAccount = '00000000-0000-4000-8000-000000000002';
const types = ['auto', 'suv', 'saloon', 'coupe_gt', 'sports_car', 'convertible', 'supercar', 'luxury_van'];

test('all car type labels translate while the account draft and technical values stay intact', () => {
  const language = new LanguagePreference(() => undefined);
  language.bindAccount(account);
  for (const carType of types) {
    const draft = { userId: account, accessRevision: 7, mode: 'guided', post: null,
      direction: { universe: 'cars', moment: 'night', style: 'dynamic', carType },
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
    direction: { universe: 'cars', moment: 'morning', style: 'elegant', carType: 'convertible' } };
  capturePublisherDraft(draft);
  capturePublisherDraft({ ...readPublisherDraft(account, 7), direction: { ...draft.direction, universe: 'boats' } });
  assert.deepEqual(readPublisherDraft(account, 7).direction, { universe: 'boats', moment: 'morning', style: 'elegant', carType: 'convertible' });
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
