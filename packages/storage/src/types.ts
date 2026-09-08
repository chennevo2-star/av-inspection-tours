/**
 * Object storage abstraction (ARCHITECTURE.md — audio/photos never go into Postgres). Two
 * implementations: `S3Storage` (real, spec §18/§45 — AWS S3 / Cloudflare R2 / real MinIO) and
 * `LocalFsStorage` (ADR-007 — zero-install local dev fallback). `getStorage()` in index.ts picks one
 * based on environment; callers should never import either implementation directly.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  /** Reads the object's bytes directly — for server-side processing (e.g. packages/ai-pipeline handing
   * audio bytes to a transcription provider), not for a browser client (which should use
   * getSignedGetUrl() instead, so the bytes never pass through this server twice). */
  get(key: string): Promise<Buffer>;
  /** A URL the client can GET the object from. Real signed/expiring for S3Storage; see LocalFsStorage's
   * own comment for why its version is not real access control. */
  getSignedGetUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
