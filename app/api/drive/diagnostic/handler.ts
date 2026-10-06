import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID,
  GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID,
  GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT,
  GOOGLE_DRIVE_DIAGNOSTIC_HUMAN,
  type GoogleDriveDiagnosticResponse
} from "../../../../lib/googleDriveDiagnostic";
import { inspectContactDriveDestination } from "../../../../lib/server/contactDriveDiagnostic";
import {
  DriveRouteError,
  createGoogleDriveFetch,
  createGoogleExternalAccountClient,
  googleDriveFetch,
  driveErrorResponse,
  getDocumentsRootFolderId,
  getGcpProjectId,
  getGcpServiceAccountEmail,
  getSharedDriveId,
  getSharedDriveMetadata,
  listDriveChildren,
  requireAuthenticatedCRMUser,
  requireServerEnv,
  type DriveResourceMetadata,
  type SharedDriveMetadata
} from "../_utils";

const EXPECTED_TOP_LEVEL_FOLDERS = [
  "01 — FACTURES PRESTATAIRES",
  "02 — DEVIS PRESTATAIRES",
  "03 — CONTRATS PRESTATAIRES",
  "04 — SUIVI MAISON",
  "99 — ARCHIVES",
  "CRM DOCUMENTS"
] as const;

type DiagnosticRouteDependencies = {
  requireUser?: typeof requireAuthenticatedCRMUser;
  getGcpProjectId?: () => string;
  getGcpServiceAccountEmail?: () => string;
  getSharedDriveId?: () => string;
  getDocumentsRootFolderId?: () => string;
  getSharedDriveMetadata?: () => Promise<SharedDriveMetadata>;
  listDriveChildren?: (parentId: string) => Promise<DriveResourceMetadata[]>;
  fetchDrive?: ReturnType<typeof createGoogleDriveFetch>;
  contactsRootId?: () => string | null;
  getGoogleAccessToken?: () => Promise<string>;
  requireLiveSession?: (request: Request) => Promise<void>;
};

const PRIVATE_HEADERS = {"cache-control": "private, no-store", "vary": "Authorization"};

function diagnosticFailure(stage: "crm" | "google" | "configuration", code: string, message: string, status: number, crmValidated: boolean) {
  const payload: GoogleDriveDiagnosticResponse = {
    ok: false, scope: "contacts", readOnly: true,
    crmAuthentication: {status: crmValidated ? "validated" : status === 401 ? "required" : "unavailable"},
    googleAuthentication: {status: stage === "google" ? "failed" : "unknown", ...(stage === "google" ? {code, message} : {})},
    error: {stage, code, message},
    ...(stage === "crm" && status === 401 ? {reconnect: true} : {})
  };
  return Response.json(payload, {status, headers: PRIVATE_HEADERS});
}

/** Only allowlisted categories leave the server. Never return an SDK message,
 * response, request headers, subject token or access token. */
function safeGoogleAuthenticationFailure(error: unknown) {
  if (error instanceof DriveRouteError && error.status === 500) {
    return {stage: "configuration" as const, code: "wif_configuration_unavailable", message: "Configuration de l’identité technique indisponible.", status: 503};
  }
  if (error instanceof DriveRouteError && error.status === 503) {
    return {stage: "google" as const, code: "vercel_oidc_unavailable", message: "Identité OIDC Vercel indisponible pour l’authentification Google.", status: 503};
  }
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const response = value.response && typeof value.response === "object" ? value.response as Record<string, unknown> : {};
  const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
  const description = typeof data.error_description === "string" ? data.error_description : "";
  if (/attribute condition/i.test(description)) {
    return {stage: "google" as const, code: "wif_attribute_condition_rejected", message: "WIF a refusé l’identité Vercel : condition d’attribut non satisfaite.", status: 502};
  }
  if (data.error === "invalid_grant") {
    return {stage: "google" as const, code: "wif_subject_rejected", message: "WIF a refusé le jeton d’identité Vercel.", status: 502};
  }
  if (data.error === "unauthorized_client" || data.error === "access_denied") {
    return {stage: "google" as const, code: "wif_exchange_denied", message: "Échange WIF non autorisé par Google.", status: 502};
  }
  const googleError = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : {};
  if (googleError.status === "PERMISSION_DENIED" || response.status === 403) {
    return {stage: "google" as const, code: "google_identity_permission_denied", message: "Google refuse l’échange ou l’impersonation de l’identité technique (403).", status: 502};
  }
  return {stage: "google" as const, code: "google_wif_token_acquisition_failed", message: "L’authentification Google a échoué à l’étape d’échange WIF ou d’impersonation de l’identité technique.", status: 502};
}

/** The published STABLE RPC checks auth.sessions before rejecting a null
 * owner. The one exact rejection below proves only session liveness; it reads
 * no contact document and authorizes no additional operation. */
export async function requireLiveDiagnosticSession(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new DriveRouteError("Authentification CRM requise.", 401);
  const supabase = createClient(requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"), requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    global: {headers: {Authorization: `Bearer ${token}`}, fetch: (input, init) => fetch(input, {...init, cache: "no-store"})},
    auth: {autoRefreshToken: false, detectSessionInUrl: false, persistSession: false}
  });
  const {error} = await supabase.rpc("crm_contact_documents", {p_contact: null});
  if (error?.code === "42501" && error.message === "invalid_document_owner") return;
  if (error?.code === "42501" || error?.code === "PGRST301" || error?.code === "PGRST302") {
    throw new DriveRouteError("Session CRM invalide ou expirée.", 401);
  }
  throw new DriveRouteError("Vérification de la session CRM indisponible.", 503);
}

function publicDriveMetadata(resource: DriveResourceMetadata | null) {
  if (!resource) return null;

  return {
    name: resource.name,
    fileId: resource.id,
    mimeType: resource.mimeType,
    parents: resource.parents,
    driveId: resource.driveId,
    webViewLink: resource.webViewLink || null
  };
}

export function createDriveDiagnosticHandler(dependencies: DiagnosticRouteDependencies = {}) {
  const requireUser = dependencies.requireUser || requireAuthenticatedCRMUser;
  const readGcpProjectId = dependencies.getGcpProjectId || getGcpProjectId;
  const readServiceAccountEmail = dependencies.getGcpServiceAccountEmail || getGcpServiceAccountEmail;
  const readSharedDriveId = dependencies.getSharedDriveId || getSharedDriveId;
  const readDocumentsRootFolderId = dependencies.getDocumentsRootFolderId || getDocumentsRootFolderId;

  return async function GET(request: Request) {
    const url = new URL(request.url);
    const contacts = url.searchParams.get("scope") === "contacts";
    let crmValidated = false;
    try {
      const user = await requireUser(request);
      crmValidated = true;

      if (contacts) {
        if (user.id !== GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID) {
          return diagnosticFailure("crm", "crm_owner_required", "Ce contrôle est réservé au propriétaire disposant de l’accès complet.", 403, true);
        }
        crmValidated = false;
        await (dependencies.requireLiveSession || requireLiveDiagnosticSession)(request);
        crmValidated = true;
        if (request.method !== "GET") {
          return diagnosticFailure("configuration", "method_not_allowed", "Méthode non autorisée.", 405, true);
        }
        if (url.searchParams.getAll("scope").length !== 1 || [...url.searchParams.keys()].some(key => key !== "scope")) {
          return diagnosticFailure("configuration", "invalid_diagnostic_parameters", "Paramètres du diagnostic invalides.", 400, true);
        }
        const sharedDriveId = readSharedDriveId();
        const serviceAccountEmail = readServiceAccountEmail();
        if (sharedDriveId !== GOOGLE_DRIVE_DIAGNOSTIC_DRIVE_ID || serviceAccountEmail !== GOOGLE_DRIVE_DIAGNOSTIC_SERVICE_ACCOUNT) {
          return diagnosticFailure("configuration", "diagnostic_configuration_mismatch", "Le Drive ou l’identité technique configurés ne correspondent pas à la destination attendue.", 503, true);
        }
        let accessToken: string;
        try {
          const acquireToken = dependencies.getGoogleAccessToken || (async () => {
            // Reuse the published WIF client unchanged. The token stays in this request.
            const result = await createGoogleExternalAccountClient().getAccessToken();
            if (!result.token) throw new DriveRouteError("Impossible de récupérer un access token Google Drive.", 502);
            return result.token;
          });
          accessToken = await acquireToken();
          if (!accessToken) throw new DriveRouteError("Impossible de récupérer un access token Google Drive.", 502);
        } catch (error) {
          const failure = safeGoogleAuthenticationFailure(error);
          return diagnosticFailure(failure.stage, failure.code, failure.message, failure.status, true);
        }
        const diagnostic = await inspectContactDriveDestination({
          sharedDriveId,
          contactsRootId: dependencies.contactsRootId ? dependencies.contactsRootId() : process.env.GOOGLE_DRIVE_CONTACTS_FOLDER_ID?.trim() || null,
          serviceAccountEmail,
          humanPrincipals: [GOOGLE_DRIVE_DIAGNOSTIC_HUMAN]
        }, dependencies.fetchDrive || ((input, init) => googleDriveFetch(input, init, {getAccessToken: async () => accessToken})));
        // Discard collected metadata if rights or the live session changed during the call.
        crmValidated = false;
        const currentUser = await requireUser(request);
        if (currentUser.id !== GOOGLE_DRIVE_DIAGNOSTIC_OWNER_ID) throw new DriveRouteError("Accès CRM non autorisé.", 403);
        await (dependencies.requireLiveSession || requireLiveDiagnosticSession)(request);
        crmValidated = true;
        return Response.json(diagnostic, {headers: PRIVATE_HEADERS});
      }

      const needsDefaultDriveReader =
        !dependencies.getSharedDriveMetadata || !dependencies.listDriveChildren;
      const fetchDrive = needsDefaultDriveReader ? createGoogleDriveFetch() : null;
      const readSharedDriveMetadata = dependencies.getSharedDriveMetadata || (
        () => getSharedDriveMetadata(fetchDrive!)
      );
      const readDriveChildren = dependencies.listDriveChildren || (
        (parentId: string) => listDriveChildren(parentId, fetchDrive!)
      );

      const sharedDriveId = readSharedDriveId();
      const documentsRootFolderId = readDocumentsRootFolderId();
      const sharedDrive = await readSharedDriveMetadata();
      const topLevelFolders = await readDriveChildren(sharedDriveId);
      const expectedFolders = Object.fromEntries(
        EXPECTED_TOP_LEVEL_FOLDERS.map((name) => [
          name,
          publicDriveMetadata(topLevelFolders.find((item) => item.name === name) || null)
        ])
      );
      const crmDocuments = topLevelFolders.find(
        (item) => item.id === documentsRootFolderId
      ) || null;

      if (!crmDocuments || crmDocuments.driveId !== sharedDriveId) {
        throw new DriveRouteError(
          "Configuration du dossier Google Drive indisponible.",
          403
        );
      }

      const crmDocumentChildren = await readDriveChildren(crmDocuments.id);
      const devisVitre = crmDocumentChildren.find((item) => item.name === "Devis Vitre") || null;
      const devisVitreChildren = devisVitre
        ? await readDriveChildren(devisVitre.id)
        : [];
      const historicalQuote = devisVitreChildren.find(
        (item) => item.name === "Devis vitre 207 Avenue Du Chateau D’eau.pdf"
      ) || null;

      return Response.json(
        {
          ok: true,
          readOnly: true,
          authenticationMethod: "vercel-oidc-workload-identity-federation",
          gcpProjectId: readGcpProjectId(),
          serviceAccountEmail: readServiceAccountEmail(),
          sharedDrive: {
            id: sharedDrive.id,
            name: sharedDrive.name,
            rootId: sharedDriveId
          },
          documentsRootFolderId,
          topLevelFolders: topLevelFolders.map(publicDriveMetadata),
          expectedFolders,
          historicalDocuments: {
            crmDocuments: publicDriveMetadata(crmDocuments),
            devisVitre: publicDriveMetadata(devisVitre),
            file: publicDriveMetadata(historicalQuote)
          }
        },
        {
          headers: { "cache-control": "private, no-store" }
        }
      );
    } catch (error) {
      if (contacts) {
        const status = error instanceof DriveRouteError ? error.status : 503;
        if (!crmValidated) {
          const code = status === 401 ? "crm_session_required" : status === 403 ? "crm_full_access_required" : "crm_access_unavailable";
          const message = status === 401 ? "Session CRM absente ou expirée. Reconnectez-vous normalement au CRM, puis relancez le contrôle." : status === 403 ? "Accès CRM complet requis pour ce contrôle." : "Vérification de la session ou des droits CRM indisponible.";
          return diagnosticFailure("crm", code, message, status, false);
        }
        return diagnosticFailure("configuration", "diagnostic_configuration_unavailable", "Configuration du diagnostic indisponible.", status, true);
      }
      return driveErrorResponse(error, "Diagnostic Google Drive impossible.");
    }
  };
}
