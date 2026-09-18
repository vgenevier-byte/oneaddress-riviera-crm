/** Native IZORD_FICHE_V1 model. Imported data never carries application roles or approval. */
import { BASE, finite, number } from "./finance";
import { imageHeaderDimensions } from "./photos-validation";
import { assertImageByteBudget, assertEncodedImageBudget, jpegDataByteLength, TOTAL_IMAGE_BYTES } from "./image-budget";
import { blankPhotos } from "./presentation-assets";

export type PhotoRole = "main" | "view" | "inside" | "operation";
export const PHOTO_ROLES: PhotoRole[] = ["main", "view", "inside", "operation"];
export type ProjectState = typeof BASE & { [field: string]: string | boolean };
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ImportMeta = { [key: string]: JsonValue };
export type GalleryPhoto = { data: string; label: string; page: number | null; width: number | null; height: number | null; source?: string };
export type ProjectData = { state: ProjectState; photos: Record<PhotoRole, string>; importMeta: ImportMeta | null; importGallery: GalleryPhoto[]; photoGalleryRoles: Partial<Record<PhotoRole, number>> };
export const LIMITS = { jsonBytes: 180_000_000, fileBytes: 25_000_000, totalImageBytes: TOTAL_IMAGE_BYTES, pdfFiles: 6, galleryPhotos: 480, imagePixels: 40_000_000, imageDimension: 16_000, metadataBytes: 1_000_000 } as const;
const jpegPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function assertProjectImageBudget(input: { photos: Record<string, unknown>; importGallery?: unknown }): number {
  const entries: { id: string; bytes: number }[] = [];
  const encodedLengths: number[] = [];
  for (const role of PHOTO_ROLES) {
    const value = input.photos[role];
    if (value === undefined) { encodedLengths.push(blankPhotos[role].length); continue; }
    if (typeof value !== "string") throw new Error("Photographie JSON invalide.");
    encodedLengths.push(value.length);
    if (value === blankPhotos[role]) continue;
    entries.push({ id: value, bytes: jpegDataByteLength(value) });
  }
  if (input.importGallery !== undefined) {
    if (!Array.isArray(input.importGallery) || input.importGallery.length > LIMITS.galleryPhotos) throw new Error("Photothèque JSON invalide ou trop volumineuse.");
    for (const photo of input.importGallery) {
      if (!record(photo) || typeof photo.data !== "string") throw new Error("Photographie JSON invalide.");
      encodedLengths.push(photo.data.length);
      entries.push({ id: photo.data, bytes: jpegDataByteLength(photo.data) });
    }
  }
  assertEncodedImageBudget(encodedLengths);
  return assertImageByteBudget(entries);
}
export function createProjectData(): ProjectData { return { state: { ...BASE }, photos: { ...blankPhotos }, importMeta: null, importGallery: [], photoGalleryRoles: {} }; }
export function validateJpegData(value: unknown): string {
  if (typeof value !== "string" || !jpegPattern.test(value) || value.length > Math.ceil(LIMITS.fileBytes * 4 / 3) + 30) throw new Error("Photographie JSON invalide : JPEG incorporé de 25 Mo maximum attendu.");
  const body = value.slice(value.indexOf(",") + 1);
  if (body.length % 4 !== 0 || !body.startsWith("/9j/")) throw new Error("Signature JPEG JSON invalide.");
  imageHeaderDimensions(Uint8Array.from(atob(body), char => char.charCodeAt(0)));
  return value;
}
function safeMetadata(value: unknown, depth = 0, budget = { count: 0 }): JsonValue {
  if (++budget.count > 20_000 || depth > 12) throw new Error("Métadonnées JSON trop complexes.");
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") { if (value.length > 100_000) throw new Error("Texte de métadonnées trop volumineux."); return value; }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(entry => safeMetadata(entry, depth + 1, budget));
  if (record(value)) { const result: { [key: string]: JsonValue } = {}; for (const [key, entry] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Référence de métadonnées interdite."); result[key] = safeMetadata(entry, depth + 1, budget); } return result; }
  throw new Error("Type de métadonnée JSON invalide.");
}
export function validateProjectData(input: unknown): ProjectData {
  if (!record(input) || !record(input.state) || !record(input.photos)) throw new Error("Ce fichier n’est pas un projet IZORD compatible.");
  // Before per-image atob/decode or cloning, bound the entire untrusted gallery.
  assertProjectImageBudget({ photos: input.photos, importGallery: input.importGallery });
  const result = createProjectData();
  for (const key of Object.keys(input.state)) if (!Object.prototype.hasOwnProperty.call(BASE, key)) throw new Error(`Champ IZORD non pris en charge : ${key}. Aucune donnée n’a été importée.`);
  for (const key of Object.keys(BASE)) {
    const value = input.state[key];
    if (value === undefined) continue;
    if (["includePhotoSlide", "costsReviewed", "annualCostsReviewed", "seasonalCostsReviewed"].includes(key)) {
      if (typeof value !== "boolean") throw new Error(`Valeur booléenne attendue : ${key}.`);
      result.state[key] = value;
    } else {
      if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error(`Valeur textuelle attendue : ${key}.`);
      if (String(value).length > 1000) throw new Error(`Champ trop long : ${key} (1 000 caractères maximum).`);
      result.state[key] = String(value);
    }
  }
  // Original compatibility rule: old projects had no common rentalPeriod.
  if (input.state.rentalPeriod === undefined) { const h = number(result.state.holding), w = number(result.state.weeks); result.state.rentalPeriod = String(Math.max(12, finite(h) ? h : 12, finite(w) ? Math.ceil(w * 12 / 52) : 12)); }
  for (const role of PHOTO_ROLES) if (input.photos[role] !== undefined) result.photos[role] = validateJpegData(input.photos[role]);
  if (input.importMeta !== undefined && input.importMeta !== null) {
    if (!record(input.importMeta) || JSON.stringify(input.importMeta).length > LIMITS.metadataBytes) throw new Error("Métadonnées d’import invalides ou trop volumineuses.");
    result.importMeta = safeMetadata(input.importMeta) as ImportMeta;
  }
  if (input.importGallery !== undefined) {
    if (!Array.isArray(input.importGallery) || input.importGallery.length > LIMITS.galleryPhotos) throw new Error("Photothèque JSON invalide ou trop volumineuse.");
    result.importGallery = input.importGallery.map((entry, index) => {
      if (!record(entry)) throw new Error(`Photographie ${index + 1} invalide.`);
      const positive = (key: string) => { const n = entry[key]; if (n === undefined || n === null || n === "") return null; if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100_000) throw new Error(`Dimension/page de photo invalide : ${key}.`); return n; };
      const label = entry.label === undefined ? "Photo" : entry.label;
      if (typeof label !== "string" || label.length > 100) throw new Error("Légende de photographie invalide.");
      if (entry.source !== undefined && (typeof entry.source !== "string" || entry.source.length > 80)) throw new Error("Source de photographie invalide.");
      return { data: validateJpegData(entry.data), label, page: positive("page"), width: positive("width"), height: positive("height"), source: typeof entry.source === "string" ? entry.source : "" };
    });
  }
  const roles = input.photoGalleryRoles ?? result.importMeta?.roles ?? {};
  if (!record(roles)) throw new Error("Affectations photographiques invalides.");
  for (const role of PHOTO_ROLES) { const index = roles[role]; if (index === undefined || index === -1) continue; if (!Number.isInteger(index) || (index as number) < 0 || !result.importGallery[index as number]) throw new Error(`Référence photographique invalide : ${role}.`); result.photoGalleryRoles[role] = index as number; }
  return result;
}
export function importProjectJson(text: string): ProjectData {
  if (new TextEncoder().encode(text).byteLength > LIMITS.jsonBytes) throw new Error("Fichier projet trop volumineux (180 Mo maximum).");
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.format !== "IZORD_FICHE_V1") throw new Error("Ce fichier n’est pas un projet IZORD compatible.");
  return validateProjectData(value);
}
export function exportProjectJson(data: ProjectData, savedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: "IZORD_FICHE_V1", savedAt, ...validateProjectData(data), isExample: false }, null, 2);
}
export function filename(value: string): string { return (value || "Nouveau_Projet").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Projet"; }
