/** Isolated real React component + deliberately out-of-order provider promises. No CRM/Auth substitution. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),ts=require('typescript');
const {webpack}=require('next/dist/compiled/webpack/webpack');
const {chromium}=require('/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'oar-address-component-'));
const emit=(source,destination)=>writeFileSync(join(temp,destination),ts.transpileModule(readFileSync(resolve(root,source),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText);
emit('components/address/AddressField.tsx','AddressField.js');emit('lib/address.ts','address.js');emit('lib/addressProvider.ts','addressProvider.js');
writeFileSync(join(temp,'i18n.js'),'exports.useI18n = () => ({language:"fr"});');
writeFileSync(join(temp,'styles.js'),'module.exports = {};');
writeFileSync(join(temp,'entry.js'),`
const React=require('react'),{createRoot}=require('react-dom/client'),{AddressField}=require('./AddressField');
const {formatAddress,addressFingerprint}=require('./address');
window.__addressHarness={requests:[],selections:[],submits:0};
const state=window.__addressHarness;
const provider={id:'fixture',attribution:'Fixture',coversCountry:country=>!country||country==='France',
 search:(query,options)=>new Promise(resolve=>state.requests.push({query,resolve,signal:options.signal})),
 resolve:(suggestion,options)=>new Promise(resolve=>state.selections.push({suggestion,resolve,signal:options.signal}))};
state.suggestion=label=>({key:label,label,street:label,city:'Paris',postalCode:'00123',kind:'street',latitude:48,longitude:2});
state.value=label=>{const a={houseNumber:'',street:label,line1:label,complement:'',postalCode:'00123',city:'Paris',country:'France',countryCode:'FR',source:'ign',sourceId:label,precision:'street',latitude:48,longitude:2};a.formattedAddress=formatAddress(a);a.fingerprint=addressFingerprint(a.formattedAddress);return a;};
function App(){const [text,setText]=React.useState(''),[metadata,setMetadata]=React.useState(undefined),[visible,setVisible]=React.useState(true);const canonicalize=next=>{if(next&&next.source==='manual'&&!next.line1){const a={...next,line1:next.formattedAddress,city:'Paris',postalCode:'00123'};a.formattedAddress=formatAddress(a);a.fingerprint=addressFingerprint(a.formattedAddress);setMetadata(a);}else setMetadata(next);};return React.createElement(React.Fragment,null,
React.createElement('form',{id:'fixture-form',onSubmit:e=>{e.preventDefault();state.submits++;}},
React.createElement(AddressField,{name:'a',label:'Address A',provider,textMode:'line1',value:text,metadata,onChange:setText,onMetadataChange:canonicalize}),
React.createElement(AddressField,{name:'b',label:'Address B',provider,cityFieldName:'siblingCity'}),React.createElement('input',{name:'siblingCity','aria-label':'Sibling city'}),
visible&&React.createElement(AddressField,{name:'closing',label:'Closing',provider}),
React.createElement('button',{type:'reset'},'Reset'),React.createElement('button',{type:'submit'},'Save')),
React.createElement('button',{id:'close-field',onClick:()=>setVisible(false)},'Close field'));}
createRoot(document.getElementById('root')).render(React.createElement(App));
`);
await new Promise((done,fail)=>webpack({mode:'development',devtool:false,target:'web',entry:join(temp,'entry.js'),output:{path:temp,filename:'bundle.js'},resolve:{modules:[join(root,'node_modules')],alias:{'@/lib/address':join(temp,'address.js'),'@/lib/addressProvider':join(temp,'addressProvider.js'),'@/lib/i18n/I18nProvider':join(temp,'i18n.js'),'./AddressField.module.css':join(temp,'styles.js')}}},(err,stats)=>err?fail(err):stats.hasErrors()?fail(Error(stats.toString({all:false,errors:true}))):done()));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const count=()=>page.evaluate(()=>window.__addressHarness.requests.length);
const waitCount=n=>page.waitForFunction(n=>window.__addressHarness.requests.length>=n,n);
const settle=(index,label)=>page.evaluate(({index,label})=>{const h=window.__addressHarness;h.requests[index].resolve([h.suggestion(label)]);},{index,label});
const field=name=>page.locator('[data-address-field='+name+']');
try {
 await page.setContent('<div id="root"></div>');await page.addScriptTag({path:join(temp,'bundle.js')});
 const a=field('a').locator('[name=a]'),b=field('b').locator('[name=b]');await a.waitFor();
 await a.fill('old query');await waitCount(1);await a.fill('latest query');await waitCount(2);await settle(1,'Latest street');await field('a').getByRole('option',{name:/Latest street/}).waitFor();await settle(0,'Old street');await page.waitForTimeout(30);
 assert.equal(await field('a').getByRole('option',{name:/Old street/}).count(),0);assert.equal(await a.inputValue(),'latest query');
 assert.equal(await field('a').getByRole('option').getAttribute('aria-selected'),'false');
 assert.equal(await field('a').locator('[name=aDetails]').evaluate(e=>JSON.parse(e.value).source),'manual');
 await b.fill('independent query');await waitCount(3);await settle(2,'Independent street');await field('b').getByRole('option',{name:/Independent street/}).waitFor();
 assert.equal(await a.inputValue(),'latest query');assert.equal(await b.inputValue(),'independent query');
 // Reopen A suggestions, choose by keyboard, then edit before its slow details response.
 await a.fill('selected query');await waitCount(4);await settle(3,'Selected street');await field('a').getByRole('option').waitFor();await a.press('ArrowDown');await a.press('Enter');await page.waitForFunction(()=>window.__addressHarness.selections.length===1);
 await a.fill('manual edit after selection');await page.evaluate(()=>{const h=window.__addressHarness;h.selections[0].resolve(h.value('Selected street'));});await page.waitForTimeout(40);
 assert.equal(await a.inputValue(),'manual edit after selection');assert.equal(await field('a').locator('[name=aDetails]').evaluate(e=>JSON.parse(e.value).source),'manual');
 // Clearing and changing country aborts pending work without clearing manual input.
 const before=await count();await a.fill('');await page.waitForTimeout(400);assert.equal(await count(),before);await a.fill('pending country query');await waitCount(before+1);
 await field('a').getByLabel('Pays / pays de recherche',{exact:true}).fill('Monaco');await a.fill('Place du Palais, Monaco');await page.waitForTimeout(400);assert.equal(await count(),before+1);await settle(before,'Stale French street');await page.waitForTimeout(20);assert.equal(await field('a').getByRole('option').count(),0);assert.equal(await a.inputValue(),'Place du Palais, Monaco');assert.equal(await field('a').locator('[name=aDetails]').evaluate(e=>JSON.parse(e.value).country),'Monaco');assert.equal(await field('a').locator('[name=aDetails]').evaluate(e=>JSON.parse(e.value).countryCode),'MC');
 // Unmount a field while its provider ignores AbortSignal; no stale UI or exception.
 const closing=field('closing').locator('[name=closing]');await closing.fill('closing query');await waitCount(before+2);await page.locator('#close-field').click();await settle(before+1,'Closed street');await page.waitForTimeout(20);assert.equal(await field('closing').count(),0);
 // Controlled parent echoes preserve search and explicit selection, then Form.reset clears all state.
 await a.fill('');await field('a').getByLabel('Pays / pays de recherche',{exact:true}).fill('France');const n=await count();await a.fill('final selection');await waitCount(n+1);await settle(n,'Final street');await field('a').getByRole('option').click();await page.waitForFunction(()=>window.__addressHarness.selections.length===2);await page.evaluate(()=>{const h=window.__addressHarness;h.selections[1].resolve(h.value('Final street'));});await field('a').getByText('Adresse sélectionnée. Les champs restent modifiables.',{exact:true}).waitFor();
 assert.equal(await field('a').locator('[name=aDetails]').evaluate(e=>JSON.parse(e.value).source),'ign');assert.match(await a.inputValue(),/Final street/);
 // A separate Contact city field rebuilds a structured full address instead of leaving an old Maps city.
 const cityRequest=await count();await b.fill('full city address');await waitCount(cityRequest+1);await settle(cityRequest,'Current full street');await field('b').getByRole('option').click();await page.waitForFunction(()=>window.__addressHarness.selections.length===3);await page.evaluate(()=>{const h=window.__addressHarness;h.selections[2].resolve(h.value('Current full street'));});await field('b').getByText('Adresse sélectionnée. Les champs restent modifiables.',{exact:true}).waitFor();
 await page.getByLabel('Sibling city',{exact:true}).fill('Lyon');assert.match(await b.inputValue(),/00123 Lyon/);assert.doesNotMatch(await b.inputValue(),/Paris/);const updatedCity=await field('b').locator('[name=bDetails]').evaluate(e=>JSON.parse(e.value));assert.equal(updatedCity.source,'manual');assert.equal(updatedCity.city,'Lyon');assert.equal(updatedCity.latitude,undefined);assert.equal(updatedCity.sourceId,undefined);
 // The controlled parent's current value is its reset default; B uses its original empty default.
 await page.getByRole('button',{name:'Reset',exact:true}).click();assert.equal(await b.inputValue(),'');assert.equal(await field('b').locator('[name=bDetails]').inputValue(),'{}');
 assert.equal(await page.evaluate(()=>window.__addressHarness.submits),0);assert.deepEqual(errors,[]);
 console.log('PASS out-of-order search, no auto-selection, controlled parent echo, independent fields, stale details, clear/country cancellation, unmount, keyboard choice and reset');
} finally {await browser.close();}
