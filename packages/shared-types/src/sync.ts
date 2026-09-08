import { z } from "zod";

/**
 * Sync status for every syncable entity. See /OFFLINE_SYNC.md — this is the single source of truth,
 * used identically by the client sync engine (packages/sync-engine) and any status UI.
 *
 * LOCAL_ONLY      — written locally, not yet enqueued (should be momentary in practice)
 * WAITING_FOR_SYNC — enqueued, not yet attempted (or requeued after a transient failure)
 * UPLOADING       — actively in flight to the server
 * SYNCED          — server has confirmed receipt
 * SYNC_ERROR      — failed repeatedly / needs user attention (never silently dropped, see spec §88)
 */
export const SyncStatus = z.enum([
  "LOCAL_ONLY",
  "WAITING_FOR_SYNC",
  "UPLOADING",
  "SYNCED",
  "SYNC_ERROR",
]);
export type SyncStatus = z.infer<typeof SyncStatus>;

/** Entity types that can appear in the sync queue, in their required drain order (OFFLINE_SYNC.md). */
export const SyncEntityType = z.enum([
  "Inspection",
  "Issue",
  "Task",
  "Photo",
  "AudioChunk",
  "Attachment",
]);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

/** Fixed drain priority — lower number goes first. Mirrors SyncEntityType's declared order. */
export const SYNC_ENTITY_PRIORITY: Record<SyncEntityType, number> = {
  Inspection: 0,
  Issue: 1,
  Task: 2,
  Photo: 3,
  AudioChunk: 4,
  Attachment: 5,
};

export const SyncOp = z.enum(["create", "update"]);
export type SyncOp = z.infer<typeof SyncOp>;

/**
 * One item in the local sync queue (packages/sync-engine drains this table). `payload` carries the
 * entity's own JSON-serializable fields; large binary data (photo/audio) is referenced via
 * `localBlobRef` and uploaded as a file, never inlined here.
 */
export const SyncQueueItem = z.object({
  id: z.string().uuid(), // queue item id, distinct from entityId
  entityType: SyncEntityType,
  entityId: z.string().uuid(),
  op: SyncOp,
  payload: z.record(z.unknown()).optional(),
  localBlobRef: z.string().optional(), // Dexie table+key reference for a Blob, if any
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SyncQueueItem = z.infer<typeof SyncQueueItem>;
