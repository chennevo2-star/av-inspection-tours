import { AudioChunk, Photo } from "@av-inspection/shared-types";
import { audioChunks, getDb, photos } from "@av-inspection/db";
import { getStorage } from "@av-inspection/storage";
import { extensionForMimeType } from "./mime.js";

/** Same shape as JsonSyncHandler (sync-entities.ts) but for the two entities that carry a Blob
 * (spec §18 — audio/photos never go through the JSON path, never inlined into Postgres). */
export interface FileSyncHandler {
  upsert(rawMeta: unknown, file: File): Promise<void>;
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
    async upsert(rawMeta: unknown, file: File) {
      const entity = schema.parse(rawMeta);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = `${keyPrefix}/${entity.id}.${extensionForMimeType(file.type)}`;
      await getStorage().put(key, bytes, file.type);

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
};
