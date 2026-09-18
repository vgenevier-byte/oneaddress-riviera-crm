/** Native source template, sanitized before bundling. No embedded example project/media.
 * Geometry, masters, fonts and editable shapes are retained from audited HTML v3.
 */
import assets from "./presentation-assets.json";
import type { PhotoRole } from "./model";

type Geometry = { id: number; x: number; y: number; w: number; h: number };
export type SlideTextSpec = Geometry & { kind: "text"; text: string; font: string; size: number; bold: boolean; color: string; align: "left" | "center" | "right"; line: number };
export type SlideSpec = SlideTextSpec | Geometry & { kind: "image"; role: PhotoRole } | Geometry & { kind: "rect"; fill: string };
export const blankPhotos: Record<PhotoRole, string> = assets.blankPhotos;
export const presentationSlides = assets.slides as SlideSpec[][];
export const presentationTemplate = assets.template;
export const presentationSourceSHA256 = assets.sourceSHA256;
export const presentationDimensions = { width: 960, height: 540, widthEmu: 12192000, heightEmu: 6858000 } as const;
