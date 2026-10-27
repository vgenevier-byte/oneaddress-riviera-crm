import { createFonciereDriveWorkerHandler } from "@/lib/server/fonciereDriveHandlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = createFonciereDriveWorkerHandler();
export const POST = createFonciereDriveWorkerHandler();
