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
  Note,
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
  notes!: Table<Note, string>;
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
    // v2 (Phase 3): adds the Note table. A pure addition — every v1 store is repeated unchanged, per
    // Dexie's versioning contract, so existing local data survives the upgrade untouched.
    this.version(2).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, status, syncStatus",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
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
  // Checking `indexedDB` specifically (not `window`) is the precise guard: it throws correctly during
  // real Next.js SSR (neither exists there), passes correctly in a real browser, AND lets
  // apps/web/test/** exercise this whole module under plain Node + fake-indexeddb without needing a
  // heavier jsdom environment — see vitest.setup.ts.
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "getLocalDb() called with no IndexedDB available. In the app, guard the call site with a " +
        "mounted/isClient check (see apps/web/app/home-screen.tsx for the pattern); in a test, import " +
        "'fake-indexeddb/auto' first (see vitest.setup.ts)."
    );
  }
  if (!instance) instance = new LocalDb();
  return instance;
}
