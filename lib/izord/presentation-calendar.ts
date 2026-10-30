import { presentationRentalPlan } from "./rental-model";
import type JSZip from "jszip";
import type { ImportMeta, ProjectData } from "./model";
import { createFonciereData } from "../fonciere/model";
import { validateGuidedProperty, type GuidedLocale } from "../fonciere/guided";
import { calculateProjectCalendar, projectCalendarRows, projectCalendarText, PROJECT_CALENDAR_RULES, PROJECT_CALENDAR_CHRONOLOGY_WARNING } from "../fonciere/calendar";
import { P, A, R, PKG, CT, parseXml, xmlText, part, replaceNote, emu, xesc, xmlElement, packageRelationship } from "./presentation-xml";

/** Read only the captured business assumptions. Existing presentations without
 * calendar fields keep their original slide count and contents. */
export function presentationCalendar(meta: ImportMeta | null | undefined, locale: GuidedLocale = "fr") {
  const snapshot = meta?.fonciereSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !snapshot.guided) return null;
  const guided = validateGuidedProperty(snapshot.guided), values = guided.values;
  const works = values.worksHypothesis, sale = values.resaleHypothesis, rent = values.rentalHypothesis;
  const hasField = (value: unknown, keys: string[]) => !!value && typeof value === "object" && keys.some(key => Object.hasOwn(value, key));
  if (!Object.hasOwn(values, "personalStrategy") && !hasField(works, ["startDate", "durationMonths"]) && !hasField(sale, ["receiptDelayMonths"]) && !hasField(rent, ["receiptDelayMonths"])) return null;
  const data = createFonciereData(); data.guided = guided; data.rentalPlan = presentationRentalPlan(meta,true);
  const warning = calculateProjectCalendar(data).inconsistentChronology ? PROJECT_CALENDAR_CHRONOLOGY_WARNING[locale] : "";
  return { title: locale === "fr" ? "Calendrier prévisionnel du projet" : "Estimated project schedule", rows: projectCalendarRows(data, locale), text: projectCalendarText(data, locale), rule: [warning, PROJECT_CALENDAR_RULES[locale]].filter(Boolean).join("\n") };
}

export type Calendar = { title: string; rows: { key?: string; label: string; value: string }[]; text: string; rule: string; layout?: "rentals" };
export type CalendarTextBox = { id: number; x: number; y: number; w: number; h: number; size: number; bold?: boolean; color: string; text: string };
/** Shared geometry keeps the browser preview and the editable PPT slide aligned. */
export function calendarTextBoxes(calendar: Calendar): CalendarTextBox[] {
  const boxes: CalendarTextBox[] = [{ id: 2, x: 44, y: 28, w: 872, h: 42, size: 27, bold: true, color: "153C43", text: calendar.title }];
  const rowHeight = Math.min(calendar.layout === "rentals" ? 100 : 38, 354 / Math.max(1, calendar.rows.length));
  calendar.rows.forEach((row, index) => {
    boxes.push({ id: 10 + index * 2, x: 44, y: 88 + index * rowHeight, w: calendar.layout === "rentals" ? 200 : 350, h: rowHeight - 3, size: 12, bold: true, color: "36585D", text: row.label });
    boxes.push({ id: 11 + index * 2, x: calendar.layout === "rentals" ? 260 : 410, y: 88 + index * rowHeight, w: calendar.layout === "rentals" ? 656 : 506, h: rowHeight - 3, size: 12, color: "17363B", text: row.value });
  });
  boxes.push({ id: 100, x: 44, y: 454, w: 872, h: 66, size: 10, color: "50696D", text: calendar.rule });
  return boxes;
}

function textBox(document: XMLDocument, box: CalendarTextBox) {
  const lines = box.text.split("\n").map(text => `<a:p><a:pPr/><a:r><a:rPr lang="fr-FR" sz="${box.size * 100}"${box.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${box.color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xesc(text)}</a:t></a:r></a:p>`).join("");
  return xmlElement(document, `<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:nvSpPr><p:cNvPr id="${box.id}" name="Calendar ${box.id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${lines}</p:txBody></p:sp>`);
}

export async function appendCalendarSlide(zip: JSZip, data: ProjectData, report?: Calendar) {
  const calendar = report || presentationCalendar(data.importMeta);
  if (!calendar) return false;
  const pres = parseXml(await part(zip, "ppt/presentation.xml")), list = pres.getElementsByTagNameNS(P, "sldIdLst")[0];
  const index = list.children.length + 1, doc = parseXml(await part(zip, "ppt/slides/slide2.xml"));
  const tree = doc.getElementsByTagNameNS(P, "spTree")[0];
  for (const child of [...tree.children]) if (!["nvGrpSpPr", "grpSpPr"].includes(child.localName)) child.remove();
  for (const child of [...doc.documentElement.children]) if (["timing", "transition", "extLst"].includes(child.localName)) child.remove();
  for (const box of calendarTextBoxes(calendar)) tree.appendChild(textBox(doc, box));
  zip.file(`ppt/slides/slide${index}.xml`, xmlText(doc));
  const rels = parseXml(`<Relationships xmlns="${PKG}"/>`), oldRels = parseXml(await part(zip, "ppt/slides/_rels/slide2.xml.rels"));
  const layout = [...oldRels.documentElement.children].find(row => row.getAttribute("Type")?.endsWith("/slideLayout"));
  if (!layout) throw new Error("Disposition du calendrier introuvable.");
  packageRelationship(rels, "rId1", "slideLayout", layout.getAttribute("Target")!);
  packageRelationship(rels, "rId2", "notesSlide", `../notesSlides/notesSlide${index}.xml`);
  zip.file(`ppt/slides/_rels/slide${index}.xml.rels`, xmlText(rels));
  const notes = parseXml(await part(zip, "ppt/notesSlides/notesSlide2.xml"));
  replaceNote(notes, calendar.text); zip.file(`ppt/notesSlides/notesSlide${index}.xml`, xmlText(notes));
  const notesRels = parseXml(await part(zip, "ppt/notesSlides/_rels/notesSlide2.xml.rels"));
  for (const child of [...notesRels.documentElement.children]) if (child.getAttribute("Type")?.endsWith("/slide")) child.setAttribute("Target", `../slides/slide${index}.xml`);
  zip.file(`ppt/notesSlides/_rels/notesSlide${index}.xml.rels`, xmlText(notesRels));
  const pr = parseXml(await part(zip, "ppt/_rels/presentation.xml.rels"));
  const rid = "rId" + (Math.max(...[...pr.documentElement.children].map(row => Number(row.getAttribute("Id")?.replace(/^rId/, "")) || 0)) + 1);
  packageRelationship(pr, rid, "slide", `slides/slide${index}.xml`); zip.file("ppt/_rels/presentation.xml.rels", xmlText(pr));
  const id = pres.createElementNS(P, "p:sldId"); id.setAttribute("id", String(Math.max(...[...list.children].map(row => Number(row.getAttribute("id")))) + 1)); id.setAttributeNS(R, "r:id", rid); list.appendChild(id);
  zip.file("ppt/presentation.xml", xmlText(pres));
  const content = parseXml(await part(zip, "[Content_Types].xml"));
  for (const [name, type] of [[`/ppt/slides/slide${index}.xml`, "slide"], [`/ppt/notesSlides/notesSlide${index}.xml`, "notesSlide"]]) {
    const over = content.createElementNS(CT, "Override"); over.setAttribute("PartName", name); over.setAttribute("ContentType", `application/vnd.openxmlformats-officedocument.presentationml.${type}+xml`); content.documentElement.appendChild(over);
  }
  zip.file("[Content_Types].xml", xmlText(content));
  return true;
}
