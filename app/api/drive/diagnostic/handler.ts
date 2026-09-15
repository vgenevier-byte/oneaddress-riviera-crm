import "server-only";
import {
  DriveRouteError,
  createGoogleDriveFetch,
  driveErrorResponse,
  getDocumentsRootFolderId,
  getGcpProjectId,
  getGcpServiceAccountEmail,
  getSharedDriveId,
  getSharedDriveMetadata,
  listDriveChildren,
  requireAuthenticatedCRMUser,
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
};

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
    try {
      await requireUser(request);

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
      return driveErrorResponse(error, "Diagnostic Google Drive impossible.");
    }
  };
}
