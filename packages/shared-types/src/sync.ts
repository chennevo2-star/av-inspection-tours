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

/**
 * Entity types that can appear in the sync queue, in their required drain order (OFFLINE_SYNC.md).
 * Project/Floor/Room/Contractor were added in Phase 2: the original spec's drain order (§17) only names
 * Inspection/Issue/Task/Photo/AudioChunk/Attachment because it's written from the field-work point of
 * view, but §16 states every object gets a sync status, and in this app Projects/Contractors/Floors/
 * Rooms can genuinely be created or edited locally (a project manager working offline, or a field
 * addition mid-tour) — so they queue too. They drain first because everything else references them by
 * id; the server needs the reference data to exist before it can accept an Inspection/Issue/Task/Photo
 * that points at it.
 */
export const SyncEntityType = z.enum([
  "Project",
  "Floor",
  "Room",
  "Contractor",
  "ContractorAlias",
  "Inspection",
  "Issue",
  "Task",
  "Note",
  "Audio",
  "Photo",
  "AudioChunk",
  "Attachment",
]);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

/**
 * Fixed drain priority — lower number goes first. Mirrors SyncEntityType's declared order.
 * `Audio` must drain before `AudioChunk` — a real bug (found via real-device testing, not by
 * inspection) was every AudioChunk permanently failing its FK check because the parent Audio row was
 * never actually synced at all (an earlier version of this file's comment, and of
 * lib/recording/use-audio-recorder.ts, claimed the server would "upsert Audio from the first chunk it
 * receives" — that was never implemented; Audio gets a real, ordinary sync lifecycle instead, same as
 * every other entity).
 */
export const SYNC_ENTITY_PRIORITY: Record<SyncEntityType, number> = {
  Project: 0,
  Floor: 1,
  Room: 2,
  Contractor: 3,
  ContractorAlias: 4,
  Inspection: 5,
  Issue: 6,
  Task: 7,
  Note: 8,
  Audio: 9,
  Photo: 10,
  AudioChunk: 11,
  Attachment: 12,
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
