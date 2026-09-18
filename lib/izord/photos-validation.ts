/** Pure raster signature/dimension checks shared by JSON imports and manual image uploads. */
export const IMAGE_LIMITS = { dimension: 16_000, pixels: 40_000_000 } as const;
export function validateImageDimensions(width: number, height: number): void { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > IMAGE_LIMITS.dimension || height > IMAGE_LIMITS.dimension || width * height > IMAGE_LIMITS.pixels) throw new Error("Photographie trop grande : maximum 16 000 px par côté et 40 mégapixels."); }
export function imageFileKind(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 24 && bytes.slice(0, 8).every((b, i) => b === [137,80,78,71,13,10,26,10][i])) return "image/png";
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new Error("Photographie non lisible. Utilisez JPG, PNG ou WebP.");
}
export function imageHeaderDimensions(bytes: Uint8Array): { width: number; height: number } {
  const kind = imageFileKind(bytes), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (kind === "image/png") { width = view.getUint32(16); height = view.getUint32(20); }
  else if (kind === "image/webp") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); }
    else if (chunk === "VP8L" && bytes[20] === 47) { width = 1 + bytes[21] + ((bytes[22] & 63) << 8); height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10); }
    else if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383; }
  } else {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1]; at += 2;
      if (marker === 255) { at--; continue; }
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue;
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(at); if (length < 2 || at + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = view.getUint16(at + 3); width = view.getUint16(at + 5); break; }
      at += length;
    }
  }
  validateImageDimensions(width, height); return { width, height };
}
