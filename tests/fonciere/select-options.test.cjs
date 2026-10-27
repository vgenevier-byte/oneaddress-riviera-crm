require('../i18n/register-typescript.cjs');
require.extensions['.css'] = module => { module.exports = {}; };
const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { I18nProvider } = require('../../lib/i18n/I18nProvider');
const GuidedProjectField = require('../../components/fonciere/GuidedProjectField').default;
const { GUIDED_FIELD_DEFINITIONS: definitions, guidedSelectOptions, setGuidedField, GUIDED_CHECK_STATUSES, GUIDED_DIAGNOSTIC_STATUSES } = require('../../lib/fonciere/guided');
const { createFonciereData, validateFonciereData } = require('../../lib/fonciere/model');
const { createProjectData, validateProjectData } = require('../../lib/izord/model');
const { izordFieldOptions } = require('../../components/izord/selectOptions');
const fieldSource = require('../../components/izord/fields.json');
const { translateLabel } = require('../../lib/i18n/engine');

function render(key, data, lang = 'fr', extra = {}) {
  let edits = 0;
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(GuidedProjectField, { field: { key, fr: key, en: key }, data, lang, onChange: () => { edits++; }, ...extra })));
  assert.equal(edits, 0, 'rendering/reordering must never edit the record');
  return html;
}
function options(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const select = html.match(new RegExp(`<select[^>]*id="${escaped}(?:-native)?"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(select, id);
  return [...select[1].matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([, attributes, label]) => ({ value: attributes.match(/value="([^"]*)"/)?.[1] ?? label, selected: attributes.includes('selected=""') }));
}
const values = rows => rows.map(row => row.value);

test('Foncière rendered dropdowns use visible FR/EN labels and retain selected IDs and saved records', () => {
  const data = setGuidedField({ ...createFonciereData(), name: 'Villa de contrôle' }, 'propertyType', 'villa');
  const original = JSON.stringify(data), catalogue = JSON.stringify(definitions);
  const fr = ['', 'apartment', 'offices', 'mixed', 'parking', 'building', 'commercial', 'industrial', 'house', 'land', 'villa', 'to_confirm', 'not_applicable', 'other'];
  const en = ['', 'apartment', 'building', 'commercial', 'parking', 'house', 'industrial', 'land', 'mixed', 'offices', 'villa', 'to_confirm', 'not_applicable', 'other'];
  for (const [lang, expected] of [['fr', fr], ['en', en], ['fr', fr]]) {
    const rendered = options(render('propertyType', data, lang), 'fonciere-propertyType');
    assert.deepEqual(values(rendered), expected);
    assert.deepEqual(values(rendered.filter(row => row.selected)), ['villa']);
  }
  assert.equal(JSON.stringify(data), original);
  assert.equal(JSON.stringify(definitions), catalogue);
  assert.deepEqual(validateFonciereData(JSON.parse(original)), data);
});

test('guided scales, periods, statuses, yes/no and DPE/GES grades retain their declared order', () => {
  for (const lang of ['fr', 'en']) {
    for (const key of ['condition', 'seaExtent', 'occupancy', 'servicing']) {
      assert.equal(definitions[key].optionOrder, 'business');
      assert.deepEqual(values(options(render(key, createFonciereData(), lang), `fonciere-${key}`)), ['', ...definitions[key].options.map(option => option.value)]);
    }
    for (const [key, subkey, policy] of [['charges', 'period', 'chronological'], ['rentalHypothesis', 'period', 'chronological'], ['renovation', 'stage', 'business'], ['worksHypothesis', 'level', 'business'], ['poolDetails', 'heating', 'business']]) {
      const subfield = definitions[key].subfields.find(field => field.key === subkey);
      assert.equal(subfield.optionOrder, policy);
      assert.deepEqual(values(options(render(key, createFonciereData(), lang), `fonciere-${key}-${subkey}`)), ['', ...subfield.options.map(option => option.value)]);
    }
    const diagnostics = setGuidedField(createFonciereData(), 'diagnostics', [{ code: 'dpe', status: 'available', grade: 'C' }]);
    assert.deepEqual(values(options(render('diagnostics', diagnostics, lang), 'fonciere-diagnostics-dpe-status')), ['', ...GUIDED_DIAGNOSTIC_STATUSES.map(option => option.value)]);
    assert.deepEqual(values(options(render('diagnostics', diagnostics, lang), 'fonciere-diagnostics-dpe-grade')), ['', ...'ABCDEFG']);
    const checks = setGuidedField(createFonciereData(), 'pointsToVerify', [{ code: 'planning', status: 'in_progress' }]);
    assert.deepEqual(values(options(render('pointsToVerify', checks, lang), 'fonciere-pointsToVerify-planning-status')), ['', ...GUIDED_CHECK_STATUSES.map(option => option.value)]);
  }
});

test('guided categories declare their policy; complements are explicit and source arrays remain intact', () => {
  for (const definition of Object.values(definitions)) {
    if (definition.kind === 'choice') assert.ok(definition.optionOrder);
    for (const subfield of definition.subfields || []) if (subfield.kind === 'choice') assert.ok(subfield.optionOrder);
  }
  const payer = definitions.fees.subfields.find(field => field.key === 'payer');
  assert.deepEqual(guidedSelectOptions(payer.options, 'fr', payer.optionOrder).map(option => option.value), ['buyer', 'shared', 'seller', 'to_confirm']);
  const mode = definitions.rentalHypothesis.subfields.find(field => field.key === 'mode');
  assert.deepEqual(guidedSelectOptions(mode.options, 'en', mode.optionOrder).map(option => option.value), ['long_term', 'mixed', 'seasonal', 'to_confirm', 'not_applicable', 'other']);
});

test('linked document labels sort accents and retained historical identities without selecting a replacement', () => {
  const data = setGuidedField(createFonciereData(), 'renovation', { stage: 'documented', documentId: 'historical-document' });
  const documents = [{ id: 'z', label: 'Z plan' }, { id: 'e', label: 'Électricité' }, { id: 'a', label: 'Amiante' }];
  for (const [lang, expected] of [['fr', ['', 'a', 'historical-document', 'e', 'z']], ['en', ['', 'a', 'e', 'historical-document', 'z']]]) {
    const rendered = options(render('renovation', data, lang, { documents }), 'fonciere-renovation-documentId');
    assert.deepEqual(values(rendered), expected);
    assert.deepEqual(values(rendered.filter(row => row.selected)), ['historical-document']);
  }
  assert.deepEqual(documents.map(document => document.id), ['z', 'e', 'a']);
});

test('IZORD categorical menus sort their translated labels while preserving real other regime and explicit defaults', () => {
  const data = createProjectData(), original = JSON.stringify(data), source = JSON.stringify(fieldSource);
  const expected = {
    fr: { rentalMode: ['compare', 'annual', 'seasonal'], regime: ['other', 'mdb'], resaleBasis: ['fai', 'net'] },
    en: { rentalMode: ['annual', 'compare', 'seasonal'], regime: ['other', 'mdb'], resaleBasis: ['fai', 'net'] },
  };
  for (const lang of ['fr', 'en', 'fr']) {
    for (const field of fieldSource.filter(field => field.kind === 'select')) {
      assert.ok(field.optionOrder);
      const rendered = izordFieldOptions(field, lang, option => translateLabel(option.label, lang, 'izord'));
      assert.deepEqual(rendered.map(option => option.value), field.optionOrder === 'alphabetical' ? expected[lang][field.key] : field.options.map(option => option.value));
      assert.ok(rendered.some(option => option.value === data.state[field.key]), `${field.key} default retained`);
    }
  }
  assert.equal(JSON.stringify(data), original);
  assert.equal(JSON.stringify(fieldSource), source);
  assert.deepEqual(validateProjectData(JSON.parse(original)), data);
});
