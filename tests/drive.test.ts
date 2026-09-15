import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { IdentityPoolClientOptions } from "google-auth-library";

import {
  DriveRouteError,
  assertAllowedDriveResource,
  assertDriveFolder,
  createGoogleExternalAccountClient,
  getGoogleWorkloadIdentityProviderAudience,
  listDriveChildren,
  requireAuthenticatedCRMUser,
  requireServerEnv,
  type DriveResourceMetadata
} from "../app/api/drive/_utils";
import { createDeleteDriveHandler } from "../app/api/drive/delete/handler";
import { createDriveDiagnosticHandler } from "../app/api/drive/diagnostic/handler";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const WIF_ENVIRONMENT = {
  GCP_PROJECT_ID: "stalwart-method-500314-j8",
  GCP_PROJECT_NUMBER: "704262362320",
  GCP_SERVICE_ACCOUNT_EMAIL:
    "crm-drive-uploader@stalwart-method-500314-j8.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel"
};

function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

async function withDriveEnvironment(callback: () => Promise<void>) {
  const values = {
    GOOGLE_DRIVE_SHARED_DRIVE_ID: process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID,
    GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID: process.env.GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID
  };

  process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = "shared-drive";
  process.env.GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID = "documents-root";

  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function driveFolder(
  id: string,
  name: string,
  parents: string[]
): DriveResourceMetadata {
  return {
    id,
    name,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    parents,
    driveId: "shared-drive",
    webViewLink: `https://drive.google.com/drive/folders/${id}`
  };
}

test("le code Drive ne contient ni clé privée ni anciens secrets OAuth", () => {
  const source = readFileSync("app/api/drive/_utils.ts", "utf8");

  for (const forbidden of [
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "private_key",
    "GoogleAuth"
  ]) {
    assert.equal(source.includes(forbidden), false, `Le code contient encore ${forbidden}`);
  }

  assert.equal(source.includes("getVercelOidcToken"), true);
  assert.equal(source.includes("ExternalAccountClient.fromJSON"), true);
});

test("refuse une variable serveur manquante", () => {
  assert.throws(
    () => requireServerEnv("GCP_SERVICE_ACCOUNT_EMAIL", {}),
    (error) => error instanceof DriveRouteError && error.status === 500 && error.message === "Configuration serveur indisponible."
  );
});

test("crée un ExternalAccountClient pour STS et l’impersonation du compte de service", async () => {
  let capturedOptions: IdentityPoolClientOptions | undefined;
  let oidcCalls = 0;

  createGoogleExternalAccountClient({
    environment: WIF_ENVIRONMENT,
    getOidcToken: async () => {
      oidcCalls += 1;
      return "vercel-oidc-token";
    },
    externalAccountClientFromJSON: (options) => {
      capturedOptions = options as IdentityPoolClientOptions;
      return {
        getAccessToken: async () => ({ token: "temporary-google-token" })
      };
    }
  });

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.type, "external_account");
  assert.equal(
    capturedOptions.audience,
    "//iam.googleapis.com/projects/704262362320/locations/global/workloadIdentityPools/vercel/providers/vercel"
  );
  assert.equal(capturedOptions.subject_token_type, "urn:ietf:params:oauth:token-type:jwt");
  assert.equal(capturedOptions.token_url, "https://sts.googleapis.com/v1/token");
  assert.equal(
    capturedOptions.service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/crm-drive-uploader@stalwart-method-500314-j8.iam.gserviceaccount.com:generateAccessToken"
  );
  assert.deepEqual(capturedOptions.scopes, ["https://www.googleapis.com/auth/drive"]);
  assert.ok(capturedOptions.subject_token_supplier);
  assert.equal(
    await capturedOptions.subject_token_supplier.getSubjectToken({} as never),
    "vercel-oidc-token"
  );
  assert.equal(oidcCalls, 1);
});

test("un token OIDC Vercel absent produit une erreur contrôlée", async () => {
  let capturedOptions: IdentityPoolClientOptions | undefined;

  createGoogleExternalAccountClient({
    environment: WIF_ENVIRONMENT,
    getOidcToken: async () => "",
    externalAccountClientFromJSON: (options) => {
      capturedOptions = options as IdentityPoolClientOptions;
      return {
        getAccessToken: async () => ({ token: "unexpected" })
      };
    }
  });

  assert.ok(capturedOptions?.subject_token_supplier);
  await assert.rejects(
    () => capturedOptions!.subject_token_supplier!.getSubjectToken({} as never),
    (error) => error instanceof DriveRouteError &&
      error.status === 503 &&
      error.message === "Token OIDC Vercel indisponible."
  );
});

test("construit l’audience Google depuis les identifiants WIF non secrets", () => {
  assert.equal(
    getGoogleWorkloadIdentityProviderAudience(WIF_ENVIRONMENT),
    "//iam.googleapis.com/projects/704262362320/locations/global/workloadIdentityPools/vercel/providers/vercel"
  );
});

test("la route de diagnostic sans Bearer token retourne 401", async () => {
  const handler = createDriveDiagnosticHandler({
    requireUser: (request) => requireAuthenticatedCRMUser(request, {
      verifyAccessToken: async () => ({ id: "unexpected", email: "unexpected@example.com" })
    })
  });
  const response = await handler(new Request("http://localhost/api/drive/diagnostic"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Authentification CRM requise."
  });
});

test("la route de diagnostic avec un token invalide retourne 401", async () => {
  const handler = createDriveDiagnosticHandler({
    requireUser: (request) => requireAuthenticatedCRMUser(request, {
      verifyAccessToken: async () => null
    })
  });
  const response = await handler(new Request("http://localhost/api/drive/diagnostic", {
    headers: { authorization: "Bearer invalid-token" }
  }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Session CRM invalide ou expirée."
  });
});

test("refuse un fileId extérieur au Drive partagé configuré", async () => {
  await withDriveEnvironment(async () => {
    const fetchDrive = async () => jsonResponse({
      id: "external-file",
      name: "External",
      mimeType: "application/pdf",
      parents: ["external-root"],
      driveId: "another-drive"
    });

    await assert.rejects(
      () => assertAllowedDriveResource("external-file", { fetchDrive }),
      (error) => error instanceof DriveRouteError && error.status === 403
    );
  });
});

test("accepte un dossier situé sous la racine Documents autorisée", async () => {
  await withDriveEnvironment(async () => {
    const fetchDrive = async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/files/devis-vitre?")) {
        return jsonResponse(driveFolder("devis-vitre", "Devis Vitre", ["documents-root"]));
      }

      throw new Error(`Lecture inattendue : ${url}`);
    };

    const metadata = await assertAllowedDriveResource("devis-vitre", { fetchDrive });
    assert.equal(metadata.id, "devis-vitre");
    assert.doesNotThrow(() => assertDriveFolder(metadata));
  });
});

test("le diagnostic reste en lecture seule et ne retourne aucun secret", async () => {
  const calls: string[] = [];
  const topLevel = [
    driveFolder("invoices", "01 — FACTURES PRESTATAIRES", ["shared-drive"]),
    driveFolder("quotes", "02 — DEVIS PRESTATAIRES", ["shared-drive"]),
    driveFolder("contracts", "03 — CONTRATS PRESTATAIRES", ["shared-drive"]),
    driveFolder("houses", "04 — SUIVI MAISON", ["shared-drive"]),
    driveFolder("archives", "99 — ARCHIVES", ["shared-drive"]),
    driveFolder("documents-root", "CRM DOCUMENTS", ["shared-drive"])
  ];
  const devisVitre = driveFolder("devis-vitre", "Devis Vitre", ["documents-root"]);
  const historicalFile: DriveResourceMetadata = {
    id: "historical-pdf",
    name: "Devis vitre 207 Avenue Du Chateau D’eau.pdf",
    mimeType: "application/pdf",
    parents: ["devis-vitre"],
    driveId: "shared-drive",
    webViewLink: "https://drive.google.com/file/d/historical-pdf/view",
    size: "158258"
  };
  const handler = createDriveDiagnosticHandler({
    requireUser: async () => ({ id: "crm-user", email: "vg@oneaddressriviera.com" }),
    getGcpProjectId: () => "stalwart-method-500314-j8",
    getGcpServiceAccountEmail: () => "crm-drive-uploader@example.iam.gserviceaccount.com",
    getSharedDriveId: () => "shared-drive",
    getDocumentsRootFolderId: () => "documents-root",
    getSharedDriveMetadata: async () => ({ id: "shared-drive", name: "One Address Riviera CRM Storage" }),
    listDriveChildren: async (parentId) => {
      calls.push(parentId);
      if (parentId === "shared-drive") return topLevel;
      if (parentId === "documents-root") return [devisVitre];
      if (parentId === "devis-vitre") return [historicalFile];
      throw new Error(`Dossier inattendu : ${parentId}`);
    }
  });
  const response = await handler(new Request("http://localhost/api/drive/diagnostic", {
    headers: { authorization: "Bearer valid-token" }
  }));
  const text = await response.text();
  const payload = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.authenticationMethod, "vercel-oidc-workload-identity-federation");
  assert.equal(payload.gcpProjectId, "stalwart-method-500314-j8");
  assert.equal(payload.sharedDrive.name, "One Address Riviera CRM Storage");
  assert.equal(payload.expectedFolders["01 — FACTURES PRESTATAIRES"].fileId, "invoices");
  assert.equal(payload.historicalDocuments.file.fileId, "historical-pdf");
  assert.deepEqual(calls, ["shared-drive", "documents-root", "devis-vitre"]);
  assert.equal(text.includes("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"), false);
  assert.equal(text.includes("private_key"), false);
  assert.equal(text.includes("access-token"), false);
  assert.equal(text.includes("BEGIN PRIVATE KEY"), false);
});

test("les listes Drive du diagnostic utilisent uniquement GET et le corpus du Shared Drive", async () => {
  await withDriveEnvironment(async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchDrive = async (input: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: String(init?.method || "GET").toUpperCase()
      });
      return jsonResponse({ files: [] });
    };

    await listDriveChildren("shared-drive", fetchDrive);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /corpora=drive/);
    assert.match(requests[0].url, /driveId=shared-drive/);
    assert.match(requests[0].url, /includeItemsFromAllDrives=true/);
    assert.match(requests[0].url, /supportsAllDrives=true/);
  });
});

test("la réponse du diagnostic ne contient ni clé privée, ni token, ni credentials JSON", async () => {
  const documentsRoot = driveFolder("documents-root", "CRM DOCUMENTS", ["shared-drive"]);
  const handler = createDriveDiagnosticHandler({
    requireUser: async () => ({ id: "crm-user", email: "vg@oneaddressriviera.com" }),
    getGcpProjectId: () => "stalwart-method-500314-j8",
    getGcpServiceAccountEmail: () => "crm-drive-uploader@example.iam.gserviceaccount.com",
    getSharedDriveId: () => "shared-drive",
    getDocumentsRootFolderId: () => "documents-root",
    getSharedDriveMetadata: async () => ({ id: "shared-drive", name: "One Address Riviera CRM Storage" }),
    listDriveChildren: async (parentId) => parentId === "shared-drive" ? [documentsRoot] : []
  });
  const response = await handler(new Request("http://localhost/api/drive/diagnostic", {
    headers: { authorization: "Bearer valid-token" }
  }));
  const text = await response.text();

  assert.equal(response.status, 200);
  for (const forbidden of [
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "private_key",
    "access_token",
    "BEGIN PRIVATE KEY",
    "credentials"
  ]) {
    assert.equal(text.includes(forbidden), false, `La réponse contient ${forbidden}`);
  }
});

test("la suppression Drive est authentifiée, validée puis désactivée en 409", async () => {
  let validatedFileId = "";
  const handler = createDeleteDriveHandler({
    requireUser: async () => ({ id: "crm-user", email: "vg@oneaddressriviera.com" }),
    assertAllowedResource: async (fileId) => {
      validatedFileId = fileId;
      return {
        id: fileId,
        name: "Document",
        mimeType: "application/pdf",
        parents: ["documents-root"],
        driveId: "shared-drive"
      };
    }
  });
  const response = await handler(new Request("http://localhost/api/drive/delete", {
    method: "POST",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ fileId: "historical-pdf" })
  }));

  assert.equal(validatedFileId, "historical-pdf");
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Suppression Drive désactivée : utilisez l’archivage."
  });
});
