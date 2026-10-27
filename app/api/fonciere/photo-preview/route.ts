import { createFoncierePhotoPreviewHandler } from "@/lib/server/foncierePhotoPreview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createFoncierePhotoPreviewHandler();
