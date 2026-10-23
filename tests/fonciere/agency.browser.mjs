/** Actual Tesseract/PDF.js on known fictional documents. No Auth/Storage claim. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, "../..");
const artifacts = resolve(process.env.FONCIERE_OCR_ARTIFACTS || "/private/tmp/fonciere-ocr-proof");
const fixtures = resolve(process.env.FONCIERE_OCR_FIXTURES || "/private/tmp/fonciere-ocr-fixtures");
mkdirSync(artifacts, { recursive: true });
const require = createRequire(import.meta.url);
const { build } = require(process.env.FONCIERE_ESBUILD || "/private/tmp/fonciere-extraction-runtime/node_modules/esbuild");
const { chromium } = require(process.env.FONCIERE_PLAYWRIGHT || "/Users/vg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const bundle = await build({ stdin: { contents: 'import * as agency from "./lib/izord/agency";import * as imp from "./lib/fonciere/import";import * as model from "./lib/fonciere/model";import {generatePresentation} from "./lib/izord/presentation";import JSZip from "jszip";window.engine={...agency,...imp,...model,generatePresentation,JSZip};', resolveDir: root }, bundle: true, write: false, format: "esm", platform: "browser", target: "chrome120" });
const port = Number(process.env.FONCIERE_OCR_PORT || 3167), origin = `http://127.0.0.1:${port}`;
const server = createServer((req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const path = decodeURIComponent(new URL(req.url, origin).pathname);
    if (path === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><title>Agency OCR fictional input test</title><h1>Local OCR — fictional documents only</h1><script type="module" src="/engine.mjs"></script>'); return; }
    if (path === "/engine.mjs") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].contents); return; }
    const file = path.startsWith("/agency-runtime/") ? join(root, "public", path) : path.startsWith("/fixtures/") ? join(fixtures, path.slice("/fixtures/".length)) : "";
    if (!file || path.includes("..")) { res.writeHead(404).end(); return; }
    if (/\.(?:m?js)$/.test(file)) res.setHeader("Content-Type", "application/javascript");
    if (/\.wasm$/.test(file)) res.setHeader("Content-Type", "application/wasm");
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
const result = { scope: "Real local browser PDF/image/OCR on fictional inputs, no application/Auth/Storage", checks: [], remoteRequests: [], pageErrors: [] };
let browser;
try {
  await new Promise(done => server.listen(port, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--disable-background-networking", "--disable-component-update"] });
  const context = await browser.newContext();
  await context.route("**/*", route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); result.remoteRequests.push(url.origin); return route.abort(); });
  const page = await context.newPage(); page.on("pageerror", error => result.pageErrors.push(String(error)));
  await page.goto(origin); await page.waitForFunction(() => window.engine);
  for (const [filename, type, method] of [["fiche-texte-fictive.pdf", "application/pdf", "text"], ["fiche-ocr-fictive.png", "image/png", "ocr"], ["fiche-scan-fictive.pdf", "application/pdf", "ocr"]]) {
    const start = Date.now();
    const actual = await page.evaluate(async ({ filename, type }) => {
      const file = new File([await (await fetch(`/fixtures/${filename}`)).blob()], filename, { type });
      const [report] = await engine.analyzeAgencyFiles([file]);
      const mapped = await engine.agencyReportToFonciere(report);
      if (filename === "fiche-texte-fictive.pdf") window.fictionalProject = mapped;
      return { filename: report.filename, fields: report.fields, method: report.extractionMethod, gallery: report.gallery.length, warnings: [...report.warnings, ...report.readerWarnings], evidence: report.evidence, original: { name: report.sourceFile.name, bytes: report.sourceFile.size }, mapped: { name: mapped.name, address: mapped.propertyAddress, agencyAddress: mapped.agencyAddress, agentEmail: mapped.agentEmail, works: mapped.worksHypothesis, provenance: mapped.provenance[0] }, rawText: report.rawText };
    }, { filename, type });
    result.checks.push({ filename, status: "checking", durationMs: Date.now() - start, actual });
    writeFileSync(join(artifacts, "results.json"), JSON.stringify(result, null, 2));
    assert.equal(actual.fields.asking, "545000"); assert.equal(actual.fields.area, "123"); assert.equal(actual.method, method);
    assert.match(actual.fields.address, /12 rue des Nuages/); assert.match(actual.fields.agencyAddress, /99 avenue du Test/); assert.equal(actual.fields.agentEmail, "camille@example.test");
    assert.equal(actual.mapped.works, ""); assert.ok(actual.gallery > 0); assert.ok(actual.original.bytes > 0); assert.equal(actual.evidence.asking.page, 1);
    assert.match(actual.fields.agencyPotential, /(?:reserve|réserve)/); result.checks.at(-1).status = "passed"; console.log(`PASS ${filename} (${Date.now() - start}ms)`);
  }
  const directCompatibility = await page.evaluate(async () => {
    const bytes = await (await fetch("/fixtures/fiche-texte-fictive.pdf")).blob();
    const files = Array.from({ length: 6 }, (_, index) => new File([bytes], `fiche-distincte-${index}.pdf`, { type: "application/pdf" }));
    const reports = await engine.analyzeAgencyFiles(files);
    if (reports.length !== 6 || reports.some((report, index) => report.filename !== files[index].name || report.sourceFile.name !== files[index].name || report.gallery.length !== 1)) throw Error("Six-PDF direct import compatibility regressed");
    let rejected = false; try { await engine.analyzeAgencyFiles([...files, files[0]]); } catch { rejected = true; }
    if (!rejected) throw Error("Import count budget regressed");
    return { separateReports: reports.length, perFileOriginalAndGallery: true, seventhRejected: true };
  });
  result.checks.push({ filename: "direct-six-pdf-compatibility", status: "passed", durationMs: 0, actual: directCompatibility });
  console.log("PASS six independent PDFs and seventh-file budget");
  const snapshotExport = await page.evaluate(async () => {
    const source = structuredClone(window.fictionalProject);
    source.name = "Instantane fictif conserve";
    source.description = "DESCRIPTION_COMPLETE_FICTIVE_".repeat(100);
    const snapshot = engine.toPresentationData(source, { id: "11111111-1111-4111-8111-111111111111", revision: 2 });
    source.name = "Titre modifie plus tard"; source.askingPrice = "1"; source.description = "Description remplacee";
    source.presentationData.importGallery[0].label = "Visuel modifie plus tard";
    if (snapshot.state.project !== "Instantane fictif conserve" || snapshot.state.asking !== "545000" || snapshot.importGallery[0].label === "Visuel modifie plus tard") throw Error("Source changes mutated snapshot");
    Object.assign(snapshot.state, { acq: "400000", works: "50000", resale: "650000", weekly: "0", rentalCosts: "0", annualRentalCosts: "0", seasonalCostsReviewed: true, annualCostsReviewed: true, costsReviewed: true });
    const blob = await engine.generatePresentation(snapshot);
    const zip = await engine.JSZip.loadAsync(await blob.arrayBuffer());
    const slide = await zip.file("ppt/slides/slide1.xml").async("string");
    const noteXml = await zip.file("ppt/notesSlides/notesSlide1.xml").async("string");
    const noteText = new DOMParser().parseFromString(noteXml, "application/xml").documentElement.textContent;
    if (!slide.includes("Instantane fictif conserve") || slide.includes("Titre modifie plus tard") || !noteText.includes("DESCRIPTION_COMPLETE_FICTIVE_".repeat(100)) || !noteText.includes("camille@example.test")) throw Error("Export lost original snapshot or full rich content");
    const other = engine.createFonciereData(); other.name = "Autre projet fictif";
    const second = engine.toPresentationData(other, { id: "22222222-2222-4222-8222-222222222222", revision: 1 });
    if (second.importGallery.length || second.state.asking || second.state.area || second.state.features || second.state.program) throw Error("Projects mixed data/photos");
    return { snapshotIndependent: true, fullDescriptionInNotes: true, correctAgentInNotes: true, otherProjectEmpty: true, bytes: blob.size, slides: Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length };
  });
  result.checks.push({ filename: "snapshot-and-real-pptx-export", status: "passed", durationMs: 0, actual: snapshotExport });
  console.log("PASS snapshot independence and real PPTX export");
  await context.route("**/fra.traineddata.gz", route => route.fulfill({ status: 404, body: "Unavailable fictional OCR runtime test" }));
  const failedOcr = await page.evaluate(async () => {
    const file = new File([await (await fetch("/fixtures/fiche-ocr-fictive.png")).blob()], "fiche-ocr-fictive.png", { type: "image/png" });
    const [report] = await engine.analyzeAgencyFiles([file]);
    if (!report.sourceFile || !report.gallery.length || !report.readerWarnings.some(warning => warning.includes("OCR partiel ou indisponible"))) throw Error("OCR failure lost original/manual completion path");
    return { originalRetained: true, visualRetained: true, partialWarning: true };
  });
  result.checks.push({ filename: "ocr-local-asset-failure", status: "passed", durationMs: 0, actual: failedOcr });
  console.log("PASS unavailable OCR assets preserve original/visual and manual completion");
  assert.equal(result.remoteRequests.length, 0); assert.equal(result.pageErrors.length, 0); result.status = "passed";
} catch (error) { result.status = "failed"; result.error = error.stack; process.exitCode = 1; }
finally { await browser?.close(); await new Promise(done => server.close(done)); writeFileSync(join(artifacts, "results.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ status: result.status, checks: result.checks.map(check => ({ filename: check.filename, status: check.status, durationMs: check.durationMs })), artifact: join(artifacts, "results.json"), error: result.error })); }
