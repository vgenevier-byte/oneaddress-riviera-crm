/** Non-secret metadata contract shared by the owner UI and its read-only route. */
export const GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID = "dc495374-494b-420c-89d7-adb4667d8747";
export const GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID = "0ANj9BrFwFggDUk9PVA";
export const GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT = "crm-drive-uploader@stalwart-method-500314-j8.iam.gserviceaccount.com";
export const GOOGLE_DRIVE_DIAGNOSTIC_HUMAN = "vg@oneaddressriviera.com";

export function canUseGoogleDriveDiagnostic(userId: string | null | undefined, access: {active?: boolean; generalAdmin?: boolean; fullAccess?: boolean} | null | undefined) {
  return userId === GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID && access?.active === true && access.generalAdmin === true && access.fullAccess === true;
}

export type DiagnosticSnapshot<T> = {status: "available" | "partial" | "unavailable"; data: T | null; reason?: string};
export type DiagnosticPermission = {
  id: string | null; type: string | null; role: string | null; emailAddress: string | null;
  domain: string | null; view: string | null; deleted: boolean; allowFileDiscovery: boolean | null;
  permissionDetails: {permissionType: string | null; role: string | null; inherited: boolean | null; inheritedFrom: string | null}[];
};
export type DiagnosticACL = DiagnosticSnapshot<DiagnosticPermission[]>;
export type DiagnosticCapabilities = Record<string, boolean | null>;
export type DiagnosticFolder = {
  id: string | null; name: string | null; mimeType: string | null; driveId: string | null;
  parents: string[]; trashed: boolean | null; inheritedPermissionsDisabled: boolean | null;
  capabilities: DiagnosticCapabilities;
};
export type DiagnosticPrincipal = {
  email: string; observation: "observed" | "not-observed" | "unknown";
  visiblePermissions: DiagnosticPermission[]; effectiveAccess: "not-verified"; note: string;
};
export type GoogleDriveDiagnosticResponse = {
  ok: boolean; scope: "contacts"; readOnly: true;
  crmAuthentication: {status: "validated" | "required" | "unavailable"};
  googleAuthentication: {status: "succeeded" | "failed" | "unknown"; code?: string; message?: string};
  error?: {stage: "crm" | "google" | "configuration"; code: string; message: string};
  reconnect?: boolean; status?: "available" | "partial";
  authenticationMethod?: string; technicalIdentity?: string;
  sharedDrive?: DiagnosticSnapshot<{id: string | null; name: string | null; orgUnitId: string | null; restrictions: Record<string, unknown>; capabilities: DiagnosticCapabilities}>;
  drivePermissions?: DiagnosticACL;
  parentCandidate?: DiagnosticSnapshot<DiagnosticFolder> & {proposalOnly: true};
  humanPrincipals?: DiagnosticPrincipal[]; technicalPrincipal?: DiagnosticPrincipal;
  contactsFolder?: {
    configuredId: string | null; exactName: string; search: DiagnosticSnapshot<null>;
    observedCandidateCount: number; absenceEstablished: false; note: string;
    folders: {
      metadata: DiagnosticFolder; permissions: DiagnosticACL;
      parents: {id: string; metadata: DiagnosticSnapshot<DiagnosticFolder>; permissions: DiagnosticACL}[];
      ancestryNotFullyChecked: true; parentSnapshotComplete: boolean;
      humanPrincipals: DiagnosticPrincipal[]; technicalPrincipal: DiagnosticPrincipal;
    }[];
  };
  managers?: {resourceId: string; permission: DiagnosticPermission; approved: false}[];
  quota?: DiagnosticSnapshot<{limit: string | null; usage: string | null; usageInDrive: string | null; usageInDriveTrash: string | null; available: string | null}> & {
    identity: "configured-service-account"; scope: "technical-identity"; unit: "bytes";
    organizationPooledCapacity: "not-determined"; sharedDriveFreeCapacity: "not-determined"; missingLimit: string;
  };
  limitations?: string[];
};
