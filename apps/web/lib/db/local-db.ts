import Dexie, { type Table } from "dexie";
import type {
  Attachment,
  Audio,
  AudioChunk,
  Contractor,
  ContractorAlias,
  ContractorBankEntry,
  ContractorCategory,
  ContextEvent,
  Floor,
  Inspection,
  Inspector,
  Issue,
  Note,
  Photo,
  Project,
  Room,
  SyncQueueItem,
  Task,
} from "@av-inspection/shared-types";

/** One row in the local-only `settings` table — arbitrary small app preferences (never secrets: the
 * Microsoft Graph client secret lives server-side only, see packages/storage/src/graph-auth.ts; this is
 * things like "prepare all active projects automatically" toggles). Keyed by a plain string, not synced. */
export interface SettingRow {
  key: string;
  value: unknown;
}

/** One row in the local-only `syncMetadata` table — bookkeeping for incremental pull-sync (spec §9):
 * the last time reference data for a given project was successfully pulled down, so a later pull can ask
 * the server for "what changed since then" instead of re-downloading everything. Not synced itself (it
 * describes this device's own sync progress, nothing the server needs to know). */
export interface SyncMetadataRow {
  /** `${projectId}:${entityType}`, e.g. "11111111-...:Floor" — one row per project per reference-data type. */
  key: string;
  projectId: string;
  entityType: string;
  lastPulledAt: string; // ISO datetime
}

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
  contractorBank!: Table<ContractorBankEntry, string>;
  contractorCategories!: Table<ContractorCategory, string>;
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
  inspectors!: Table<Inspector, string>;
  inspectorStampBlobs!: Table<BlobRow, string>;
  attachments!: Table<Attachment, string>;
  attachmentBlobs!: Table<BlobRow, string>;
  settings!: Table<SettingRow, string>;
  syncMetadata!: Table<SyncMetadataRow, string>;
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
    // v3: Task gains floorId/roomId/timestamp (the new task wizard's data model — see PROJECT
    // memory/commit history for "New Task wizard" for why). Existing task rows just get these as
    // undefined/missing until edited, which is fine — the fields are all optional/nullable.
    this.version(3).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
      photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      syncQueue: "id, entityType, entityId, createdAt",
    });
    // v4: Inspector "bank" (session's user request — a reusable list of supervisors with an embeddable
    // stamp image for the closing page of a generated report). Local-only, no syncStatus/enqueueSync —
    // see the Inspector type's own doc comment in shared-types for why.
    this.version(4).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
      photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      inspectors: "id, name",
      inspectorStampBlobs: "id",
      syncQueue: "id, entityType, entityId, createdAt",
    });
    // v5 (Microsoft 365 offline upgrade, 2026-09-18): Attachment finally gets a real table (it was
    // already reserved in SyncEntityType/shared-types/sync.ts but never implemented — see Attachment's
    // own doc comment in entities.ts). `settings` and `syncMetadata` are new, local-only tables (never
    // synced to the server themselves) supporting the offline/multi-project work — see their own
    // interface doc comments above (SettingRow, SyncMetadataRow).
    this.version(5).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
      photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      inspectors: "id, name",
      inspectorStampBlobs: "id",
      attachments: "id, inspectionId, floorId, roomId, taskId, syncStatus",
      attachmentBlobs: "id",
      settings: "key",
      syncMetadata: "key, projectId, entityType",
      syncQueue: "id, entityType, entityId, createdAt",
    });
    // v6 (session's user request): a cross-project contractor "bank", same role ContractorBankEntry's own
    // doc comment describes Inspector already playing for supervisors -- adding a contractor to one
    // project also registers it here so the next project can pick it instead of retyping. Local-only, same
    // reasoning as `inspectors` above (see ContractorBankEntry's own comment in shared-types).
    this.version(6).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      contractorBank: "id, companyName",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
      photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      inspectors: "id, name",
      inspectorStampBlobs: "id",
      attachments: "id, inspectionId, floorId, roomId, taskId, syncStatus",
      attachmentBlobs: "id",
      settings: "key",
      syncMetadata: "key, projectId, entityType",
      syncQueue: "id, entityType, entityId, createdAt",
    });
    // v7 (session's user request): a managed contractor-category list, used to group/filter the
    // contractor bank and to let a category be created deliberately rather than only implied by whatever
    // free text someone typed into `field` before -- see ContractorCategory's own doc comment in
    // shared-types for why `field` itself stays a plain string rather than becoming a real foreign key.
    this.version(7).stores({
      projects: "id, status, updatedAt",
      floors: "id, projectId, sortOrder",
      rooms: "id, floorId",
      contractors: "id, projectId",
      contractorAliases: "id, contractorId, alias",
      contractorBank: "id, companyName",
      contractorCategories: "id, name",
      inspections: "id, projectId, status, endTime",
      contextEvents: "id, inspectionId, sequence, timestamp",
      issues: "id, inspectionId, projectId, roomId, status, syncStatus",
      tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
      notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
      photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
      photoBlobs: "id",
      audio: "id, inspectionId, syncStatus",
      audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
      audioChunkBlobs: "id",
      inspectors: "id, name",
      inspectorStampBlobs: "id",
      attachments: "id, inspectionId, floorId, roomId, taskId, syncStatus",
      attachmentBlobs: "id",
      settings: "key",
      syncMetadata: "key, projectId, entityType",
      syncQueue: "id, entityType, entityId, createdAt",
    });
    // v8 (session's user request, 2026-09-19): a task can now be shared by MULTIPLE contractors --
    // Task.responsibleParty (a single nullable string) became responsibleParties (string[]). Unlike
    // every earlier version bump here, this ISN'T a purely additive change: code now reads
    // task.responsibleParties.length/.join()/etc unconditionally, so an existing local row that still has
    // the old field (and is missing the new one) would throw at runtime, not just show a blank value.
    // `.upgrade()` runs once per device, real data preserved: an existing name becomes a one-element
    // array, a null/missing one becomes `[]` -- the exact same conversion migration 0009 does server-side
    // (packages/db/migrations/0009_odd_wasp.sql) for the same field on the same real production data.
    this.version(8)
      .stores({
        projects: "id, status, updatedAt",
        floors: "id, projectId, sortOrder",
        rooms: "id, floorId",
        contractors: "id, projectId",
        contractorAliases: "id, contractorId, alias",
        contractorBank: "id, companyName",
        contractorCategories: "id, name",
        inspections: "id, projectId, status, endTime",
        contextEvents: "id, inspectionId, sequence, timestamp",
        issues: "id, inspectionId, projectId, roomId, status, syncStatus",
        tasks: "id, projectId, issueId, floorId, createdInspectionId, status, syncStatus, timestamp",
        notes: "id, inspectionId, projectId, roomId, timestamp, syncStatus",
        photos: "id, inspectionId, roomId, issueId, taskId, syncStatus",
        photoBlobs: "id",
        audio: "id, inspectionId, syncStatus",
        audioChunks: "id, audioId, inspectionId, sequence, syncStatus",
        audioChunkBlobs: "id",
        inspectors: "id, name",
        inspectorStampBlobs: "id",
        attachments: "id, inspectionId, floorId, roomId, taskId, syncStatus",
        attachmentBlobs: "id",
        settings: "key",
        syncMetadata: "key, projectId, entityType",
        syncQueue: "id, entityType, entityId, createdAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table("tasks")
          .toCollection()
          .modify((task: Task & { responsibleParty?: string | null }) => {
            const legacy = task.responsibleParty;
            task.responsibleParties = legacy ? [legacy] : [];
            delete task.responsibleParty;
          });
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
