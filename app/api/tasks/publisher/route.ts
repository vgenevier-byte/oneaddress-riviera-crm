import "server-only";
import { handleTaskPublisher } from "@/lib/publisher/engine/taskTargets.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleTaskPublisher;
export const POST = handleTaskPublisher;
