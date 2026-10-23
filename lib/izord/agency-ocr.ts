/** Browser-only, self-hosted PDF rendering and FR/EN OCR. Documents stay on this device. */
import { checkAbort, resizeImported } from "./photos";
import { imageFileKind, imageHeaderDimensions } from "./photos-validation";
import type { GalleryPhoto } from "./model";
import type { PdfPage } from "./agency";
import type { Worker as OcrWorker } from "tesseract.js";

export const OCR_PAGE_LIMIT = 12;
type ReadOptions = { signal?: AbortSignal; onProgress?: (page: number, total: number) => void };
type OcrReadResult = { pages: PdfPage[]; gallery: GalleryPhoto[]; warnings: string[]; ocrPages: number[] };
const errorText = (error: unknown) => error instanceof Error ? error.message : "lecture locale indisponible";
const rootPath = () => new URL("/agency-runtime/", window.location.origin).href;

async function ocrSession(signal?: AbortSignal) {
  checkAbort(signal);
  // Fail before spawning a WebWorker if a deployment omitted/cannot serve a
  // required local asset. No OCR document data is included in these requests.
  await Promise.all(["worker.min.js", "fra.traineddata.gz", "eng.traineddata.gz", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map(async filename => {
    const response = await fetch(`${rootPath()}ocr/${filename}`, { method: "HEAD", signal, cache: "force-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error("Un fichier du moteur OCR local est indisponible. Réessayez ou complétez manuellement.");
  }));
  checkAbort(signal);
  const { createWorker } = await import("tesseract.js");
  checkAbort(signal);
  let worker: OcrWorker | undefined;
  let ended = false;
  const stop = () => { ended = true; if (worker) void worker.terminate(); };
  signal?.addEventListener("abort", stop, { once: true });
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelStartup: (() => void) | undefined;
  let startupFailure: (error: Error) => void = () => {};
  const startupError = new Promise<never>((_, reject) => { startupFailure = reject; });
  try {
    const starting = createWorker(["fra", "eng"], 1, {
      workerPath: `${rootPath()}ocr/worker.min.js`,
      corePath: `${rootPath()}ocr`,
      langPath: `${rootPath()}ocr`,
      workerBlobURL: false,
      cacheMethod: "none",
      legacyCore: false,
      legacyLang: false,
      // Tesseract otherwise throws worker failures on the main thread. Surface
      // them as a reviewable partial import, including language-load failures.
      errorHandler: error => startupFailure(new Error(String(error))),
    });
    void starting.then(value => { if (ended) void value.terminate(); }, () => {});
    worker = await Promise.race([starting, startupError,
      new Promise<never>((_, reject) => { startupTimer = setTimeout(() => { stop(); reject(new Error("Chargement du moteur OCR interrompu après 45 secondes.")); }, 45_000); }),
      new Promise<never>((_, reject) => { cancelStartup = () => reject(new DOMException("OCR annulé.", "AbortError")); signal?.addEventListener("abort", cancelStartup, { once: true }); }),
    ]);
    clearTimeout(startupTimer); if (cancelStartup) signal?.removeEventListener("abort", cancelStartup);
    if (ended) { await worker.terminate(); checkAbort(signal); throw new Error("OCR interrompu."); }
    return {
      async recognize(image: HTMLCanvasElement) {
        checkAbort(signal);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        try {
          const result = await Promise.race([
            worker!.recognize(image),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => { stop(); reject(new Error("OCR interrompu après 90 secondes sur cette page.")); }, 90_000); }),
            new Promise<never>((_, reject) => { cancel = () => reject(new DOMException("OCR annulé.", "AbortError")); signal?.addEventListener("abort", cancel, { once: true }); }),
          ]);
          checkAbort(signal);
          return { text: result.data.text, confidence: result.data.confidence };
        } finally { clearTimeout(timeout); if (cancel) signal?.removeEventListener("abort", cancel); }
      },
      async terminate() { signal?.removeEventListener("abort", stop); if (!ended) { ended = true; await worker!.terminate(); } },
    };
  } catch (error) { clearTimeout(startupTimer); if (cancelStartup) signal?.removeEventListener("abort", cancelStartup); signal?.removeEventListener("abort", stop); if (worker && !ended) await worker.terminate(); ended = true; checkAbort(signal); throw error; }
}

async function imageCanvas(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  const kind = imageFileKind(bytes); imageHeaderDimensions(bytes);
  if (file.type && kind !== file.type) throw new Error("Le contenu de l’image ne correspond pas au type annoncé.");
  const url = URL.createObjectURL(new Blob([bytes], { type: kind }));
  try {
    const image = new Image(); image.src = url; await image.decode(); checkAbort(signal);
    const scale = Math.min(1, 2800 / Math.max(image.width, image.height), Math.sqrt(5_000_000 / (image.width * image.height)));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Lecture image indisponible.");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.src = "";
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

export async function readAgencyImage(file: File, options: ReadOptions = {}): Promise<OcrReadResult> {
  const canvas = await imageCanvas(file, options.signal);
  const warnings = ["Lecture OCR locale FR/EN : les caractères, coordonnées et montants doivent être relus.", "Le visuel importé est la fiche complète ; les photos ne sont pas isolées automatiquement dans une image."];
  let session: Awaited<ReturnType<typeof ocrSession>> | undefined;
  let text = "";
  try {
    session = await ocrSession(options.signal); options.onProgress?.(1, 1);
    const result = await session.recognize(canvas); text = result.text;
    if (result.confidence < 75) warnings.push(`OCR incertain (confiance moyenne ${Math.round(result.confidence)} %) : vérifier tous les champs.`);
  } catch (error) { checkAbort(options.signal); warnings.push(`OCR partiel ou indisponible : ${errorText(error)}. L’original reste conservé ; compléter manuellement.`); }
  finally { await session?.terminate(); }
  const data = await resizeImported(canvas.toDataURL("image/jpeg", .9), options.signal);
  const gallery = [{ data, width: canvas.width, height: canvas.height, page: 1, label: "Fiche complète · OCR", source: "Fiche image originale" }];
  canvas.width = canvas.height = 0;
  return { pages: [{ page: 1, text }], gallery, warnings, ocrPages: [1] };
}

export async function readAgencyPdfFallback(bytes: ArrayBuffer, knownPages: PdfPage[], options: ReadOptions = {}): Promise<OcrReadResult> {
  checkAbort(options.signal);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${rootPath()}pdf/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: `${rootPath()}pdf/cmaps/`, cMapPacked: true, standardFontDataUrl: `${rootPath()}pdf/standard_fonts/`, wasmUrl: `${rootPath()}pdf/wasm/`, useSystemFonts: true, enableXfa: false });
  task.onPassword = () => { void task.destroy(); };
  const abort = () => { void task.destroy(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const result: OcrReadResult = { pages: [...knownPages], gallery: [], warnings: [], ocrPages: [] };
  let session: Awaited<ReturnType<typeof ocrSession>> | undefined;
  try {
    const document = await task.promise; checkAbort(options.signal);
    if (document.numPages > 120) throw new Error("Maximum 120 pages par fiche.");
    for (let number = 1; number <= document.numPages; number++) {
      checkAbort(options.signal); options.onProgress?.(number, document.numPages);
      const page = await document.getPage(number), content = await page.getTextContent();
      const direct = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
      const prior = knownPages.find(item => item.page === number)?.text || "";
      let text = direct.replace(/\s/g, "").length > prior.replace(/\s/g, "").length ? direct : prior;
      const unreadable = text.replace(/\s/g, "").length < 40 || (text.match(/�/g)?.length || 0) > text.length / 4;
      if (!unreadable && result.gallery.length < 80) {
        // Decode embedded raster photos, including PNG/Flate and JPEG2000, locally.
        // PDF.js exposes their decoded image objects through the page operator list.
        try {
          const operators = await page.getOperatorList();
          const seen = new Set<string>();
          for (let index=0; index<operators.fnArray.length && result.gallery.length<80; index++) {
            if (operators.fnArray[index]!==pdfjs.OPS.paintImageXObject) continue;
            const id=String(operators.argsArray[index][0]); if (seen.has(id)) continue; seen.add(id);
            const image=await new Promise<{width:number;height:number;bitmap?:ImageBitmap;data?:Uint8ClampedArray;kind?:number}|null>(resolve=>{
              const timeout=setTimeout(()=>resolve(null),2_000);
              page.objs.get(id,(value:unknown)=>{clearTimeout(timeout);resolve(value as {width:number;height:number;bitmap?:ImageBitmap;data?:Uint8ClampedArray;kind?:number});});
            });
            if (!image || image.width<180 || image.height<120 || image.width*image.height>20_000_000) continue;
            const canvas=window.document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
            try {
              const context=canvas.getContext("2d");if(!context)continue;
              if(image.bitmap)context.drawImage(image.bitmap,0,0);
              else if(image.data && image.kind===3)context.putImageData(new ImageData(Uint8ClampedArray.from(image.data),image.width,image.height),0,0);
              else if(image.data && image.kind===2){const rgba=new Uint8ClampedArray(image.width*image.height*4);for(let at=0,pixel=0;at<image.data.length;at+=3,pixel+=4){rgba[pixel]=image.data[at];rgba[pixel+1]=image.data[at+1];rgba[pixel+2]=image.data[at+2];rgba[pixel+3]=255;}context.putImageData(new ImageData(rgba,image.width,image.height),0,0);}
              else continue;
              result.gallery.push({data:await resizeImported(canvas.toDataURL("image/jpeg",.9),options.signal),width:image.width,height:image.height,page:number,label:`Photo ${result.gallery.length+1} · p. ${number}`,source:"PDF"});
            } finally {canvas.width=canvas.height=0;}
          }
        } catch (error) {checkAbort(options.signal);result.warnings.push(`Page ${number} : certains visuels nécessitent un ajout manuel (${errorText(error)}).`);}
      }
      if (unreadable) {
        if (result.ocrPages.length >= OCR_PAGE_LIMIT) {
          result.warnings.push(`OCR limité aux ${OCR_PAGE_LIMIT} premières pages scannées par fiche ; les autres pages sont à compléter manuellement.`);
        } else {
          let canvas: HTMLCanvasElement | undefined;
          try {
            const normal = page.getViewport({ scale: 1 });
            const scale = Math.min(2.5, 2800 / Math.max(normal.width, normal.height), Math.sqrt(5_000_000 / (normal.width * normal.height)));
            const viewport = page.getViewport({ scale }); canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Rendu du PDF indisponible.");
            const rendering = page.render({ canvas, canvasContext: ctx, viewport });
            const cancel = () => rendering.cancel(); options.signal?.addEventListener("abort", cancel, { once: true });
            try { await rendering.promise; } finally { options.signal?.removeEventListener("abort", cancel); }
            checkAbort(options.signal);
            result.ocrPages.push(number);
            // A scan stays identifiable as a page, never as an inferred property photograph.
            if (result.gallery.length < OCR_PAGE_LIMIT) result.gallery.push({ data: await resizeImported(canvas.toDataURL("image/jpeg", .9), options.signal), width: canvas.width, height: canvas.height, page: number, label: `Page scannée ${number}`, source: "Page complète du PDF" });
            session ??= await ocrSession(options.signal);
            const ocr = await session.recognize(canvas);
            if (ocr.text.replace(/\s/g, "").length > text.replace(/\s/g, "").length) text = ocr.text;
            if (ocr.confidence < 75) result.warnings.push(`Page ${number} : OCR incertain (confiance moyenne ${Math.round(ocr.confidence)} %).`);
          } catch (error) { checkAbort(options.signal); result.warnings.push(`Page ${number} : OCR partiel ou indisponible (${errorText(error)}). Compléter manuellement.`); }
          finally { if (canvas) canvas.width = canvas.height = 0; }
        }
      }
      const index = result.pages.findIndex(item => item.page === number);
      if (index >= 0) result.pages[index] = { page: number, text }; else result.pages.push({ page: number, text });
      page.cleanup();
    }
    if (result.ocrPages.length) result.warnings.unshift("Lecture OCR locale FR/EN : relire les caractères, coordonnées et montants. Les visuels des pages scannées sont conservés en pages complètes.");
    return result;
  } finally { options.signal?.removeEventListener("abort", abort); await session?.terminate(); await task.destroy(); }
}
