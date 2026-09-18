/** Aggregate limit, independent from the per-image dimension/file limits. */
export const TOTAL_IMAGE_BYTES = 100_000_000;
// Reserve at least 10 MB inside the 180 MB JSON limit for metadata/text/escaping.
export const TOTAL_ENCODED_IMAGE_CHARS = 170_000_000;
export type ImageByteEntry = { id: string; bytes: number };
export function assertImageByteBudget(entries: Iterable<ImageByteEntry>, limit = TOTAL_IMAGE_BYTES): number {
  const seen = new Map<string, number>(); let total = 0;
  for (const { id, bytes } of entries) {
    if (typeof id !== "string" || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Taille photographique invalide.");
    const previous = seen.get(id) || 0;
    if (bytes <= previous) continue;
    total += bytes - previous;
    if (total > limit) throw new Error("Photographies trop volumineuses : maximum 100 Mo au total par dossier (images distinctes).");
    seen.set(id, bytes);
  }
  return total;
}
/** Computes decoded length without allocating or decoding a second binary copy. */
export function jpegDataByteLength(value: string): number {
  const prefix = "data:image/jpeg;base64,";
  if (!value.startsWith(prefix)) throw new Error("Photographie JPEG incorporée attendue.");
  const length = value.length - prefix.length;
  if (length <= 0 || length % 4 !== 0) throw new Error("Longueur JPEG incorporée invalide.");
  return length * 3 / 4 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}
export function encodedJpegLength(bytes: number): number { return Math.ceil(bytes / 3) * 4 + "data:image/jpeg;base64,".length; }
/** Count every occurrence: duplicate references are expanded by JSON.stringify. */
export function assertEncodedImageBudget(lengths: Iterable<number>): number {
  let total = 0;
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Longueur photographique invalide.");
    total += length;
    if (total > TOTAL_ENCODED_IMAGE_CHARS) throw new Error("Photographies répétées trop volumineuses pour un export JSON de 180 Mo maximum.");
  }
  return total;
}
