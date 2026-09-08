import path from "node:path";
import { LocalFsStorage } from "./local-fs-storage.js";
import { S3Storage } from "./s3-storage.js";
import type { ObjectStorage } from "./types.js";

export type { ObjectStorage } from "./types.js";
export { LocalFsStorage } from "./local-fs-storage.js";
export { S3Storage, type S3StorageConfig } from "./s3-storage.js";

let _storage: ObjectStorage | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when S3_ENDPOINT is set (see .env.example)`);
  return value;
}

/**
 * Picks a backend by whether `S3_ENDPOINT` is set (ADR-007) — same pattern as packages/db's `getDb()`.
 * Set → real S3-compatible storage. Unset → local filesystem, the path actually exercised in this
 * project's own dev environment so far.
 */
export function getStorage(): ObjectStorage {
  if (_storage) return _storage;

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
