import path from "node:path";
import { GraphAuth } from "./graph-auth.js";
import { LocalFsStorage } from "./local-fs-storage.js";
import { MsGraphStorage } from "./ms-graph-storage.js";
import { S3Storage } from "./s3-storage.js";
import type { ObjectStorage } from "./types.js";

export type { ObjectStorage } from "./types.js";
export { LocalFsStorage } from "./local-fs-storage.js";
export { S3Storage, type S3StorageConfig } from "./s3-storage.js";
export { GraphAuth, type GraphAuthConfig } from "./graph-auth.js";
export {
  MsGraphStorage,
  type MsGraphStorageConfig,
  type ProjectFolderSet,
  type VisitFolderSet,
  type ProjectInfoJson,
  type VisitJson,
  type GraphUploadResult,
  type GraphFileReference,
} from "./ms-graph-storage.js";
export { sanitizeFilename } from "./sanitize-filename.js";

let _storage: ObjectStorage | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when S3_ENDPOINT is set (see .env.example)`);
  return value;
}

function requireEnvFor(name: string, becauseVar: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when ${becauseVar} is set (see .env.example)`);
  return value;
}

/**
 * Picks a backend, in this precedence order:
 *
 *   1. `MS_GRAPH_TENANT_ID` set → `MsGraphStorage` (SharePoint via Graph). This is now the intended
 *      permanent store (see ms-graph-storage.ts's own top comment) — it wins over `S3_ENDPOINT` if both
 *      happen to be set, since a leftover/forgotten S3 dev config should never silently shadow the real
 *      production path once M365 is configured. There's no legitimate reason to want both active for the
 *      same process at once; if that ever changes (e.g. a genuine dual-write migration period), this is
 *      the function to revisit, not a place to quietly special-case around.
 *   2. Else `S3_ENDPOINT` set (ADR-007) → real S3-compatible storage (AWS S3 / R2 / MinIO).
 *   3. Else → local filesystem, the zero-install dev fallback.
 *
 * Same overall pattern as packages/db's `getDb()`: a single env-driven switch, memoized after first call.
 */
export function getStorage(): ObjectStorage {
  if (_storage) return _storage;

  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  if (tenantId) {
    const auth = new GraphAuth({
      tenantId,
      clientId: requireEnvFor("MS_GRAPH_CLIENT_ID", "MS_GRAPH_TENANT_ID"),
      clientSecret: requireEnvFor("MS_GRAPH_CLIENT_SECRET", "MS_GRAPH_TENANT_ID"),
    });

    const siteId = process.env.MS_GRAPH_SITE_ID;
    const siteHostname = process.env.MS_GRAPH_SITE_HOSTNAME;
    const sitePath = process.env.MS_GRAPH_SITE_PATH;
    if (!siteId && !(siteHostname && sitePath)) {
      throw new Error(
        "MS_GRAPH_SITE_ID (or both MS_GRAPH_SITE_HOSTNAME and MS_GRAPH_SITE_PATH) is required when MS_GRAPH_TENANT_ID is set (see .env.example)"
      );
    }

    _storage = new MsGraphStorage({
      auth,
      siteId,
      siteHostname,
      sitePath,
      driveName: process.env.MS_GRAPH_DRIVE_NAME ?? "Documents",
      rootFolder: process.env.MS_GRAPH_ROOT_FOLDER ?? "סיורי פיקוח",
    });
    return _storage;
  }

  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint) {
    _storage = new S3Storage({
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: requireEnv("S3_BUCKET"),
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
    return _storage;
  }

  const rootDir = process.env.LOCAL_UPLOADS_DIR ?? path.resolve(process.cwd(), ".local-uploads");
  const publicBaseUrl = process.env.LOCAL_UPLOADS_BASE_URL ?? "/api/files";
  _storage = new LocalFsStorage(rootDir, publicBaseUrl);
  return _storage;
}

/** Exposes the concrete LocalFsStorage instance when that's the active backend — used only by
 * apps/web's file-serving route to resolve a key to a real path. Returns null under S3Storage (there is
 * no local path to resolve; the client should be using the signed URL instead). */
export function getLocalFsStorageIfActive(): LocalFsStorage | null {
  const storage = getStorage();
  return storage instanceof LocalFsStorage ? storage : null;
}
