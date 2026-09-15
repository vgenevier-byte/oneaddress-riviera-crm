import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";

const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type ServerEnvironment = Record<string, string | undefined>;

export type AuthenticatedCRMUser = {
  id: string;
  email: string;
};

export type DriveResourceMetadata = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  driveId: string;
  webViewLink?: string;
  size?: string;
};

export type SharedDriveMetadata = {
  id: string;
  name: string;
};

type DriveListResponse = {
  files?: DriveResourceMetadata[];
  nextPageToken?: string;
  error?: {
    message?: string;
  };
};

type VerifyAccessToken = (token: string) => Promise<AuthenticatedCRMUser | null>;
type DriveFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type OidcTokenSupplier = () => Promise<string>;
type GoogleAccessTokenClient = {
  getAccessToken: () => Promise<{ token?: string | null }>;
};

type ExternalAccountClientFactory = (
  options: Parameters<typeof ExternalAccountClient.fromJSON>[0]
) => GoogleAccessTokenClient | null;

export class DriveRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DriveRouteError";
    this.status = status;
  }
}

export function requireServerEnv(name: string, environment: ServerEnvironment = process.env) {
  const value = environment[name];

  if (!value || !value.trim()) {
    throw new DriveRouteError("Configuration serveur indisponible.", 500);
  }

  return value.trim();
}

export function getGcpProjectId(environment: ServerEnvironment = process.env) {
  return requireServerEnv("GCP_PROJECT_ID", environment);
}

export function getGcpServiceAccountEmail(environment: ServerEnvironment = process.env) {
  return requireServerEnv("GCP_SERVICE_ACCOUNT_EMAIL", environment);
}

export function getSharedDriveId() {
  return requireServerEnv("GOOGLE_DRIVE_SHARED_DRIVE_ID");
}

export function getDocumentsRootFolderId() {
  return requireServerEnv("GOOGLE_DRIVE_DOCUMENTS_FOLDER_ID");
}

export function getGoogleWorkloadIdentityProviderAudience(
  environment: ServerEnvironment = process.env
) {
  const projectNumber = requireServerEnv("GCP_PROJECT_NUMBER", environment);
  const poolId = requireServerEnv("GCP_WORKLOAD_IDENTITY_POOL_ID", environment);
  const providerId = requireServerEnv("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID", environment);

  return `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
}

async function requireVercelOidcToken(getOidcToken: OidcTokenSupplier) {
  try {
    const token = await getOidcToken();

    if (!token || !token.trim()) {
      throw new DriveRouteError("Token OIDC Vercel indisponible.", 503);
    }

    return token;
  } catch (error) {
    if (error instanceof DriveRouteError) throw error;
    throw new DriveRouteError("Token OIDC Vercel indisponible.", 503);
  }
}

export function createGoogleExternalAccountClient(
  dependencies: {
    environment?: ServerEnvironment;
    getOidcToken?: OidcTokenSupplier;
    externalAccountClientFromJSON?: ExternalAccountClientFactory;
  } = {}
) {
  const environment = dependencies.environment || process.env;
  const getOidcToken = dependencies.getOidcToken || getVercelOidcToken;
  const externalAccountClientFromJSON =
    dependencies.externalAccountClientFromJSON || ExternalAccountClient.fromJSON;
  const serviceAccountEmail = getGcpServiceAccountEmail(environment);

  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i.test(serviceAccountEmail)) {
    throw new DriveRouteError("Adresse du compte de service Google invalide.", 500);
  }

  // Validate every documented non-secret GCP variable before starting an exchange.
  getGcpProjectId(environment);

  const client = externalAccountClientFromJSON({
    type: "external_account",
    audience: getGoogleWorkloadIdentityProviderAudience(environment),
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    scopes: [GOOGLE_DRIVE_SCOPE],
    subject_token_supplier: {
      getSubjectToken: () => requireVercelOidcToken(getOidcToken)
    }
  });

  if (!client) {
    throw new DriveRouteError(
      "Configuration Workload Identity Federation Google invalide.",
      500
    );
  }

  return client;
}

export async function getGoogleDriveAccessToken(
  dependencies: {
    client?: GoogleAccessTokenClient;
  } = {}
) {
  const client = dependencies.client || createGoogleExternalAccountClient();
  let token: string | null | undefined;

  try {
    token = (await client.getAccessToken()).token;
  } catch (error) {
    if (error instanceof DriveRouteError) throw error;
    throw new DriveRouteError(
      "Authentification Google Drive via Vercel OIDC impossible.",
      502
    );
  }

  if (!token) {
    throw new DriveRouteError("Impossible de récupérer un access token Google Drive.", 502);
  }

  return token;
}

export async function googleDriveFetch(
  input: string | URL,
  init: RequestInit = {},
  dependencies: {
    getAccessToken?: () => Promise<string>;
    fetchImpl?: typeof fetch;
  } = {}
) {
  const getAccessToken = dependencies.getAccessToken || getGoogleDriveAccessToken;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await getAccessToken()}`);

  return fetchImpl(input, {
    ...init,
    headers
  });
}

export function createGoogleDriveFetch(
  dependencies: {
    getOidcToken?: OidcTokenSupplier;
    fetchImpl?: typeof fetch;
  } = {}
): DriveFetch {
  const client = createGoogleExternalAccountClient({
    getOidcToken: dependencies.getOidcToken
  });

  return (input, init = {}) => googleDriveFetch(input, init, {
    getAccessToken: () => getGoogleDriveAccessToken({ client }),
    fetchImpl: dependencies.fetchImpl
  });
}

async function verifySupabaseAccessToken(token: string): Promise<AuthenticatedCRMUser | null> {
  const supabase = createClient(
    requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    }
  );

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: String(data.user.email || "").toLowerCase()
  };
}

export async function requireAuthenticatedCRMUser(
  request: Request,
  dependencies: {
    verifyAccessToken?: VerifyAccessToken;
  } = {}
) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";

  if (!token) {
    throw new DriveRouteError("Authentification CRM requise.", 401);
  }

  try {
    const user = await (dependencies.verifyAccessToken || verifySupabaseAccessToken)(token);

    if (!user) {
      throw new DriveRouteError("Session CRM invalide ou expirée.", 401);
    }

    return user;
  } catch (error) {
    if (error instanceof DriveRouteError) throw error;
    throw new DriveRouteError("Session CRM invalide ou expirée.", 401);
  }
}

export function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getGoogleErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : fallback;
}

export async function getDriveResourceMetadata(
  resourceId: string,
  fetchDrive: DriveFetch = googleDriveFetch
) {
  const id = String(resourceId || "").trim();

  if (!id) {
    throw new DriveRouteError("fileId manquant.", 400);
  }

  const fields = "id,name,mimeType,parents,driveId,webViewLink,size";
  const response = await fetchDrive(
    `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    { method: "GET" }
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new DriveRouteError(
      getGoogleErrorMessage(payload, "Ressource Google Drive introuvable."),
      response.status
    );
  }

  const metadata = payload as Partial<DriveResourceMetadata>;

  return {
    id: String(metadata.id || id),
    name: String(metadata.name || ""),
    mimeType: String(metadata.mimeType || ""),
    parents: Array.isArray(metadata.parents) ? metadata.parents.map(String) : [],
    driveId: String(metadata.driveId || ""),
    webViewLink: metadata.webViewLink ? String(metadata.webViewLink) : undefined,
    size: metadata.size ? String(metadata.size) : undefined
  } satisfies DriveResourceMetadata;
}

export async function assertAllowedDriveResource(
  resourceId: string,
  options: {
    allowedRootIds?: string[];
    fetchDrive?: DriveFetch;
  } = {}
) {
  const fetchDrive = options.fetchDrive || googleDriveFetch;
  const sharedDriveId = getSharedDriveId();
  const allowedRootIds = new Set(
    (options.allowedRootIds || [getDocumentsRootFolderId(), process.env.GOOGLE_DRIVE_VENDOR_DOCUMENTS_FOLDER_ID || ""])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const firstResource = await getDriveResourceMetadata(resourceId, fetchDrive);

  if (firstResource.driveId !== sharedDriveId) {
    throw new DriveRouteError("Ressource extérieure au Drive partagé autorisé.", 403);
  }

  const queue = [firstResource];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < 100) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);

    if (allowedRootIds.has(current.id)) return firstResource;

    for (const parentId of current.parents) {
      if (allowedRootIds.has(parentId)) return firstResource;
      if (parentId === sharedDriveId || visited.has(parentId)) continue;

      const parent = await getDriveResourceMetadata(parentId, fetchDrive);

      if (parent.driveId !== sharedDriveId) {
        throw new DriveRouteError("Ressource extérieure au Drive partagé autorisé.", 403);
      }

      queue.push(parent);
    }
  }

  throw new DriveRouteError("Ressource extérieure aux racines Google Drive autorisées.", 403);
}

export function assertDriveFolder(metadata: DriveResourceMetadata) {
  if (metadata.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    throw new DriveRouteError("Le parent Google Drive doit être un dossier autorisé.", 400);
  }
}

export async function getSharedDriveMetadata(fetchDrive: DriveFetch = googleDriveFetch) {
  const sharedDriveId = getSharedDriveId();
  const response = await fetchDrive(
    `${GOOGLE_DRIVE_API_BASE}/drives/${encodeURIComponent(sharedDriveId)}?fields=id,name`,
    { method: "GET" }
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new DriveRouteError(
      getGoogleErrorMessage(payload, "Drive partagé Google introuvable."),
      response.status
    );
  }

  return {
    id: String((payload as Partial<SharedDriveMetadata>).id || sharedDriveId),
    name: String((payload as Partial<SharedDriveMetadata>).name || "")
  } satisfies SharedDriveMetadata;
}

export async function listDriveChildren(
  parentId: string,
  fetchDrive: DriveFetch = googleDriveFetch
) {
  const files: DriveResourceMetadata[] = [];
  let pageToken = "";

  do {
    const query = `'${escapeDriveQuery(parentId)}' in parents and trashed = false`;
    const parameters = new URLSearchParams({
      q: query,
      corpora: "drive",
      driveId: getSharedDriveId(),
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      pageSize: "1000",
      fields: "nextPageToken,files(id,name,mimeType,parents,driveId,webViewLink,size)"
    });

    if (pageToken) parameters.set("pageToken", pageToken);

    const response = await fetchDrive(`${GOOGLE_DRIVE_API_BASE}/files?${parameters.toString()}`, {
      method: "GET"
    });
    const payload = (await response.json().catch(() => ({}))) as DriveListResponse;

    if (!response.ok) {
      throw new DriveRouteError(
        getGoogleErrorMessage(payload, "Lecture du dossier Google Drive impossible."),
        response.status
      );
    }

    for (const file of payload.files || []) {
      files.push({
        id: String(file.id || ""),
        name: String(file.name || ""),
        mimeType: String(file.mimeType || ""),
        parents: Array.isArray(file.parents) ? file.parents.map(String) : [],
        driveId: String(file.driveId || ""),
        webViewLink: file.webViewLink ? String(file.webViewLink) : undefined,
        size: file.size ? String(file.size) : undefined
      });
    }

    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);

  return files;
}

export function sanitizeDriveName(value: unknown, fallback = "Document CRM") {
  const name = String(value || "").trim();
  return name || fallback;
}

export function jsonError(message: string, status = 500) {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: { "cache-control": "private, no-store" }
    }
  );
}

export function driveErrorResponse(error: unknown, fallback: string) {
  if (error instanceof DriveRouteError) {
    return jsonError(error.message, error.status);
  }

  return jsonError(fallback);
}
