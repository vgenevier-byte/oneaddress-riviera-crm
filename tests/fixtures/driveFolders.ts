import type { FolderIdentity, FolderRegistry, FolderReservation } from "../../app/api/drive/_folderRegistry";
import { vendorFolderProperties, type VendorFolderSpec } from "../../app/api/drive/_vendorFolders";
export function mockFolder(spec: VendorFolderSpec, id: string) {
  return { id, mimeType: "application/vnd.google-apps.folder", driveId: spec.sharedDriveId, parents: [spec.parentId], trashed: false, appProperties: vendorFolderProperties(spec) };
}
export function mockDrive() {
  const files = new Map<string, ReturnType<typeof mockFolder>>();
  const creates: string[] = [];
  const state = { generated: 0, conflicts: 0, timeoutAfterCreate: 0, hiddenGets: 0, searchOverride: null as ReturnType<typeof mockFolder>[] | null };
  const fetchDrive = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/generateIds")) {
      if (url.searchParams.get("count") !== "1" || url.searchParams.get("space") !== "drive") throw new Error("Invalid ID request");
      return Response.json({ ids: [`reserved-${++state.generated}`] });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (!body.id) throw new Error("Creation without reserved ID");
      creates.push(body.id);
      if (files.has(body.id)) { state.conflicts++; return Response.json({}, { status: 409 }); }
      files.set(body.id, { ...body, driveId: "shared-test", trashed: false });
      if (state.timeoutAfterCreate > 0) { state.timeoutAfterCreate--; throw new Error("Simulated Drive timeout after commit"); }
      return Response.json({ id: body.id });
    }
    if (url.searchParams.has("q")) {
      const q = url.searchParams.get("q")!;
      const parent = q.match(/^'([^']+)' in parents/)?.[1];
      const props = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)];
      if (!parent || props.length !== 5 || url.searchParams.get("corpora") !== "drive") throw new Error("Unsafe recovery query");
      return Response.json({ files: state.searchOverride || [...files.values()].filter(f => f.parents[0] === parent && !f.trashed && f.driveId === url.searchParams.get("driveId") && props.every(([,k,v]) => (f.appProperties as Record<string,string>)[k] === v)) });
    }
    if (state.hiddenGets > 0) { state.hiddenGets--; return Response.json({}, { status: 404 }); }
    const folder = files.get(decodeURIComponent(url.pathname.split("/").pop()!));
    return folder ? Response.json(folder) : Response.json({}, { status: 404 });
  };
  return { files, creates, state, fetchDrive };
}
// Only for route unit tests; distributed concurrency tests use real Postgres RPCs.
export function memoryFolderRegistry(): FolderRegistry {
  const rows = new Map<string, FolderReservation & { token: string }>();
  const key = (i: FolderIdentity) => `${i.workspaceId}/${i.logicalKey}`;
  return {
    async claim(i, token) {
      let row = rows.get(key(i));
      if (!row) { row = { workspace_id: i.workspaceId, logical_key: i.logicalKey, parent_drive_folder_id: i.parentId, status: "creating", drive_folder_id: null, token }; rows.set(key(i), row); }
      return { ...row, claimed: row.status === "creating" && row.token === token };
    },
    async reserve(i, token, id) { const row = rows.get(key(i))!; if (row.token !== token) return null; row.drive_folder_id ||= id; return { ...row }; },
    async ready(i, token, id) { const row = rows.get(key(i))!; if (row.token !== token || row.drive_folder_id !== id) return false; row.status = "ready"; return true; }
  };
}
