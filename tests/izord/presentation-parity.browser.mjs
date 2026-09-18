/** Isolated native-PPT parity against the unchanged user-supplied HTML. No app/Auth. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url), repo = path.resolve(import.meta.dirname, '../..');
const JSZip = require(path.join(repo, 'node_modules/jszip'));
const { build } = require(process.env.IZORD_ESBUILD_RUNTIME || '/tmp/izord-browser-runtime/node_modules/esbuild');
const { chromium } = require(process.env.IZORD_PLAYWRIGHT_RUNTIME ? path.join(process.env.IZORD_PLAYWRIGHT_RUNTIME, 'node_modules/playwright') : '/tmp/izord-playwright-runtime-20260917/node_modules/playwright');
const artifacts = process.env.IZORD_ARTIFACTS;
if (!artifacts) throw new Error('IZORD_ARTIFACTS is required.');
await mkdir(artifacts, { recursive: true });
const privateDirectory = await mkdtemp(path.join(tmpdir(), 'izord-ppt-native-'));
const source = await readFile(process.env.IZORD_ORIGINAL_HTML || '/Users/vg/Desktop/IZORD_Invest_Fiche_Projet_Locations_v3 (1).html');
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(source), '8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1');
const bundle = await build({ stdin: { contents: `import * as ppt from './lib/izord/presentation'; import { createProjectData } from './lib/izord/model'; import { calculate } from './lib/izord/finance'; window.ported={...ppt,createProjectData,calculate};`, resolveDir: repo, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
const origin = 'http://127.0.0.1:3166';
const server = createServer((request, response) => {
  if (request.url === '/original') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(source); }
  else if (request.url === '/ported.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
  else if (request.url === '/ported') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Native PPT fixture</title><script src="/ported.js"></script></html>'); }
  else { response.statusCode = 404; response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3166, '127.0.0.1', resolve); });
let browser;
const evidence = { startedAt: new Date().toISOString(), sourceSHA256: sha256(source), privateOriginalPackages: privateDirectory, checks: [], errors: [], remoteRequests: [], browserVersion: null, playwrightVersion: require('/tmp/izord-playwright-runtime-20260917/node_modules/playwright/package.json').version };
const passed = (name, detail = {}) => { evidence.checks.push({ name, status: 'pass', ...detail }); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true }); evidence.browserVersion = browser.version();
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); evidence.remoteRequests.push(new URL(route.request().url()).origin); return route.abort(); });
  await context.addInitScript(() => { const RealDate = Date; class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-17T10:00:00.000Z'])); } static now() { return 1789639200000; } } window.Date = FixedDate; });
  const original = await context.newPage(), ported = await context.newPage();
  for (const page of [original, ported]) page.on('pageerror', error => evidence.errors.push(error.message));
  await original.goto(origin + '/original'); await ported.goto(origin + '/ported');
  const blank = await ported.evaluate(() => window.ported.createProjectData());
  const gallery = await ported.evaluate(() => [[600,360,'#467064'],[300,450,'#d7b870'],[700,300,'#56758f']].map(([width,height,color], index) => { const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height; const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);ctx.fillStyle='#fff';ctx.font='24px Arial';ctx.fillText('PHOTO FICTIVE '+(index+1),15,40); return { data:canvas.toDataURL('image/jpeg',.9),label:'Photographie fictive '+(index+1),page:index+1,width,height,source:'Dossier de test synthétique' }; }));
  const complete = { ...blank, state: { ...blank.state,project:'Projet fictif — Les Pins',ref:'FIXTURE-PPT-2026',address:'12 rue Exemple — 00000 Ville test',type:'Maison',area:'180',land:'950',mainArea:'150',secondArea:'30',source:'Dossier synthétique local — aucune donnée réelle',measurement:'Surfaces fictives pour test',features:'Jardin fictif · Terrasse fictive',acq:'1200000',works:'150000',resale:'1750000',weekly:'4200',weeks:'8',monthly:'2900',rentedMonths:'10',rentalCosts:'3000',annualRentalCosts:'2400',management:'12',annualManagement:'7',costsReviewed:true,annualCostsReviewed:true,seasonalCostsReviewed:true }, importMeta: { sources: ['source-fictive.pdf'], warnings: ['Contrôle fictif'], proposals: {}, roles: {} }, importGallery: gallery, photos: { main:gallery[0].data,view:gallery[1].data,inside:gallery[2].data,operation:gallery[0].data }, photoGalleryRoles: { main:0,view:1,inside:2,operation:0 } };
  const cases = [ ['blank-two', blank, 2], ['seasonal-two',{...complete,state:{...complete.state,includePhotoSlide:false}},2], ['seasonal-three',complete,3], ['annual-three',{...complete,state:{...complete.state,rentalMode:'annual'}},3], ['compare-three',{...complete,state:{...complete.state,rentalMode:'compare'}},3] ];
  for (const [name, data, expectedSlides] of cases) {
    const originalResult = await original.evaluate(async input => { state=structuredClone(input.state); photos=structuredClone(input.photos);importMeta=structuredClone(input.importMeta);importGallery=structuredClone(input.importGallery);photoGalleryRoles=structuredClone(input.photoGalleryRoles);isExample=false;const blob=await makePpt();return {binary:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);}),maps:maps(state,calculate(state))};},data);
    const portedResult = await ported.evaluate(async input => { const blob=await window.ported.generatePresentation(input);return {binary:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);}),maps:window.ported.presentationMaps(input.state)};},data);
    const originalBytes=Buffer.from(originalResult.binary,'base64'),portedBytes=Buffer.from(portedResult.binary,'base64');
    await writeFile(path.join(privateDirectory,name+'-original.pptx'),originalBytes,{mode:0o600});
    await writeFile(path.join(artifacts,name+'-native.pptx'),portedBytes);
    assert.deepEqual(portedResult.maps,originalResult.maps);
    const originalZip=await JSZip.loadAsync(originalBytes,{checkCRC32:true}),portedZip=await JSZip.loadAsync(portedBytes,{checkCRC32:true});
    const paths=Object.keys(portedZip.files).filter(name=>/^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name));
    assert.equal(paths.filter(name=>name.startsWith('ppt/slides/')).length,expectedSlides);
    for(const part of paths) {
      const a=await originalZip.file(part).async('string'),b=await portedZip.file(part).async('string');
      const canonical=await ported.evaluate(({a,b,part})=>{const parse=text=>{const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('Invalid XML');const summary=/^ppt\/slides\/slide[12]\.xml$/.test(part);function walk(node){if(node.nodeType===3)return node.nodeValue.trim()?node.nodeValue:null;if(node.nodeType!==1)return null;const attrs=[...node.attributes].filter(attr=>attr.namespaceURI!=='http://www.w3.org/2000/xmlns/' && !(summary&&node.localName==='cNvPr'&&node.parentElement?.localName==='nvPicPr'&&['name','descr'].includes(attr.localName))).map(attr=>[attr.namespaceURI||'',attr.localName,attr.value]).sort();return [node.namespaceURI,node.localName,attrs,[...node.childNodes].map(walk).filter(v=>v!==null)];}return walk(doc.documentElement);};return [parse(a),parse(b)];},{a,b,part});
      assert.deepEqual(canonical[1],canonical[0],name+' '+part+' native XML parity');
    }
    const media=Object.keys(portedZip.files).filter(p=>p.startsWith('ppt/media/')&&!portedZip.files[p].dir);
    for(const part of media)assert.equal(sha256(await portedZip.file(part).async('nodebuffer')),sha256(await originalZip.file(part).async('nodebuffer')),name+' media parity '+part);
    const pres=await portedZip.file('ppt/presentation.xml').async('string');assert.match(pres,/cx="12192000"/);assert.match(pres,/cy="6858000"/);
    assert.match(await portedZip.file('[Content_Types].xml').async('string'), /<Types xmlns="http:\/\/schemas.openxmlformats.org\/package\/2006\/content-types"/);
    for (const rel of ['_rels/.rels','ppt/_rels/presentation.xml.rels']) assert.match(await portedZip.file(rel).async('string'), /<Relationships xmlns="http:\/\/schemas.openxmlformats.org\/package\/2006\/relationships"/);
    assert.equal(portedZip.file('docProps/thumbnail.jpeg'),null);assert.equal(portedZip.file('ppt/printerSettings/printerSettings1.bin'),null);
    for(const file of Object.values(portedZip.files).filter(p=>!p.dir&&/\.xml$/.test(p.name)))assert.doesNotMatch(await file.async('string'),/Dragon|DRAGON|HR2705|hr_p\d|Marguerite|Steve Canny/,name+' no template residues in '+file.name);
    passed(name,{slides:expectedSlides,nativeXMLParts:paths.length,photos:media.length,sha256:sha256(portedBytes)});
  }
  const preservation=await ported.evaluate(async input=>{input.state.project='Dragon Island — import volontaire fictif';input.state.source='HR2705 — source volontairement saisie dans un test fictif';input.importGallery[0].label='Dragon Island — photo importée fictive';const blob=await window.ported.generatePresentation(input);return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});},complete);
  const preserved=await JSZip.loadAsync(Buffer.from(preservation,'base64'));assert.match(await preserved.file('ppt/slides/slide1.xml').async('string'),/Dragon Island/);assert.match(await preserved.file('ppt/notesSlides/notesSlide1.xml').async('string'),/HR2705/);assert.match(await preserved.file('ppt/slides/slide3.xml').async('string'),/Dragon Island/);
  passed('deliberately-imported-historical-words-preserved');
  const dedup=await ported.evaluate(async input=>{input.importGallery.push({...input.importGallery[0]});const p=await window.ported.preparedPhotos(input);const layout=window.ported.photoLayout(p);return {count:p.length,layout};},complete);assert.equal(dedup.count,3);assert.equal(dedup.layout.length,3);passed('strict-gallery-deduplication-native-layout');
  const abort=await ported.evaluate(async input=>{const c=new AbortController();c.abort();try{await window.ported.generatePresentation(input,{signal:c.signal});return false;}catch(e){return e.name==='AbortError';}},complete);assert.equal(abort,true);passed('aborted-generation-refused');
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.remoteRequests,[]);passed('no-browser-errors-no-external-network');
} catch(error) {evidence.failure={name:error.name,message:error.message};process.exitCode=1;console.error(error.message);}
finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));evidence.finishedAt=new Date().toISOString();evidence.closed=true;await writeFile(path.join(artifacts,'presentation-parity-results.json'),JSON.stringify(evidence,null,2)+'\n');}
