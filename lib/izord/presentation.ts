/** Native makePpt port from the audited HTML; browser DOM/canvas, no OAR client.
 * Every call starts from the sanitized template and a validated project copy.
 */
import JSZip from "jszip";
import { validateProjectData, type ProjectData, type PhotoRole } from "./model";
import { calculate, errorsFor, rentalExportIssues } from "./finance";
import { presentationSlides, presentationTemplate } from "./presentation-assets";
import { presentationMaps } from "./presentation-maps";
import { renderedFont } from "./presentation-layout";
import { notesText } from "./presentation-notes";
import { appendPhotoSlide, updatePresentationMetadata } from "./presentation-gallery";
import { P, A, R, PKG, parseXml, xmlText, part, setShapeText, shapeById, normalizePath, replaceNote } from "./presentation-xml";

export { presentationSlides, presentationDimensions, blankPhotos, presentationSourceSHA256 } from "./presentation-assets";
export type { SlideSpec, SlideTextSpec } from "./presentation-assets";
export { presentationMaps } from "./presentation-maps";
export { renderedFont, photoLayout, photoCaption, galleryHeaderTexts } from "./presentation-layout";
export { photoSlideEnabled, preparedPhotos } from "./presentation-gallery";
export { notesText } from "./presentation-notes";

export async function generatePresentation(input: ProjectData, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  const data = validateProjectData(input), state = data.state;
  const result = calculate(state), errors = [...errorsFor(state), ...rentalExportIssues(result)];
  if (errors.length) throw new Error(errors[0]);
  const zip = await JSZip.loadAsync(presentationTemplate, { base64: true, checkCRC32: true });
  const maps = presentationMaps(state, result);
  for (let index = 0; index < 2; index++) {
    options.signal?.throwIfAborted();
    const path = `ppt/slides/slide${index + 1}.xml`, document = parseXml(await part(zip, path));
    for (const [id, text] of Object.entries(maps[index])) {
      const spec = presentationSlides[index].find(shape => String(shape.id) === id);
      setShapeText(document, id, text, spec?.kind === "text" ? renderedFont(spec, text) : undefined);
    }
    const relationships = parseXml(await part(zip, `ppt/slides/_rels/slide${index + 1}.xml.rels`));
    const mappings: Record<string, PhotoRole> = index === 0 ? { 2: "main", 3: "view", 4: "inside" } : { 2: "operation" };
    for (const [id, role] of Object.entries(mappings)) {
      const shape = shapeById(document, id), image = shape?.getElementsByTagNameNS(A, "blip")[0];
      const rid = image?.getAttributeNS(R, "embed");
      const relationship = [...relationships.getElementsByTagNameNS(PKG, "Relationship")].find(element => element.getAttribute("Id") === rid);
      if (!shape || !relationship) throw new Error("Photographie du modèle introuvable.");
      const target = normalizePath("ppt/slides/" + relationship.getAttribute("Target"));
      if (!/^ppt\/media\/image[1-4]\.jpg$/.test(target)) throw new Error("Référence photographique native invalide.");
      zip.file(target, data.photos[role].split(",")[1], { base64: true });
      for (const crop of [...shape.getElementsByTagNameNS(A, "srcRect")]) crop.remove();
    }
    zip.file(path, xmlText(document));
    const notePath = `ppt/notesSlides/notesSlide${index + 1}.xml`;
    if (zip.file(notePath)) {
      const note = parseXml(await part(zip, notePath));
      const text = index === 0 ? "FICHE DU BIEN\n" + state.project + "\n" + state.address + "\nSources : " + state.source
        + "\n" + state.measurement + "\nPoints à confirmer : " + state.propertyWarnings
        + "\nLes informations et les photos sont celles saisies par le rédacteur ; leur exactitude doit être vérifiée.\n\n"
        + notesText(state, result, data.importMeta) : notesText(state, result, data.importMeta);
      replaceNote(note, text); zip.file(notePath, xmlText(note));
    }
  }
  if (zip.file("docProps/core.xml")) {
    const core = parseXml(await part(zip, "docProps/core.xml"));
    const title = core.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0];
    if (title) title.textContent = "IZORD Invest — " + (state.project || "Fiche projet") + " — Simulation";
    zip.file("docProps/core.xml", xmlText(core));
  }
  await appendPhotoSlide(zip, data, options.signal);
  await updatePresentationMetadata(zip);
  options.signal?.throwIfAborted();
  // The dimensions are original; updatePresentationMetadata only fixes the
  // legacy screen4x3 label to screen16x9, exactly as the original generator does.
  const presentation = parseXml(await part(zip, "ppt/presentation.xml"));
  const size = presentation.getElementsByTagNameNS(P, "sldSz")[0];
  if (size.getAttribute("cx") !== "12192000" || size.getAttribute("cy") !== "6858000") throw new Error("Dimensions du modèle natif modifiées.");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 },
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }, () => options.signal?.throwIfAborted());
}
