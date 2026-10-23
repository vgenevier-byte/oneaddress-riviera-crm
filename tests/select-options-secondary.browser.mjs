/** Real isolated React components with actual FR/EN catalogs. No Auth, database or external generation calls. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url), ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'oar-secondary-options-'));
const output = (file, source) => { const path = join(temp, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); };
const emit = (file, extra = '') => output(file.replace(/\.tsx?$/, '.js'), ts.transpileModule(readFileSync(join(root, file), 'utf8') + extra, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
for (const file of ['lib/selectOptions.ts', 'lib/currency.ts', 'lib/address.ts', 'lib/addressProvider.ts', 'components/address/AddressField.tsx', 'components/QuickRepliesView.tsx']) emit(file);
for (const directory of ['lib/i18n', 'lib/i18n/catalogs']) for (const file of readdirSync(join(root, directory))) if (/\.tsx?$/.test(file)) emit(`${directory}/${file}`);
emit('components/publisher/PublisherPage.tsx', '\nexport { CreativeSelector };');
for (const file of ['lib/publisher/carSelection.js', 'lib/publisher/catalogue-2026-10-21.2.js']) output(file, readFileSync(join(root, file), 'utf8'));
output('lib/access/operations.js', 'exports.isCancelled = () => false;');
output('lib/publisher/draftRecovery.js', 'exports.capturePublisherDraft = () => {}; exports.readPublisherDraft = () => undefined;');
output('components/publisher/api.js', 'exports.usePublisherApi = () => {}; exports.PublisherRequestError = class extends Error {};');
output('empty.js', 'module.exports = {};');
output('entry.js', `
const React = require('react'), { createRoot } = require('react-dom/client');
const { I18nProvider, useI18n } = require('./lib/i18n/I18nProvider');
const { CreativeSelector } = require('./components/publisher/PublisherPage');
const QuickReplies = require('./components/QuickRepliesView').default;
const { AddressField } = require('./components/address/AddressField');
const addresses = [{ label: 'Zulu', address: '5 rue Zulu, Nice' }, { label: 'École', address: '8 rue École, Menton' }, { label: 'alpha', address: '2 rue Alpha, Cannes' }];
function App() {
 const { language, setLanguage } = useI18n();
 const [direction, setDirection] = React.useState(() => JSON.parse(localStorage.getItem('test-direction') || 'null') || { universe: 'cars', moment: 'day', style: 'elegant', carType: 'auto', carBrand: 'auto', carModel: 'auto' });
 const [address, setAddress] = React.useState('');
 return React.createElement(React.Fragment, null,
  React.createElement('button', { id: 'language', onClick: () => setLanguage(language === 'fr' ? 'en' : 'fr') }, language),
  React.createElement('div', { id: 'publisher' }, React.createElement(CreativeSelector, { mode: 'daily', direction, onDirectionChange: setDirection, onCreate: value => { window.__savedDirection = value; localStorage.setItem('test-direction', JSON.stringify(value)); } })),
  React.createElement('div', { id: 'quick' }, React.createElement(QuickReplies)),
  React.createElement('div', { id: 'address' }, React.createElement(AddressField, { name: 'reuse', value: address, onChange: setAddress, reuseAddresses: addresses }))
 );
}
createRoot(document.getElementById('root')).render(React.createElement(I18nProvider, null, React.createElement(App)));
`);
await new Promise((done, fail) => webpack({ mode: 'development', devtool: false, target: 'web', entry: join(temp, 'entry.js'), output: { path: temp, filename: 'bundle.js' }, resolve: { modules: [join(root, 'node_modules')], alias: { '@/lib': join(temp, 'lib'), './publisher.css': join(temp, 'empty.js'), './AddressField.module.css': join(temp, 'empty.js') } } }, (error, stats) => error ? fail(error) : stats.hasErrors() ? fail(Error(stats.toString({ all: false, errors: true }))) : done()));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
// A fictional local document supplies localStorage; deny and record every other network request.
const unexpectedRequests = [];
await page.route("**/*", async route => {
 const request = route.request();
 if (request.url() === "http://127.0.0.1:3989/" && request.isNavigationRequest() && request.resourceType() === "document") {
  await route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  return;
 }
 unexpectedRequests.push(request.method() + " " + request.url());
 await route.abort("blockedbyclient");
});
const mount = async () => { await page.goto('http://127.0.0.1:3989/'); await page.addScriptTag({ path: join(temp, 'bundle.js') }); await page.locator('#publisher-car-type').waitFor(); };
const optionRows = selector => page.locator(selector).evaluate(select => [...select.options].map(option => ({ value: option.value, label: option.textContent })));
const sorted = async (selector, language, pinned = 1) => {
 const rows = await optionRows(selector), labels = rows.slice(pinned).map(row => row.label);
 assert.deepEqual(labels, [...labels].sort(new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare), selector + ' visible labels sorted in ' + language);
 return rows;
};
try {
 await mount();
 for (const selector of ['#publisher-car-type', '#publisher-car-brand', '#publisher-car-model', '#quick select', '#address select']) {
  if (selector === '#quick select') for (let index = 0; index < 3; index++) await sorted(`#quick select >> nth=${index}`, 'fr');
  else await sorted(selector, 'fr');
 }
 const initialAddressOptions = await optionRows('#address select');
 assert.deepEqual(initialAddressOptions.map(row => row.value), ['', '2', '1', '0'], 'Address reuse values preserve original indices');
 await page.locator('#address select').selectOption({ label: 'École' });
 await page.locator('#address button').click();
 assert.equal(await page.locator('#address textarea').inputValue(), '8 rue École, Menton');
 await page.locator('#publisher-car-brand').selectOption('porsche');
 await sorted('#publisher-car-model', 'fr');
 const models = await optionRows('#publisher-car-model');
 assert.ok(models.length > 2);
 const selectedModel = models[2].value;
 await page.locator('#publisher-car-model').selectOption(selectedModel);
 await page.locator('#quick select').nth(2).selectOption('WhatsApp');
 const originalValues = await page.locator('select').evaluateAll(selects => selects.map(select => select.value));
 const frTypeOrder = (await optionRows('#publisher-car-type')).map(row => row.value);
 await page.locator('#language').click();
 await page.waitForFunction(() => document.getElementById('language').textContent === 'en');
 assert.deepEqual(await page.locator('select').evaluateAll(selects => selects.map(select => select.value)), originalValues, 'Language change preserves every selected value');
 for (const selector of ['#publisher-car-type', '#publisher-car-brand', '#publisher-car-model', '#address select']) await sorted(selector, 'en');
 for (let index = 0; index < 3; index++) await sorted(`#quick select >> nth=${index}`, 'en');
 assert.notDeepEqual((await optionRows('#publisher-car-type')).map(row => row.value), frTypeOrder, 'Translated types recalculate their order');
 await page.locator('#language').click();
 await page.waitForFunction(() => document.getElementById('language').textContent === 'fr');
 assert.deepEqual((await optionRows('#publisher-car-type')).map(row => row.value), frTypeOrder);
 assert.deepEqual(await page.locator('select').evaluateAll(selects => selects.map(select => select.value)), originalValues);
 await page.locator('#publisher .publisher-create-button').click();
 assert.equal(await page.evaluate(() => window.__savedDirection.carModel), selectedModel);
 await mount();
 assert.equal(await page.locator('#publisher-car-model').inputValue(), selectedModel, 'Saved canonical selection survives reload');
 await page.setViewportSize({ width: 390, height: 844 });
 const native = page.locator('#publisher-car-type');
 await native.focus(); await native.press('ArrowDown'); await native.press('Enter');
 assert.equal(await native.evaluate(select => document.activeElement === select), true, 'Native keyboard focus retained on mobile viewport');
 await sorted('#publisher-car-model', 'fr');
 assert.deepEqual(errors, []);
 assert.deepEqual(unexpectedRequests, [], "No API or external network request was attempted");
 console.log('PASS real FR/EN Publisher type/brand/model and QuickReplies ordering; original-index address reuse; language selection retention; fictional localStorage reload; native keyboard + mobile viewport. No authenticated or Production checks.');
} finally { await browser.close(); }
