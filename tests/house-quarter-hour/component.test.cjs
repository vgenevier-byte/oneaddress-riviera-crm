/** Render the actual component; only its i18n hook and CSS module are supplied.
 * Browser/Auth/RPC evidence is separate in browser.mjs and server.mjs.
 */
require('../i18n/register-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { translate } = require('../../lib/i18n/engine.ts');

let language = 'fr';
const filename = path.resolve(__dirname, '../../components/HouseTimeSelect.tsx');
const source = readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const componentModule = { exports: {} };
new Function('require', 'exports', 'module', compiled)(request => {
  if (request === '@/lib/i18n/I18nProvider') return { useI18n: () => ({ t: key => translate(key, language) }) };
  if (request.endsWith('.module.css')) return {};
  return require(request);
}, componentModule.exports, componentModule);
const HouseTimeSelect = componentModule.exports.default;
const expectedHours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const expectedMinutes = ['00', '15', '30', '45'];
const options = select => [...select.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(match => ({ value: match[1], text: match[2] }));

for (const lang of ['fr', 'en']) test(`${lang}: both rendered time groups offer only 24 hours and four minutes`, () => {
  language = lang;
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    ...['start', 'end'].map((kind, index) => React.createElement(HouseTimeSelect, {
      key: kind, label: translate(`crm.house.time.${kind}`, lang), value: ['08:15', '12:45'][index], onChange() {},
    }))));
  const selects = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)].map(match => match[0]);
  assert.equal(selects.length, 4);
  for (let index = 0; index < selects.length; index++) {
    const expected = index % 2 === 0 ? expectedHours : expectedMinutes;
    assert.deepEqual(options(selects[index]), expected.map(value => ({ value, text: value })));
    assert.match(selects[index], /\brequired=""/);
  }
  assert.match(selects[0], /value="08" selected=""/);
  assert.match(selects[1], /value="15" selected=""/);
  assert.match(selects[2], /value="12" selected=""/);
  assert.match(selects[3], /value="45" selected=""/);
  for (const key of ['start', 'end']) assert.ok(html.includes(`<legend>${translate(`crm.house.time.${key}`, lang)}</legend>`));
  for (const key of ['hour', 'minutes']) assert.ok(html.includes(`<label>${translate(`crm.house.time.${key}`, lang)}<select`));
  assert.doesNotMatch(html, /<input|type="time"/);
});

test('changing either rendered selector preserves the other part and emits HH:mm', () => {
  const changes = [];
  const tree = HouseTimeSelect({ label: 'Start time', value: '08:15', onChange: value => changes.push(value) });
  const labels = tree.props.children[1].props.children;
  const [hour, minute] = labels.map(label => label.props.children[1]);
  hour.props.onChange({ target: { value: '23' } });
  minute.props.onChange({ target: { value: '45' } });
  assert.deepEqual(changes, ['23:15', '08:45']);
  hour.props.onChange({ target: { value: '24' } });
  minute.props.onChange({ target: { value: '07' } });
  assert.deepEqual(changes, ['23:15', '08:45']);
});

test('rendering a controlled draft does not emit a change or round its value', () => {
  let calls = 0;
  const draft = { startTime: '08:15', endTime: '12:45' };
  renderToStaticMarkup(React.createElement(HouseTimeSelect, {
    label: 'Start time', value: draft.startTime, onChange: () => { calls++; },
  }));
  assert.equal(calls, 0);
  assert.deepEqual(draft, { startTime: '08:15', endTime: '12:45' });
});
