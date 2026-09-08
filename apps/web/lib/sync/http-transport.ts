import type { SendResult, SyncTransport } from "@av-inspection/sync-engine";
import type { SyncQueueItem } from "@av-inspection/shared-types";
import { getLocalDb } from "../db/local-db";

const BLOB_TABLE_FOR_ENTITY: Partial<Record<string, "photoBlobs" | "audioChunkBlobs">> = {
  Photo: "photoBlobs",
  AudioChunk: "audioChunkBlobs",
};

/**
 * The real transport behind packages/sync-engine's SyncQueue — talks to
 * apps/web/app/api/sync/[entityType]/route.ts. Photo/AudioChunk items carry their Blob's local table +
 * key inside their own payload (see lib/db/photos.ts, lib/recording/use-audio-recorder.ts) — this class
 * is what actually reads the Blob out of Dexie and attaches it as multipart form data; every other
 * entity is a plain JSON POST.
 */
export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly baseUrl: string = "/api/sync") {}

  async send(item: SyncQueueItem): Promise<SendResult> {
    try {
      const response = await this.doSend(item);

      if (response.ok) return { ok: true };

      // 4xx = the server rejected this exact payload; retrying the same bytes won't help (non-retriable).
      // Anything else (5xx, etc.) is treated as transient.
      const retriable = response.status >= 500;
      let error = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) error = body.error;
      } catch {
        // Response wasn't JSON — keep the generic HTTP-status error above.
      }
      return { ok: false, retriable, error };
    } catch (err) {
      if (err instanceof NonRetriableTransportError) {
        // A local precondition failed (missing/deleted blob) — retrying the same item won't fix that.
        return { ok: false, retriable: false, error: err.message };
      }
      // Anything else means fetch() itself threw — a network failure (offline, DNS, timeout) — always
      // retriable; the item stays queued and the next drain (or "↻ סנכרן עכשיו") picks it up again.
      return { ok: false, retriable: true, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  private async doSend(item: SyncQueueItem): Promise<Response> {
    const blobTableName = BLOB_TABLE_FOR_ENTITY[item.entityType];

    if (!blobTableName) {
      return fetch(`${this.baseUrl}/${item.entityType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload ?? {}),
      });
    }

    const localFileId = (item.payload as Record<string, unknown> | undefined)?.localFileId as
      | string
      | undefined;
    if (!localFileId) {
      // Malformed queue item — retrying won't fix a missing field. Thrown (not returned) so send()'s
      // catch block can route it to the non-retriable branch below, same as the missing-blob case.
      throw new NonRetriableTransportError("Missing localFileId on a file-carrying queue item");
    }

    const blobRow = await getLocalDb()[blobTableName].get(localFileId);
    if (!blobRow) {
      throw new NonRetriableTransportError(`Local blob ${localFileId} no longer exists on this device`);
    }

    const formData = new FormData();
    formData.append("meta", JSON.stringify(item.payload));
    formData.append("file", blobRow.blob, localFileId);
    return fetch(`${this.baseUrl}/${item.entityType}`, { method: "POST", body: formData });
  }
}

class NonRetriableTransportError extends Error {}
