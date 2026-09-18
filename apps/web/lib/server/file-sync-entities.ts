import { Attachment, AudioChunk, Photo } from "@av-inspection/shared-types";
import { attachments, audioChunks, getDb, photos } from "@av-inspection/db";
import { getStorage } from "@av-inspection/storage";
import { extensionForMimeType } from "./mime.js";

/** Same shape as JsonSyncHandler (sync-entities.ts) but for the two entities that carry binary data
 * (spec §18 — audio/photos never go through the JSON path, never inlined into Postgres). Takes raw
 * bytes + a mime type directly (not a `File`/multipart) — see the route's own comment for why. */
export interface FileSyncHandler {
  upsert(rawMeta: unknown, bytes: Uint8Array, contentType: string): Promise<void>;
}

const isoToDate = (iso: string) => new Date(iso);

/** See sync-entities.ts's `handler()` comment for why `table: any` is the deliberate boundary here. */
function fileHandler<T extends { id: string }>(
  schema: { parse: (input: unknown) => T },
  table: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  keyPrefix: string,
  toRow: (entity: T, cloudFileId: string) => Record<string, unknown>
): FileSyncHandler {
  return {
    async upsert(rawMeta: unknown, bytes: Uint8Array, contentType: string) {
      const entity = schema.parse(rawMeta);
      const key = `${keyPrefix}/${entity.id}.${extensionForMimeType(contentType)}`;
      await getStorage().put(key, bytes, contentType);

      const row = toRow(entity, key);
      await getDb().insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row });
    },
  };
}

export const FILE_SYNC_HANDLERS: Partial<Record<string, FileSyncHandler>> = {
  Photo: fileHandler(Photo, photos, "photos", (p, cloudFileId) => ({
    id: p.id,
    inspectionId: p.inspectionId,
    floorId: p.floorId,
    roomId: p.roomId,
    issueId: p.issueId,
    taskId: p.taskId,
    timestamp: isoToDate(p.timestamp),
    caption: p.caption,
    cloudFileId,
  })),

  AudioChunk: fileHandler(AudioChunk, audioChunks, "audio-chunks", (c, cloudFileId) => ({
    id: c.id,
    audioId: c.audioId,
    inspectionId: c.inspectionId,
    sequence: c.sequence,
    startTime: isoToDate(c.startTime),
    endTime: c.endTime ? isoToDate(c.endTime) : null,
    floorId: c.floorId,
    roomId: c.roomId,
    cloudFileId,
  })),

  // Closes a real, pre-existing gap: "Attachment" was already reserved in SyncEntityType/
  // SYNC_ENTITY_PRIORITY (shared-types/src/sync.ts) but never had a concrete handler until now.
  Attachment: fileHandler(Attachment, attachments, "attachments", (a, cloudFileId) => ({
    id: a.id,
    inspectionId: a.inspectionId,
    floorId: a.floorId,
    roomId: a.roomId,
    taskId: a.taskId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    timestamp: isoToDate(a.timestamp),
    cloudFileId,
  })),
};
