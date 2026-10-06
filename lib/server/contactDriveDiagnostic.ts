import "server-only";
import type { DiagnosticSnapshot as Snapshot, DiagnosticPermission as Permission, DiagnosticACL as ACL, GoogleDriveDiagnosticResponse } from "../googleDriveDiagnostic";
/** Metadata-only diagnostic. Transport and configuration are injected; this
 * helper never creates, shares, downloads, moves or deletes a Drive resource. */
type MetadataFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Configuration = {
    sharedDriveId: string;
    contactsRootId: string | null;
    serviceAccountEmail: string;
    humanPrincipals: string[];
};
const API = "https://www.googleapis.com/drive/v3/", FOLDER = "application/vnd.google-apps.folder", NAME = "Documents contacts";
const CAPABILITIES = ["canAddChildren", "canListChildren", "canManageMembers", "canShare", "canEdit"];
const FILE_FIELDS = "id,name,mimeType,driveId,parents,trashed,inheritedPermissionsDisabled,capabilities(canAddChildren,canListChildren,canShare,canEdit)";
const text = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 512) : null;
const flag = (value: unknown) => typeof value === "boolean" ? value : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const capabilities = (value: unknown) => Object.fromEntries(CAPABILITIES.map(key => [key, flag(record(value)[key])]));
function restrictions(value: unknown) { const p = record(value); return { ...Object.fromEntries(["copyRequiresWriterPermission", "domainUsersOnly", "driveMembersOnly", "adminManagedRestrictions", "sharingFoldersRequiresOrganizerPermission"].map(key => [key, flag(p[key])])), downloadRestriction: { restrictedForReaders: flag(record(p.downloadRestriction).restrictedForReaders), restrictedForWriters: flag(record(p.downloadRestriction).restrictedForWriters) } }; }
function folderMetadata(value: unknown) { const p = record(value); return { id: text(p.id), name: text(p.name), mimeType: text(p.mimeType), driveId: text(p.driveId), parents: Array.isArray(p.parents) ? p.parents.filter(v => typeof v === "string") : [], trashed: flag(p.trashed), inheritedPermissionsDisabled: flag(p.inheritedPermissionsDisabled), capabilities: capabilities(p.capabilities) }; }
function permission(value: unknown): Permission { const p = record(value); return { id: text(p.id), type: text(p.type), role: text(p.role), emailAddress: text(p.emailAddress), domain: text(p.domain), view: text(p.view), deleted: p.deleted === true, allowFileDiscovery: flag(p.allowFileDiscovery), permissionDetails: Array.isArray(p.permissionDetails) ? p.permissionDetails.map(v => { const d = record(v); return { permissionType: text(d.permissionType), role: text(d.role), inherited: flag(d.inherited), inheritedFrom: text(d.inheritedFrom) }; }) : [] }; }
function principal(email: string, acl: ACL): NonNullable<GoogleDriveDiagnosticResponse["technicalPrincipal"]> { const visible = acl.data?.filter(p => !p.deleted && p.type === "user" && p.emailAddress?.toLowerCase() === email.toLowerCase()) ?? []; return { email, observation: visible.length ? "observed" : acl.status === "available" ? "not-observed" : "unknown", visiblePermissions: visible, effectiveAccess: "not-verified", note: "A visible direct or inherited permission is metadata evidence; group membership, silent restrictions and a real human session are not verified." }; }
export async function inspectContactDriveDestination(configuration: Configuration, fetchDrive: MetadataFetch): Promise<GoogleDriveDiagnosticResponse> {
    let authenticationRejected = false;
    const deadline = Date.now() + 15000;
    const get = async (path: string, parameters: Record<string, string>): Promise<Snapshot<Record<string, unknown>>> => {
        if (authenticationRejected)
            return { status: "unavailable", data: null, reason: "google_authentication_rejected" };
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return { status: "unavailable", data: null, reason: "diagnostic_time_limit" };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                (async () => { const response = await fetchDrive(API + path + "?" + new URLSearchParams(parameters), { method: "GET", cache: "no-store", signal: controller.signal }); if (response.status === 401)
                    authenticationRejected = true; if (!response.ok)
                    return { status: "unavailable" as const, data: null, reason: "http_" + response.status }; const payload = await response.json(); if (!payload || typeof payload !== "object" || Array.isArray(payload))
                    return { status: "unavailable" as const, data: null, reason: "metadata_unconfirmed" }; return { status: "available" as const, data: record(payload) }; })(),
                new Promise<Snapshot<Record<string, unknown>>>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: "unavailable", data: null, reason: "metadata_timeout" }); }, Math.min(5000, remaining)); })
            ]);
        }
        catch {
            return { status: "unavailable", data: null, reason: "transport_unavailable" };
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    };
    const acl = async (id: string): Promise<ACL> => {
        const rows: Permission[] = [], seen = new Set<string>();
        let page = "";
        for (let count = 0; count < 5; count++) {
            const response = await get("files/" + encodeURIComponent(id) + "/permissions", { supportsAllDrives: "true", pageSize: "100", fields: "nextPageToken,permissions(id,type,role,emailAddress,domain,view,deleted,allowFileDiscovery,permissionDetails(permissionType,role,inherited,inheritedFrom))", ...(page ? { pageToken: page } : {}) });
            if (!response.data || !Array.isArray(response.data.permissions))
                return { status: rows.length ? "partial" : "unavailable", data: rows.length ? rows : null, reason: response.reason ?? "permissions_unconfirmed" };
            rows.push(...response.data.permissions.map(permission));
            const next = text(response.data.nextPageToken);
            if (!next)
                return { status: "available", data: rows };
            if (seen.has(next))
                return { status: "partial", data: rows, reason: "repeated_permission_page" };
            seen.add(next);
            page = next;
        }
        return { status: "partial", data: rows, reason: "permission_page_limit" };
    };
    const shared = await get("drives/" + encodeURIComponent(configuration.sharedDriveId), { fields: "id,name,orgUnitId,restrictions,capabilities(canAddChildren,canListChildren,canManageMembers,canShare,canEdit)" });
    const sharedData = shared.data?.id === configuration.sharedDriveId ? { id: text(shared.data.id), name: text(shared.data.name), orgUnitId: text(shared.data.orgUnitId), restrictions: restrictions(shared.data.restrictions), capabilities: capabilities(shared.data.capabilities) } : null;
    const sharedDrive: NonNullable<GoogleDriveDiagnosticResponse["sharedDrive"]> = { status: sharedData ? shared.status : "unavailable", data: sharedData, ...(!sharedData ? { reason: shared.reason ?? "drive_identity_unconfirmed" } : {}) };
    const driveACL = await acl(configuration.sharedDriveId);
    const root = await get("files/" + encodeURIComponent(configuration.sharedDriveId), { supportsAllDrives: "true", fields: FILE_FIELDS });
    const rootData = root.data?.id === configuration.sharedDriveId ? folderMetadata(root.data) : null;
    const rootSnapshot: Snapshot<ReturnType<typeof folderMetadata>> = { status: rootData ? root.status : "unavailable", data: rootData, reason: rootData ? undefined : root.reason ?? "root_identity_unconfirmed" };
    const parentCandidate = { ...rootSnapshot, proposalOnly: true as const };
    const candidates: ReturnType<typeof folderMetadata>[] = [];
    let searchStatus: Snapshot<null> = { status: "available", data: null };
    if (configuration.contactsRootId) {
        const response = await get("files/" + encodeURIComponent(configuration.contactsRootId), { supportsAllDrives: "true", fields: FILE_FIELDS });
        if (response.data?.id === configuration.contactsRootId && response.data.name === NAME && response.data.mimeType === FOLDER && response.data.driveId === configuration.sharedDriveId && response.data.trashed === false)
            candidates.push(folderMetadata(response.data));
        else
            searchStatus = { status: "unavailable", data: null, reason: response.reason ?? "configured_contacts_root_unconfirmed" };
    }
    else {
        const seen = new Set<string>();
        let page = "";
        for (let count = 0; count < 5; count++) {
            const response = await get("files", { corpora: "drive", driveId: configuration.sharedDriveId, includeItemsFromAllDrives: "true", supportsAllDrives: "true", pageSize: "100", q: "name = 'Documents contacts' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: "nextPageToken,incompleteSearch,files(" + FILE_FIELDS + ")", ...(page ? { pageToken: page } : {}) });
            if (!response.data || !Array.isArray(response.data.files)) {
                searchStatus = { status: candidates.length ? "partial" : "unavailable", data: null, reason: response.reason ?? "folder_search_unconfirmed" };
                break;
            }
            for (const item of response.data.files) {
                const p = record(item);
                if (p.name === NAME && p.mimeType === FOLDER && p.driveId === configuration.sharedDriveId && p.trashed === false && text(p.id))
                    candidates.push(folderMetadata(p));
            }
            const next = text(response.data.nextPageToken);
            if (response.data.incompleteSearch === true)
                searchStatus = { status: "partial", data: null, reason: "incomplete_search" };
            if (!next)
                break;
            if (seen.has(next)) {
                searchStatus = { status: "partial", data: null, reason: "repeated_folder_page" };
                break;
            }
            seen.add(next);
            page = next;
            if (count === 4)
                searchStatus = { status: "partial", data: null, reason: "folder_page_limit" };
        }
    }
    if (candidates.length > 3)
        searchStatus = { status: "partial", data: null, reason: "folder_candidate_limit" };
    type ParentSnapshot = {
        metadata: Snapshot<ReturnType<typeof folderMetadata>>;
        permissions: ACL;
    };
    const parentCache = new Map<string, ParentSnapshot>([[configuration.sharedDriveId, { metadata: rootSnapshot, permissions: driveACL }]]);
    let additionalParents = 0;
    const folders: NonNullable<GoogleDriveDiagnosticResponse["contactsFolder"]>["folders"] = [];
    for (const metadata of candidates.slice(0, 3)) {
        const permissions = await acl(metadata.id!), parents = [];
        for (const id of [...new Set<string>(metadata.parents)].slice(0, 3)) {
            let snapshot = parentCache.get(id);
            if (!snapshot) {
                if (additionalParents >= 3)
                    snapshot = { metadata: { status: "unavailable", data: null, reason: "parent_candidate_limit" }, permissions: { status: "unavailable", data: null, reason: "parent_candidate_limit" } };
                else {
                    additionalParents++;
                    const response = await get("files/" + encodeURIComponent(id), { supportsAllDrives: "true", fields: FILE_FIELDS });
                    const data = response.data?.id === id && response.data.driveId === configuration.sharedDriveId && response.data.mimeType === FOLDER && response.data.trashed === false ? folderMetadata(response.data) : null;
                    snapshot = { metadata: { status: data ? response.status : "unavailable", data, reason: data ? undefined : response.reason ?? "parent_identity_unconfirmed" }, permissions: data ? await acl(id) : { status: "unavailable", data: null, reason: "parent_identity_unconfirmed" } };
                }
                parentCache.set(id, snapshot);
            }
            parents.push({ id, ...snapshot });
        }
        folders.push({ metadata, permissions, parents, ancestryNotFullyChecked: true, parentSnapshotComplete: parents.length === metadata.parents.length && parents.every(p => p.metadata.status === "available" && p.permissions.status === "available"), humanPrincipals: configuration.humanPrincipals.map(email => principal(email, permissions)), technicalPrincipal: principal(configuration.serviceAccountEmail, permissions) });
    }
    const about = await get("about", { fields: "storageQuota" }), quota = record(about.data?.storageQuota);
    const decimal = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? value : null;
    const limit = decimal(quota.limit), usage = decimal(quota.usage);
    const available = limit !== null && usage !== null ? (BigInt(limit) > BigInt(usage) ? BigInt(limit) - BigInt(usage) : BigInt(0)).toString() : null;
    const storageQuota: Snapshot<{
        limit: string | null;
        usage: string | null;
        usageInDrive: string | null;
        usageInDriveTrash: string | null;
        available: string | null;
    }> = Object.keys(quota).length ? { status: about.status, data: { limit, usage, usageInDrive: decimal(quota.usageInDrive), usageInDriveTrash: decimal(quota.usageInDriveTrash), available } } : { status: "unavailable", data: null, reason: about.reason ?? "quota_not_reported" };
    const partial = [sharedDrive.status, driveACL.status, parentCandidate.status, searchStatus.status, storageQuota.status, ...folders.flatMap(f => [f.permissions.status, ...f.parents.flatMap(p => [p.metadata.status, p.permissions.status]), ...(f.parentSnapshotComplete ? [] : ["partial"])])].some(s => s !== "available");
    const managers = [{ resourceId: configuration.sharedDriveId, permissions: driveACL }, ...folders.map(f => ({ resourceId: f.metadata.id!, permissions: f.permissions })), ...Array.from(parentCache.entries()).filter(([id]) => id !== configuration.sharedDriveId).map(([resourceId, s]) => ({ resourceId, permissions: s.permissions }))].flatMap(({ resourceId, permissions }) => (permissions.data ?? []).filter(p => !p.deleted && p.role === "organizer").map(permission => ({ resourceId, permission, approved: false as const })));
    return { ok: !authenticationRejected, scope: "contacts", crmAuthentication: { status: "validated" }, googleAuthentication: authenticationRejected ? { status: "failed", code: "google_access_token_rejected", message: "Google Drive a refusé l’authentification de l’identité technique (401)." } : { status: "succeeded" }, ...(authenticationRejected ? { error: { stage: "google" as const, code: "google_access_token_rejected", message: "Google Drive a refusé l’authentification de l’identité technique (401)." } } : {}), managers, status: partial ? "partial" : "available", readOnly: true, authenticationMethod: "vercel-oidc-workload-identity-federation", technicalIdentity: configuration.serviceAccountEmail, sharedDrive, drivePermissions: driveACL, parentCandidate,
        humanPrincipals: configuration.humanPrincipals.map(email => principal(email, driveACL)), technicalPrincipal: principal(configuration.serviceAccountEmail, driveACL),
        contactsFolder: { configuredId: configuration.contactsRootId, exactName: NAME, search: searchStatus, observedCandidateCount: candidates.length, folders, absenceEstablished: false, note: "No matching visible folder does not prove absence; Google may omit resources or permissions invisible to the technical identity." },
        quota: { ...storageQuota, identity: "configured-service-account", scope: "technical-identity", unit: "bytes", organizationPooledCapacity: "not-determined", sharedDriveFreeCapacity: "not-determined", missingLimit: "unknown; never interpreted as unlimited" },
        limitations: ["ACLs are the visible API snapshot; group membership and effective human access are not established.", "Capabilities describe the configured technical identity, not Vincent's session.", "This endpoint does not establish Workspace ownership, pooled organizational capacity or remaining Shared Drive capacity."] };
}
