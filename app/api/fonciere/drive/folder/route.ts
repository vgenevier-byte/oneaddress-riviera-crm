import { createFonciereDriveFolderHandler } from "@/lib/server/fonciereDriveHandlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createFonciereDriveFolderHandler();
