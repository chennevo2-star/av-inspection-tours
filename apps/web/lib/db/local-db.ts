import Dexie, { type Table } from "dexie";
import type {
  Audio,
  AudioChunk,
  Contractor,
  ContractorAlias,
  ContextEvent,
  Floor,
  Inspection,
  Issue,
  Photo,
  Project,
  Room,
  SyncQueueItem,
  Task,
} from "@av-inspection/shared-types";

/** A raw Blob row — used for both photo and audio-chunk local storage (ADR-003: Blobs, not base64). */
export interface BlobRow {
  id: string;
  blob: Blob;
}

/**
 * The local, offline-first database. See /OFFLINE_SYNC.md and ADR-003. Every table mirrors a
 * packages/shared-types entity 1:1 — if you add/change a field there, update the corresponding index
 * list below only if it needs to be queryable (Dexie doesn't require every field to be indexed).
 */
export class LocalDb extends Dexie {
  projects!: Table<Project, string>;
  floors!: Table<Floor, string>;
  rooms!: Table<Room, string>;
  contractors!: Table<Contractor, string>;
  contractorAliases!: Table<ContractorAlias, string>;
  inspections!: Table<Inspection, string>;
  contextEvents!: Table<ContextEvent, string>;
  issues!: Table<Issue, string>;
  tasks!: Table<Task, string>;
  photos!: Table<Photo, string>;
  photoBlobs!: Table<BlobRow, string>;
  audio!: Table<Audio, string>;
  audioChunks!: Table<AudioChunk, string>;
  audioChunkBlobs!: Table<BlobRow, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("av-inspection-tours");
    this.version(1).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, status, syncStatus",
      photos: "id, inspectionId, roomId, issueId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      syncQueue: "id, entityType, entityId, createdAt",
    });
  }
}

let instance: LocalDb | null = null;

/**
 * Lazily creates the single LocalDb instance. Must only be called from client code (event handlers,
 * effects, or a render guarded by a "mounted" flag) — IndexedDB doesn't exist during Next.js server-side
 * rendering, so calling this at module-evaluation time or during an unguarded server render throws.
 */
export function getLocalDb(): LocalDb {
  if (typeof window === "undefined") {
    throw new Error(
      "getLocalDb() called outside the browser. Local storage is client-only — guard the call site with " +
        "a mounted/isClient check (see apps/web/app/home-screen.tsx for the pattern)."
    );
  }
  if (!instance) instance = new LocalDb();
  return instance;
}
