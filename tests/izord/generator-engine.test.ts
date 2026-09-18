import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { BASE, calculate, errorsFor, number, rentalExportIssues, rentalNotes, rentalRateLines } from "../../lib/izord/finance";
import { createProjectData, exportProjectJson, importProjectJson, validateProjectData, type ProjectState } from "../../lib/izord/model";
import { parseAgency } from "../../lib/izord/agency";
import { PDF_READER_SOURCE } from "../../lib/izord/agency-worker";
import { allPhotoItems, imageFileKind, imageHeaderDimensions, validateImageDimensions } from "../../lib/izord/photos";

const sourcePath = process.env.IZORD_GENERATOR_SOURCE || "/Users/vg/Desktop/IZORD_Invest_Fiche_Projet_Locations_v3 (1).html";
const html = readFileSync(sourcePath, "utf8");
assert.equal(createHash("sha256").update(html).digest("hex"), "8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1", "Parity requires the exact audited HTML; no fallback oracle");
const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const sourceFinance = scripts[2];
const oracleCode = sourceFinance.slice(sourceFinance.indexOf("const BASE="), sourceFinance.indexOf("const EXAMPLE="))
  + sourceFinance.slice(sourceFinance.indexOf("const MONEY_FIELDS="), sourceFinance.indexOf("function maps("))
  + sourceFinance.slice(sourceFinance.indexOf("function rentalRateLines("), sourceFinance.indexOf("function updateRentalUI("));
const oracle = vm.runInNewContext(`${oracleCode};({BASE,calculate,errorsFor,number,rentalExportIssues,rentalNotes,rentalRateLines})`);
const parser = vm.runInNewContext(`${oracleCode};${scripts[3].slice(scripts[3].indexOf("function cleanText("), scripts[3].indexOf("function workerRead("))};parseAgency`);
const comparable = (value: unknown) => JSON.stringify(value);
const complete = { acq:"900000",works:"200000",resale:"1450000",weekly:"4000",asking:"1000000",monthly:"6000",rentalCosts:"2500",annualRentalCosts:"6000",finance:"18000",carrying:"7000",furniture:"12000",otherCosts:"9000",seasonalCostsReviewed:true,annualCostsReviewed:true,costsReviewed:true };
const cases: [string, Partial<ProjectState>][] = [
  ["01 — blank values remain unknown", {}],
  ["02 — seasonal completed project", complete],
  ["03 — zero works and zero rental income differ from missing", {...complete,works:"0",weekly:"0",weeks:""}],
  ["04 — notarial quote overrides editable 2% provision", {...complete,notaryQuote:"15000",notaryRate:"17"}],
  ["05 — other regime without quote remains incomplete", {...complete,regime:"other"}],
  ["06 — FAI resale fee plus contingencies", {...complete,resaleBasis:"fai",saleRate:"4,5",contingency:"12"}],
  ["07 — annual option uses its own fees and occupation", {...complete,rentalMode:"annual",rentedMonths:"9",annualManagement:"7"}],
  ["08 — comparison has alternative, uncombined totals", {...complete,rentalMode:"compare",management:"12",annualManagement:"6"}],
  ["09 — excess occupation preserves warning and suspends option", {...complete,weeks:"53"}],
  ["10 — rental period beyond holding suspends combined result", {...complete,holding:"6",rentalPeriod:"12"}],
  ["11 — invalid price/rate inputs and French rounding", {...complete,acq:"1.234.567,89",works:"23456,78",resale:"2 300 000,45",saleRate:"100",resaleBasis:"fai"}],
];
for (const [name, overrides] of cases) test(`Finance original HTML parity ${name}`, () => {
  const state = { ...BASE, ...overrides } as ProjectState; const expected = oracle.calculate(state); const actual = calculate(state);
  assert.equal(comparable(actual), comparable(expected));
  assert.equal(comparable(errorsFor(state)), comparable(oracle.errorsFor(state)));
  assert.equal(comparable(rentalExportIssues(actual)), comparable(oracle.rentalExportIssues(expected)));
  assert.equal(comparable(rentalNotes(state,actual)), comparable(oracle.rentalNotes(state,expected)));
  assert.equal(rentalRateLines(state), oracle.rentalRateLines(state));
});
test("Source BASE preserved exactly; no bundled sample project", () => { assert.equal(comparable(BASE), comparable(oracle.BASE)); const blank = createProjectData(); assert.equal(blank.state.project, ""); assert.doesNotMatch(exportProjectJson(blank), /Dragon|HR2705|Sainte Marguerite/i); });
test("Source number parser retains blanks, zero, French thousands, rejection and precision", () => {
  for (const value of [null, undefined, "", "   ", "0", "2 000,50 €", "1.234.567,89", "1,234.50", "-10", "NaN", "Infinity", "+20.45", "1e3", 15.2]) assert.ok(Object.is(number(value), oracle.number(value)), String(value));
});
test("Changing rental modes never changes resale margin or sums alternative rents", () => {
  const results = ["seasonal","annual","compare"].map(rentalMode => calculate({...BASE,...complete,rentalMode}));
  assert.equal(results[0].margin,results[1].margin); assert.equal(results[0].margin,results[2].margin); assert.equal(results[2].combined,null); assert.equal(results[2].rent,null); assert.equal(results[2].combinedSeasonal,results[0].combined); assert.equal(results[2].combinedAnnual,results[1].combined);
});
test("Missing works and zero works are distinct; no double counted notarial quote", () => { assert.equal(calculate({...BASE,...complete,works:""}).total,null); assert.notEqual(calculate({...BASE,...complete,works:"0"}).total,null); assert.equal(calculate({...BASE,...complete,notaryQuote:"12345",notaryRate:"50"}).fee,12345); });
const pdfCases = [
  [{page:1,text:"LOGI SERVICE\nType de bien : Maison\nVille\nVille Fictive\nCode postal\n00000\nRéférence : FIX001\nSurface habitable : 120 m²\nTerrain : 500 m²\nPrix : 500 000 EUR\nVue mer : Non\nChambres : 3\nHonoraires à la charge du vendeur"}],
  [{page:1,text:"Villa à vendre — Ville Fictive Informations\nSurface : 70 m²\nPrix demandé : 250 000 EUR\nVue mer partielle\nPiscine Oui"},{page:2,text:"Description fictive complémentaire ; aucune adresse exacte."}],
  [{page:1,text:""}],
];
for (const [index,pages] of pdfCases.entries()) test(`Agency parser original HTML parity ${index+1}`, () => assert.equal(comparable(parseAgency(pages,`fictif-${index}.pdf`)),comparable(parser(pages,`fictif-${index}.pdf`))));
test("Scan warning requires manual completion; asking price never populates target assumptions", () => { const report=parseAgency(pdfCases[0],"fictif.pdf"); assert.equal(report.fields.asking,"500000"); for(const field of ["acq","works","resale","weekly","monthly"])assert.equal(report.fields[field],undefined); assert.ok(parseAgency(pdfCases[2],"scan.pdf").warnings.some(message=>message.includes("Aucun OCR"))); });
test("JSON V1 roundtrip preserves supported fields, full photos, crops, evidence and roles", () => {
  const project=createProjectData(); project.state={...project.state,...complete,project:"Projet fictif <script>non exécuté</script>"}; project.importGallery=[{data:project.photos.main,label:"Photo fictive",page:1,width:640,height:360,source:"PDF"}]; project.photoGalleryRoles={main:0}; project.importMeta={filename:"fictif.pdf",roles:{main:0},evidence:{asking:{page:1,extract:"Prix demandé fictif"}},warnings:["Validation utilisateur seulement"],extra:[]};
  assert.deepEqual(importProjectJson(exportProjectJson(project)),project);
});
test("JSON V1 legacy compatibility fills BASE and derives missing rentalPeriod", () => { const value={format:"IZORD_FICHE_V1",state:{project:"Ancien projet volontaire",holding:"18",weeks:"104"},photos:{}}; const result=importProjectJson(JSON.stringify(value)); assert.equal(result.state.rentalPeriod,"24"); assert.equal(result.state.notaryRate,"2"); assert.equal(result.state.acq,""); assert.equal(result.state.includePhotoSlide,true); });
test("JSON imports never restore application permissions, approved status, or derived results", () => { const project=createProjectData(); const data={format:"IZORD_FICHE_V1",...project,role:"admin",status:"approved",approved_by:"fictional",calculated:{margin:1},isExample:true}; const result=importProjectJson(JSON.stringify(data)); assert.deepEqual(result,project); assert.equal(calculate(result.state).margin,null); });
test("A legitimate old imported project name is preserved without embedded sample activation", () => { const project=createProjectData(); project.state.project="Dragon Island — import explicite fictif"; assert.equal(importProjectJson(exportProjectJson(project)).state.project,project.state.project); assert.equal(JSON.parse(exportProjectJson(project)).isExample,false); });
test("JSON rejects malformed fields instead of silently truncating or dropping gallery entries", () => {
  for (const alter of [(data:ReturnType<typeof createProjectData>)=>{data.state.project="x".repeat(1001);},(data:ReturnType<typeof createProjectData>)=>{data.photos.main="https://example.invalid/photo.jpg";},(data:ReturnType<typeof createProjectData>)=>{data.photoGalleryRoles.main=50;},(data:ReturnType<typeof createProjectData>)=>{data.state.unknown="lost";}]) { const data=createProjectData(); alter(data); assert.throws(()=>validateProjectData(data)); }
  assert.throws(()=>importProjectJson('{"format":"IZORD_FICHE_V1","state":{},"photos":{},"importMeta":{"__proto__":{"polluted":true}}}'),/interdite/);
  assert.throws(()=>importProjectJson('{"format":"IZORD_FICHE_V1","state":{"__proto__":"unsafe"},"photos":{}}'),/non pris en charge/);
});
test("JSON JPEG dimensions are validated before any browser rendering or decompression", () => {
  const project=createProjectData(); const bytes=Buffer.from(project.photos.main.split(',')[1],'base64');
  let offset=-1;for(let i=2;i<bytes.length-8;i++)if(bytes[i]===255&&[192,193,194].includes(bytes[i+1])){offset=i;break;}
  assert.ok(offset>0);bytes.writeUInt16BE(50000,offset+5);bytes.writeUInt16BE(50000,offset+7);
  project.photos.main='data:image/jpeg;base64,'+bytes.toString('base64');assert.throws(()=>validateProjectData(project),/Photographie trop grande/);
  project.photos.main='data:image/jpeg;base64,/9j/2Q==';assert.throws(()=>validateProjectData(project),/Photographie trop grande/);
});
test("Photo collection deduplicates full images and skips role crops when linked to gallery", () => { const p=createProjectData(); assert.equal(allPhotoItems(p).length,0); p.importGallery=[{data:p.photos.main,label:"Fictif",page:null,width:null,height:null}]; p.photoGalleryRoles.main=0; assert.equal(allPhotoItems(p).length,1); });
test("Photo headers reject active/non-raster content and bound dimensions before browser decoding", () => {
  assert.throws(()=>imageFileKind(new TextEncoder().encode('<svg><script>alert(1)</script></svg>')));
  assert.throws(()=>validateImageDimensions(50000,50000)); assert.throws(()=>validateImageDimensions(10000,10000)); assert.throws(()=>validateImageDimensions(0,1));
  const blank=createProjectData().photos.main; const bytes=Uint8Array.from(Buffer.from(blank.split(',')[1],'base64')); assert.equal(imageFileKind(bytes),"image/jpeg"); const size=imageHeaderDimensions(bytes); assert.ok(size.width>0&&size.height>0);
});
async function readWorker(source: string, bytes: Uint8Array) {
  const events: {result?:unknown;error?:string}[]=[]; const self={postMessage:(event:{result?:unknown;error?:string})=>events.push(event),onmessage: undefined as unknown as (event:{data:ArrayBuffer})=>Promise<void>};
  vm.runInNewContext(source,{self,TextDecoder,Blob,DecompressionStream,Uint8Array,Map,Set}); await self.onmessage({data:Uint8Array.from(bytes).buffer}); const last=events[events.length-1]; if(last.error)throw new Error(last.error); return last.result;
}
const originalWorker = vm.runInNewContext(`${scripts[3].slice(0,scripts[3].indexOf("/* Import d'agence"))};PDF_READER_SOURCE`);
const textPdf = (stream: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >> endobj\n4 0 obj << /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`,"latin1");
test("Real worker source parses a digital fictitious PDF identically to original (no scripts/network)",async()=>{const bytes=textPdf("BT (Type de bien : Maison) Tj (Prix : 500000 EUR) Tj ET");assert.equal(comparable(await readWorker(PDF_READER_SOURCE,bytes)),comparable(await readWorker(originalWorker,bytes)));});
test("Real worker source exposes empty scan text for manual review, not invented data",async()=>{const result=await readWorker(PDF_READER_SOURCE,textPdf("q 1 0 0 1 0 0 cm Q")) as {pages:{text:string}[]};assert.equal(result.pages[0].text,"");});
test("PDF worker rejects non-PDF and excessive page count",async()=>{await assert.rejects(()=>readWorker(PDF_READER_SOURCE,new TextEncoder().encode("not PDF")),/PDF reconnu/);const pages=Array.from({length:121},(_,i)=>`${i+3} 0 obj << /Type /Page >> endobj`).join('\n');await assert.rejects(()=>readWorker(PDF_READER_SOURCE,new TextEncoder().encode(`%PDF-1.4\n${pages}`)),/120 pages/);});
