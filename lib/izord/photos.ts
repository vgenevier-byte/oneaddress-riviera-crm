/** Full-image resize and centered crops retain the original generator's geometry/JPEG quality. */
import { LIMITS, PHOTO_ROLES, validateJpegData, assertProjectImageBudget, type GalleryPhoto, type ImportMeta, type PhotoRole, type ProjectData } from "./model";
import { imageFileKind, imageHeaderDimensions, validateImageDimensions } from "./photos-validation";
export { imageFileKind, imageHeaderDimensions, validateImageDimensions } from "./photos-validation";
import { blankPhotos } from "./presentation-assets";
export const RATIOS: Record<PhotoRole, number> = { main: 6.333 / 2.986, view: 3.076 / 1.5, inside: 3.076 / 1.5, operation: 2.931 / 1.403 };
export const PHOTO_LABELS: Record<PhotoRole, string> = { main: "Vue d’ensemble", view: "Vue / environnement", inside: "Intérieur", operation: "État existant" };
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Opération annulée.", "AbortError"); }
export function fileData(file: Blob, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  if (!file.size || file.size > LIMITS.fileBytes) return Promise.reject(new Error("Image trop volumineuse ou vide (maximum 25 Mo)."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => { reader.abort(); cleanup(); reject(new DOMException("Lecture annulée.", "AbortError")); };
    reader.onload = () => { cleanup(); if (typeof reader.result === "string") resolve(reader.result); else reject(new Error("Lecture du fichier impossible.")); };
    reader.onerror = () => { cleanup(); reject(new Error("Lecture du fichier impossible.")); };
    signal?.addEventListener("abort", abort, { once: true }); reader.readAsDataURL(file);
  });
}
function loadImage(data: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 34_000_000) return Promise.reject(new Error("Image incorporée invalide."));
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), char => char.charCodeAt(0)); imageHeaderDimensions(bytes);
  return new Promise((resolve, reject) => {
    const image = new Image(); const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); image.onload = null; image.onerror = null; };
    const fail = (message: string) => { cleanup(); image.src = ""; reject(new Error(message)); };
    const abort = () => { cleanup(); image.src = ""; reject(new DOMException("Photographie annulée.", "AbortError")); };
    const timeout = setTimeout(() => fail("Décodage de photographie interrompu après 15 secondes."), 15_000);
    image.onload = () => { try { validateImageDimensions(image.naturalWidth, image.naturalHeight); cleanup(); resolve(image); } catch { fail("Dimensions photographiques invalides."); } };
    image.onerror = () => fail("Photographie non lisible. Utilisez JPG, PNG ou WebP.");
    signal?.addEventListener("abort", abort, { once: true }); image.src = data;
  });
}
export async function resizeImported(data: string, signal?: AbortSignal): Promise<string> {
  const img = await loadImage(data, signal); checkAbort(signal);
  const scale = Math.min(1, 1500 / img.width), canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("Conversion JPEG indisponible.");
  context.drawImage(img, 0, 0, canvas.width, canvas.height); const result = canvas.toDataURL("image/jpeg", .9); canvas.width = canvas.height = 0; img.src = ""; return result;
}
export async function cropPhoto(data: string, ratio: number, signal?: AbortSignal): Promise<string> {
  const img = await loadImage(data, signal); checkAbort(signal);
  if (!Number.isFinite(ratio) || ratio < .1 || ratio > 10) throw new Error("Ratio photographique invalide.");
  const w = 1400, h = Math.round(w / ratio); let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (sw / sh > ratio) { sx = (sw - sh * ratio) / 2; sw = sh * ratio; } else { sy = (sh - sw / ratio) / 2; sh = sw / ratio; }
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Recadrage JPEG indisponible.");
  ctx.fillStyle = "#FAF8F3"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); const result = canvas.toDataURL("image/jpeg", .9); canvas.width = canvas.height = 0; img.src = ""; return result;
}
export function allPhotoItems(project: ProjectData): GalleryPhoto[] {
  const items: GalleryPhoto[] = [], seen = new Set<string>();
  const add = (photo: GalleryPhoto) => { if (!photo || seen.has(photo.data)) return; validateJpegData(photo.data); seen.add(photo.data); items.push({ ...photo, label: String(photo.label || "Photographie") }); };
  for (const photo of project.importGallery) add(photo);
  for (const role of PHOTO_ROLES) { if (!project.photos[role] || project.photos[role] === blankPhotos[role]) continue; const index = project.photoGalleryRoles[role]; if (Number.isInteger(index) && index !== undefined && index >= 0 && project.importGallery[index]) continue; add({ data: project.photos[role], label: PHOTO_LABELS[role], page: null, width: null, height: null, source: "Photo de synthèse" }); }
  return items;
}
export async function photoSize(photo: GalleryPhoto, signal?: AbortSignal): Promise<{ width: number; height: number }> { const image = await loadImage(photo.data, signal); const result = { width: image.naturalWidth, height: image.naturalHeight }; image.src = ""; return result; }
export async function addPhotoFile(project: ProjectData, file: File, role?: PhotoRole, signal?: AbortSignal): Promise<ProjectData> {
  checkAbort(signal); if (!file.size || file.size > LIMITS.fileBytes) throw new Error("Image trop volumineuse ou vide (maximum 25 Mo).");
  const bytes = new Uint8Array(await file.arrayBuffer()); checkAbort(signal); const kind = imageFileKind(bytes); imageHeaderDimensions(bytes);
  if (file.type && file.type !== kind) throw new Error("Le contenu de l’image ne correspond pas au type annoncé.");
  const original = await resizeImported(await fileData(new Blob([bytes], { type: kind }), signal), signal);
  let index = project.importGallery.findIndex(photo => photo.data === original); const gallery = [...project.importGallery];
  if (index < 0) { if (gallery.length >= LIMITS.galleryPhotos) throw new Error("Photothèque complète (480 photos maximum)."); index = gallery.length; gallery.push({ data: original, label: file.name.slice(0, 100), page: null, width: null, height: null, source: "Ajout manuel" }); }
  const next = { ...project, importGallery: gallery, photos: { ...project.photos }, photoGalleryRoles: { ...project.photoGalleryRoles } };
  assertProjectImageBudget(next);
  return role ? assignGalleryPhoto(next, role, index, signal) : next;
}
export async function assignGalleryPhoto(project: ProjectData, role: PhotoRole, index: number, signal?: AbortSignal): Promise<ProjectData> {
  const photo = project.importGallery[index]; if (!PHOTO_ROLES.includes(role) || !Number.isInteger(index) || !photo) throw new Error("Photographie sélectionnée invalide.");
  const crop = await cropPhoto(photo.data, RATIOS[role], signal); checkAbort(signal);
  const meta = project.importMeta ? { ...project.importMeta, roles: { ...(typeof project.importMeta.roles === "object" && project.importMeta.roles !== null ? project.importMeta.roles : {}), [role]: index } } : null;
  const next = { ...project, photos: { ...project.photos, [role]: crop }, photoGalleryRoles: { ...project.photoGalleryRoles, [role]: index }, importMeta: meta };
  assertProjectImageBudget(next); return next;
}
export function importedNotes(meta: ImportMeta | null): string { if (!meta) return ""; return '\n\nIMPORT DE LA FICHE AGENCE\n' + JSON.stringify(meta, null, 2) + '\nPréremplissage local à partir du texte et des JPEG incorporés au PDF. Les montants d’acquisition cible, travaux, revente et location ne proviennent pas de cet import. La validation porte sur une relecture utilisateur, pas sur une certification de l’agence ou d’un professionnel.\n'; }
