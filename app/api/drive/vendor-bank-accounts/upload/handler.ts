import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assertAllowedDriveResource, assertDriveFolder, createGoogleDriveFetch, DriveRouteError, getSharedDriveId, jsonError, requireAuthenticatedCRMUser, requireServerEnv } from "../../_utils";
import type { FolderRegistry } from "../../_folderRegistry";
import { createFolderRegistry } from "../../../../../lib/server/driveRegistrySupabase";
import { resolveVendorFolder } from "../../_vendorFolders";
import type { Contact } from "../../../../../lib/types";
import { isEligibleVendorContact, getVendorBusinessName } from "../../../../../lib/vendorContacts";

type DriveFetch = ReturnType<typeof createGoogleDriveFetch>;
async function loadContact(request: Request, id: string): Promise<Contact | undefined> {
  const client = createClient(requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"), requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    global: { headers: { Authorization: request.headers.get("authorization")! } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await client.from("crm_workspace_state").select("payload").eq("workspace_id", "oneaddress-riviera").single();
  if (error) throw new DriveRouteError("Contact CRM inaccessible.", 403);
  return (data?.payload?.contacts as Contact[] | undefined)?.find(c => c.id === id && isEligibleVendorContact(c));
}
export function createVendorBankUploadHandler(deps: { requireUser?: typeof requireAuthenticatedCRMUser; loadContact?: typeof loadContact; fetchDrive?: DriveFetch; registry?: FolderRegistry } = {}) {
  return async (request: Request) => {
    try {
      await (deps.requireUser || requireAuthenticatedCRMUser)(request);
      const form = await request.formData();
      // No user-selected parent, title or bank details are accepted by this route.
      if (Array.from(form.keys()).some(key => !["file", "contactId"].includes(key))) return jsonError("Paramètre d’upload non autorisé.", 400);
      const file = form.get("file");
      if (!(file instanceof File) || file.size < 1 || file.size > 4_000_000) return jsonError("RIB requis, maximum 4 Mo.", 400);
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const signature = Array.from(bytes.slice(0, 4)).join(",");
      const extension = file.type === "application/pdf" && new TextDecoder().decode(bytes).startsWith("%PDF-") ? "pdf"
        : file.type === "image/png" && signature === "137,80,78,71" ? "png"
        : file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg"
        : file.type === "image/webp" && new TextDecoder().decode(bytes).startsWith("RIFF") && new TextDecoder().decode(bytes.slice(8)).startsWith("WEBP") ? "webp" : "";
      if (!extension) return jsonError("Format RIB non autorisé : PDF, PNG, JPEG ou WebP requis.", 400);
      const contact = await (deps.loadContact || loadContact)(request, String(form.get("contactId") || ""));
      if (!contact) return jsonError("Prestataire CRM introuvable.", 403);
      const root = requireServerEnv("GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID");
      const fetchDrive = deps.fetchDrive || createGoogleDriveFetch();
      assertDriveFolder(await assertAllowedDriveResource(root, { allowedRootIds: [root], fetchDrive }));
      const registry = deps.registry || createFolderRegistry(request.headers.get("authorization"));
      const common = { workspaceId: "oneaddress-riviera", contactId: contact.id, sharedDriveId: getSharedDriveId() };
      const vendorFolder = await resolveVendorFolder({ ...common, parentId: root, kind: "vendor-root", name: getVendorBusinessName(contact) }, { registry, fetchDrive });
      const folder = await resolveVendorFolder({ ...common, parentId: vendorFolder, kind: "rib", name: "RIB" }, { registry, fetchDrive });
      const safeName = getVendorBusinessName(contact).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80).toUpperCase();
      const fileName = `RIB_${safeName}_${new Date().toISOString().slice(0, 10)}.${extension}`;
      const multipart = new FormData();
      multipart.append("metadata", new Blob([JSON.stringify({ name: fileName, parents: [folder] })], { type: "application/json" }));
      multipart.append("file", file, fileName);
      const uploaded = await fetchDrive("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", body: multipart });
      if (!uploaded.ok) throw new DriveRouteError("Upload du RIB impossible.", 502);
      const payload = await uploaded.json();
      if (!payload.id) throw new DriveRouteError("Upload du RIB incomplet.", 502);
      return Response.json({ documentProvider: "google-drive", driveFileId: payload.id, driveFolderId: folder, driveFileName: fileName, driveOriginalFileName: file.name, driveMimeType: file.type, driveSize: file.size, driveUploadedAt: new Date().toISOString() }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return jsonError(error instanceof DriveRouteError ? error.message : "Enregistrement du RIB impossible.", error instanceof DriveRouteError ? error.status : 500);
    }
  };
}
