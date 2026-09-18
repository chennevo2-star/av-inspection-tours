import { eq } from "drizzle-orm";
import { Attachment, AudioChunk, Photo } from "@av-inspection/shared-types";
import { attachments, audioChunks, getDb, inspections, photos, projects } from "@av-inspection/db";
import { getStorage, MsGraphStorage, type VisitFolderSet } from "@av-inspection/storage";
import { extensionForMimeType } from "./mime.js";

/** Same shape as JsonSyncHandler (sync-entities.ts) but for the two entities that carry binary data
 * (spec §18 — audio/photos never go through the JSON path, never inlined into Postgres). Takes raw
 * bytes + a mime type directly (not a `File`/multipart) — see the route's own comment for why. */
export interface FileSyncHandler {
  upsert(rawMeta: unknown, bytes: Uint8Array, contentType: string): Promise<void>;
}

const isoToDate = (iso: string) => new Date(iso);

type VisitSubfolder = "photos" | "audio" | "attachments";

/**
 * Resolves (and idempotently creates) the real SharePoint folder structure for one inspection's uploads
 * — ONLY reached when the active backend is `MsGraphStorage` (see `fileHandler`'s branch below;
 * LocalFsStorage/S3Storage have no folder concept and keep using a flat key, unchanged). Real DB lookups
 * (an inspection's own project name is needed for `ensureProjectFolders`/`ensureVisitFolder`'s path
 * construction) — an unavoidable per-upload cost of the rich structure, and worth it: it's the difference
 * between a file landing at a flat, human-illegible key versus `.../פרויקטים/<project>/סיורים/<date>/...`
 * (spec §21-32).
 */
async function resolveVisitFolders(storage: MsGraphStorage, inspectionId: string): Promise<VisitFolderSet> {
  const db = getDb();
  const [inspectionRow] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
  if (!inspectionRow) {
    throw new Error(`Cannot resolve a Microsoft 365 folder: inspection ${inspectionId} not found`);
  }
  const [projectRow] = await db.select().from(projects).where(eq(projects.id, inspectionRow.projectId));
  if (!projectRow) {
    throw new Error(`Cannot resolve a Microsoft 365 folder: project ${inspectionRow.projectId} not found`);
  }
  // Idempotent (lookup-first internally) -- safe to call on every single upload rather than caching,
  // and simpler/more robust than trying to cache across requests in a serverless-friendly route.
  await storage.ensureProjectFolders({ name: projectRow.name });
  return storage.ensureVisitFolder({ name: projectRow.name }, { id: inspectionId, date: inspectionRow.date });
}

/** See sync-entities.ts's `handler()` comment for why `table: any` is the deliberate boundary here. */
function fileHandler<T extends { id: string; inspectionId: string }>(
  schema: { parse: (input: unknown) => T },
  table: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  keyPrefix: string,
  visitSubfolder: VisitSubfolder,
  toRow: (entity: T, cloudFileId: string) => Record<string, unknown>,
  /** Real file name to use when uploading through MsGraphStorage (irrelevant for the flat-key backends
   * below, which have always just used `${id}.${ext}`). Defaults to that same id-based name; Attachment
   * overrides this with its own real `fileName` since that's a human-chosen name worth preserving in
   * SharePoint, unlike Photo/AudioChunk which never had one. */
  displayFileName: (entity: T, contentType: string) => string = (entity, contentType) =>
    `${entity.id}.${extensionForMimeType(contentType)}`
): FileSyncHandler {
  return {
    async upsert(rawMeta: unknown, bytes: Uint8Array, contentType: string) {
      const entity = schema.parse(rawMeta);
      const storage = getStorage();
      let cloudFileId: string;

      if (storage instanceof MsGraphStorage) {
        const visitFolders = await resolveVisitFolders(storage, entity.inspectionId);
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const uploaded = await storage.uploadFile(
          visitFolders[visitSubfolder].path,
          displayFileName(entity, contentType),
          buffer,
          contentType
        );
        // `key` (not `itemId`/`webUrl`) is exactly what the plain ObjectStorage interface's
        // get()/getSignedGetUrl()/delete() expect back — see GraphUploadResult's own doc comment for why
        // this is what keeps every existing storage.get(cloudFileId) call site (e.g.
        // packages/ai-pipeline/src/orchestrator.ts) working unmodified regardless of which backend is active.
        cloudFileId = uploaded.key;
      } else {
        const key = `${keyPrefix}/${entity.id}.${extensionForMimeType(contentType)}`;
        await storage.put(key, bytes, contentType);
        cloudFileId = key;
      }

      const row = toRow(entity, cloudFileId);
      await getDb().insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row });
    },
  };
}

export const FILE_SYNC_HANDLERS: Partial<Record<string, FileSyncHandler>> = {
  Photo: fileHandler(Photo, photos, "photos", "photos", (p, cloudFileId) => ({
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

  AudioChunk: fileHandler(AudioChunk, audioChunks, "audio-chunks", "audio", (c, cloudFileId) => ({
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
  Attachment: fileHandler(
    Attachment,
    attachments,
    "attachments",
    "attachments",
    (a, cloudFileId) => ({
      id: a.id,
      inspectionId: a.inspectionId,
      floorId: a.floorId,
      roomId: a.roomId,
      taskId: a.taskId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      timestamp: isoToDate(a.timestamp),
      cloudFileId,
    }),
    // Unlike Photo/AudioChunk (which never had a human-chosen name), Attachment always carries a real
    // one worth preserving in SharePoint rather than the generic id-based fallback.
    (a) => a.fileName
  ),
};
