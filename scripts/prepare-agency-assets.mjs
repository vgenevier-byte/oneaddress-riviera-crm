/** Build-time self hosting. No document or OCR request is sent to a CDN/provider. */
import { cpSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, "public/agency-runtime");
const from = (path) => join(root, "node_modules", path);
mkdirSync(join(runtime, "ocr"), { recursive: true });
mkdirSync(join(runtime, "pdf"), { recursive: true });
copyFileSync(from("tesseract.js/dist/worker.min.js"), join(runtime, "ocr/worker.min.js"));
// LSTM-only mode is explicit in agency-ocr.ts. Ship all three CPU variants.
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
  const filename = `tesseract-core-${variant}.wasm.js`;
  copyFileSync(from(`tesseract.js-core/${filename}`), join(runtime, "ocr", filename));
}
for (const language of ["fra", "eng"]) {
  copyFileSync(from(`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`), join(runtime, "ocr", `${language}.traineddata.gz`));
}
copyFileSync(from("pdfjs-dist/build/pdf.worker.min.mjs"), join(runtime, "pdf/pdf.worker.min.mjs"));
for (const directory of ["cmaps", "standard_fonts", "wasm"]) cpSync(from(`pdfjs-dist/${directory}`), join(runtime, "pdf", directory), { recursive: true });
for (const [source, target] of [["tesseract.js/LICENSE.md", "TESSERACT_JS_LICENSE"], ["tesseract.js-core/LICENSE", "TESSERACT_CORE_LICENSE"], ["pdfjs-dist/LICENSE", "PDFJS_LICENSE"]]) {
  copyFileSync(from(source), join(runtime, target));
}
console.log("Agency PDF/OCR runtime prepared locally (FR/EN, no remote provider).");
