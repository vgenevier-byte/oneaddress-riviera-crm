import { createHouseWorkerDocumentCleanupHandler } from "../../../../lib/server/houseWorkerDocumentCleanup";
export const runtime = "nodejs";
export const maxDuration = 45;
export const POST = createHouseWorkerDocumentCleanupHandler();
