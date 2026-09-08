import { Photo } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

/**
 * Saves a captured photo purely locally (spec §13): the Blob goes straight into IndexedDB
 * (`photoBlobs`, ADR-003 — never base64-encoded into the Photo row itself), and the Photo record is
 * queued for sync immediately alongside it. There is no client-side compression yet (REPORTING.md's
 * storage-policy note: a tunable to revisit once real photos are flowing) and no upload — Phase 4.
 */
export async function capturePhoto(
  inspectionId: string,
  blob: Blob,
  ctx: {
    floorId?: string | null;
    roomId?: string | null;
    issueId?: string | null;
    taskId?: string | null;
    caption?: string | null;
  } = {}
): Promise<Photo> {
  const db = getLocalDb();
  const localFileId = crypto.randomUUID();
  await db.photoBlobs.add({ id: localFileId, blob });

  const photo = Photo.parse({
    id: crypto.randomUUID(),
    inspectionId,
    floorId: ctx.floorId ?? null,
    roomId: ctx.roomId ?? null,
    issueId: ctx.issueId ?? null,
    taskId: ctx.taskId ?? null,
    timestamp: new Date().toISOString(),
    caption: ctx.caption ?? null,
    localFileId,
    cloudFileId: null,
    syncStatus: "LOCAL_ONLY",
  });
  await db.photos.add(photo);
  // Payload deliberately excludes the blob itself — Phase 4's real transport will read it separately via
  // localFileId + localBlobRef (see OFFLINE_SYNC.md "Large files"), never inline a Blob into queue JSON.
  await enqueueSync("Photo", photo.id, "create", { ...photo });
  return photo;
}

export async function listPhotos(inspectionId: string): Promise<Photo[]> {
  const photos = await getLocalDb().photos.where("inspectionId").equals(inspectionId).toArray();
  return photos.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getPhotoBlob(localFileId: string): Promise<Blob | undefined> {
  const row = await getLocalDb().photoBlobs.get(localFileId);
  return row?.blob;
}
