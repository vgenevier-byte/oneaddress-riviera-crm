import "server-only";
import { handlePublisher } from "@/lib/publisher/engine/handler.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = handlePublisher;
export const POST = handlePublisher;
