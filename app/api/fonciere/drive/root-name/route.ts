import { createFonciereDriveRootNameHandler } from "@/lib/server/fonciereDriveRootName";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const GET = createFonciereDriveRootNameHandler();
export const POST = createFonciereDriveRootNameHandler();
