import { createFonciereDriveStatusHandler } from "@/lib/server/fonciereDriveHandlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createFonciereDriveStatusHandler();
export const POST = createFonciereDriveStatusHandler();
