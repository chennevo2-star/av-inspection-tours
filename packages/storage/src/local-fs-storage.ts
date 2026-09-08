import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "./types.js";

/** Rejects/strips anything that could escape `rootDir` (`..`, an absolute path). */
function sanitizeKey(key: string): string {
  const normalized = path.posix.normalize(key);
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe object key: ${key}`);
  }
  return normalized;
}

/**
 * Zero-install local dev fallback (ADR-007) — writes real files to disk, served by apps/web's
 * `app/api/files/[...key]/route.ts`. This is what actually runs in this project's own dev environment
 * (no Docker available); swap to `S3Storage` by setting `S3_ENDPOINT` once real S3/MinIO is available.
 *
 * `getSignedGetUrl()` here is **not real access control** — it returns a plain fetchable URL, no
 * signature, no expiry. That's an honest, deliberate gap (see ADR-007), not an oversight: don't point
 * this at genuinely sensitive data before switching to `S3Storage`'s real presigned URLs.
 */
export class LocalFsStorage implements ObjectStorage {
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string
  ) {}

  async put(key: string, body: Buffer | Uint8Array, _contentType: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    const filePath = path.join(this.rootDir, safeKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  async getSignedGetUrl(key: string): Promise<string> {
    const safeKey = sanitizeKey(key);
    return `${this.publicBaseUrl}/${safeKey}`;
  }

  async delete(key: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    await rm(path.join(this.rootDir, safeKey), { force: true });
  }

  /** Used only by apps/web's serving route — resolves a key to the real file path, safely. */
  resolvePath(key: string): string {
    return path.join(this.rootDir, sanitizeKey(key));
  }
}
