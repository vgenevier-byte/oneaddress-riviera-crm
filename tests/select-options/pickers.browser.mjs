/** Actual picker components bundled locally. Fictional props and translations only;
 * no application Auth/RPC/database, no remote page or physical mobile device. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url), ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'oar-picker-order-'));
mkdirSync(join(temp, 'tasks'));
function emit(file, destination) {
  writeFileSync(join(temp, destination), ts.transpileModule(readFileSync(join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText);
}
for (const file of ['contactIdentity', 'contactSearch', 'vendorContacts', 'selectOptions']) emit(`lib/${file}.ts`, `${file}.js`);
emit('lib/tasks/contactOptions.ts', 'tasks/contactOptions.js');
emit('components/SearchableBusinessContactPicker.tsx', 'Business.js');
emit('components/TaskContactPicker.tsx', 'Task.js');
writeFileSync(join(temp, 'i18n.js'), `const React=require('react');exports.Context=React.createContext(null);exports.useI18n=()=>React.useContext(exports.Context);`);
writeFileSync(join(temp, 'entry.js'), `
const React=require('react'),{createRoot}=require('react-dom/client'),{Context}=require('./i18n');
const Business=require('./Business').default,Task=require('./Task').default;
const base=id=>({id,name:id,kind:'Prestataire',email:'',phone:'',city:'',postalAddress:'',budget:0,source:'',notes:'',createdAt:''});
const business=[{...base('a'),companyName:'Zèbre',fr:'Zèbre',en:'Aardvark'},{...base('b'),companyName:'Âne',fr:'Âne',en:'Zebra'}];
const ranked=[{...base('additional'),companyName:'Alpha service',email:'azur@example.invalid'},{...base('prefix'),companyName:'Azur Zèbre'}];
const task=[{id:'z',firstName:'Zoé',name:'Zulu',company:'Société commun'},{id:'e',firstName:'Élodie',name:'Éclair',company:'Société commun'},{id:'a',firstName:'Anne',name:'Alpha',company:'Société commun'}];
const bounded=Array.from({length:55},(_,index)=>({...base('cap-'+index),companyName:'Local '+(55-index)}));
window.__pickerHarness={selected:[],taskSelected:[],submits:0};
function App(){const [language,setLanguage]=React.useState('fr'),[chosen,setChosen]=React.useState(''),[taskId,setTaskId]=React.useState(''),[rows,setRows]=React.useState(business);window.__pickerHarness.setLanguage=setLanguage;window.__pickerHarness.revoke=()=>setRows(rows=>rows.filter(row=>row.id!=='b'));const t=key=>key==='modules.contacts.unnamed'?'Contact sans nom':key;return React.createElement(Context.Provider,{value:{language,t}},
React.createElement('form',{onSubmit:event=>{event.preventDefault();window.__pickerHarness.submits++;}},
React.createElement('section',{'data-picker':'all'},React.createElement(Business,{contacts:rows,searchMode:'all',queryValue:'commun',value:chosen,onSelect:row=>{setChosen(row?.id||'');window.__pickerHarness.selected.push(row?.id||'');},resultLabel:row=>row[language],label:'All contacts'})),
React.createElement('section',{'data-picker':'vendor'},React.createElement(Business,{contacts:ranked,label:'Ranked vendors'})),
React.createElement('section',{'data-picker':'bounded'},React.createElement(Business,{contacts:bounded,searchMode:'all',queryValue:'commun',value:'',label:'Bounded contacts'})),
React.createElement('section',{'data-picker':'task'},React.createElement(Task,{options:task,contactId:taskId,onChange:id=>{setTaskId(id);window.__pickerHarness.taskSelected.push(id);}})),
React.createElement('button',{type:'submit'},'Save')));}
createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const aliases = Object.fromEntries(['contactIdentity', 'contactSearch', 'vendorContacts', 'selectOptions'].map(name => [`@/lib/${name}`, join(temp, `${name}.js`)]));
aliases['@/lib/tasks/contactOptions'] = join(temp, 'tasks/contactOptions.js');
aliases['@/lib/i18n/I18nProvider'] = join(temp, 'i18n.js');
await new Promise((done, fail) => webpack({ mode: 'development', devtool: false, target: 'web', entry: join(temp, 'entry.js'), output: { path: temp, filename: 'bundle.js' }, resolve: { modules: [join(root, 'node_modules')], alias: aliases } }, (error, stats) => error ? fail(error) : stats.hasErrors() ? fail(Error(stats.toString({ all: false, errors: true }))) : done()));
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-background-networking'] });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    const errors = [], networkAttempts = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { networkAttempts.push(route.request().method() + ' ' + route.request().url()); return route.abort(); });
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ path: join(temp, 'bundle.js') });
    const section = key => page.locator(`[data-picker="${key}"]`);
    const business = section('all'), input = business.getByRole('combobox'); await input.waitFor();
    await input.focus();
    assert.deepEqual(await business.getByRole('option').locator('strong').allTextContents(), ['Âne', 'Zèbre']);
    await input.press('ArrowDown');
    assert.equal(await business.getByRole('option', { selected: true }).locator('strong').innerText(), 'Âne');
    await page.evaluate(() => window.__pickerHarness.setLanguage('en'));
    await page.waitForFunction(() => document.querySelector('[data-picker=all] [role=option] strong')?.textContent === 'Aardvark');
    assert.equal(await business.getByRole('option', { selected: true }).locator('strong').innerText(), 'Zebra', 'Highlighted contact ID survives translated reorder');
    await input.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.__pickerHarness.selected), ['b']);
    assert.equal(await business.locator('input[name=contactId]').inputValue(), 'b');
    const vendor = section('vendor'), vendorInput = vendor.getByRole('combobox'); await vendorInput.fill('azur');
    assert.deepEqual(await vendor.getByRole('option').locator('strong').allTextContents(), ['Azur Zèbre', 'Alpha service'], 'Existing rank wins over global alphabetic ordering');
    const bounded = section('bounded'); await bounded.getByRole('combobox').focus();
    const cap = await bounded.getByRole('option').locator('strong').allTextContents();
    assert.equal(cap.length, 50); assert.equal(cap[0], 'Local 1'); assert.equal(cap.at(-1), 'Local 50', 'Sort occurs before existing result cap');
    const task = section('task'), taskInput = task.getByRole('combobox'); await taskInput.fill('commun');
    assert.deepEqual(await task.getByRole('option').locator('strong').allTextContents(), ['Anne Alpha', 'Élodie Éclair', 'Zoé Zulu']);
    await taskInput.press('ArrowDown'); await taskInput.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.__pickerHarness.taskSelected), ['a']);
    assert.equal(await page.evaluate(() => window.__pickerHarness.submits), 0, 'Keyboard choice never submits a form');
    assert.deepEqual(errors, []); assert.deepEqual(networkAttempts, [], 'Isolated picker checks attempt no network request'); results.push({ width, passed: true, highlightedIdentitySurvivedLanguageReorder: true, vendorRelevancePreserved: true, sortedBeforeLimit: true, taskExactId: 'a', networkAttempts, physicalDevice: false });
    await page.close();
  }
} finally {
  await browser.close();
  const output = process.env.SELECT_OPTIONS_OUTPUT || '/private/tmp/oar-select-options-evidence'; mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'picker-results.json'), JSON.stringify({ results, actualComponents: true, fictionalPropsAndTranslations: true, actualAuth: false, actualRPC: false, actualDatabase: false, productionWrites: 0, physicalDevice: false }, null, 2));
}
console.log('PASS desktop/touch: translated all-contact ordering, highlighted ID preserved through reorder, vendor relevance, sort before cap, task alphabetical keyboard ID and zero implicit submission');
