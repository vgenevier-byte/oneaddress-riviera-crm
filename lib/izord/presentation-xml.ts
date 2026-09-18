/** Native Open XML helpers copied/adapted from the source generator (no flattened slide images). */
import type JSZip from "jszip";
export const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
export const VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
export const EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
export function parseXml(text: string): XMLDocument {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("XML PowerPoint invalide.");
  return document;
}
export const xmlText = (document: XMLDocument) => new XMLSerializer().serializeToString(document);
export async function part(zip: JSZip, path: string) {
  const entry = zip.file(path);
  if (!entry) throw new Error("Élément du modèle PowerPoint manquant : " + path);
  return entry.async("string");
}
export function shapeById(document: XMLDocument, id: string | number) {
  for (const shape of [...document.getElementsByTagNameNS(P, "sp"), ...document.getElementsByTagNameNS(P, "pic")]) {
    if (shape.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id") === String(id)) return shape;
  }
  return null;
}
export function setShapeText(document: XMLDocument, id: string | number, text: unknown, size?: number) {
  const shape = shapeById(document, id), body = shape?.getElementsByTagNameNS(P, "txBody")[0];
  if (!body) return;
  const oldP = body.getElementsByTagNameNS(A, "p")[0];
  const oldPr = oldP?.getElementsByTagNameNS(A, "pPr")[0];
  const oldRun = body.getElementsByTagNameNS(A, "rPr")[0];
  const oldEnd = oldP?.getElementsByTagNameNS(A, "endParaRPr")[0];
  for (const child of [...body.children]) if (child.localName === "p") body.removeChild(child);
  for (const line of String(text).split("\n")) {
    const paragraph = document.createElementNS(A, "a:p");
    if (oldPr) paragraph.appendChild(oldPr.cloneNode(true));
    const run = document.createElementNS(A, "a:r");
    const properties = oldRun ? oldRun.cloneNode(true) as Element : document.createElementNS(A, "a:rPr");
    if (size) properties.setAttribute("sz", String(Math.round(size * 100)));
    run.appendChild(properties);
    const value = document.createElementNS(A, "a:t"); value.textContent = line;
    run.appendChild(value); paragraph.appendChild(run);
    if (oldEnd) paragraph.appendChild(oldEnd.cloneNode(true));
    body.appendChild(paragraph);
  }
}
export function replaceNote(document: XMLDocument, text: string) {
  const shape = [...document.getElementsByTagNameNS(P, "sp")]
    .find(shape => [...shape.getElementsByTagNameNS(P, "ph")].some(node => node.getAttribute("type") === "body"));
  const id = shape?.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("id");
  if (id) setShapeText(document, id, text, 12);
}
export function normalizePath(path: string) {
  const values: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") values.pop(); else if (segment && segment !== ".") values.push(segment);
  }
  return values.join("/");
}
export const emu = (value: number) => String(Math.round(value * 12700));
export const xesc = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] ?? character));
export const xmlElement = (document: XMLDocument, xml: string) => document.importNode(parseXml(xml).documentElement, true);
export function packageRelationship(document: XMLDocument, id: string, type: string, target: string) {
  const element = document.createElementNS(PKG, "Relationship");
  element.setAttribute("Id", id); element.setAttribute("Type", R + "/" + type); element.setAttribute("Target", target);
  document.documentElement.appendChild(element); return element;
}
