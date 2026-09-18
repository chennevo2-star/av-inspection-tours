import { Attachment } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

/**
 * Saves a generic attached file purely locally (spec §32 "קבצים מצורפים") — same pattern as
 * capturePhoto (lib/db/photos.ts): the Blob goes straight into IndexedDB (`attachmentBlobs`, ADR-003 —
 * never base64-encoded into the Attachment row itself), and the Attachment record is queued for sync
 * immediately alongside it.
 */
export async function addAttachment(
  inspectionId: string,
  file: Blob,
  fileName: string,
  ctx: {
    floorId?: string | null;
    roomId?: string | null;
    taskId?: string | null;
  } = {}
): Promise<Attachment> {
  const db = getLocalDb();
  const localFileId = crypto.randomUUID();
  await db.attachmentBlobs.add({ id: localFileId, blob: file });

  const attachment = Attachment.parse({
    id: crypto.randomUUID(),
    inspectionId,
    floorId: ctx.floorId ?? null,
    roomId: ctx.roomId ?? null,
    taskId: ctx.taskId ?? null,
    fileName,
    mimeType: file.type || "application/octet-stream",
    timestamp: new Date().toISOString(),
    localFileId,
    cloudFileId: null,
    syncStatus: "LOCAL_ONLY",
  });
  await db.attachments.add(attachment);
  // Payload excludes the blob itself, same as Photo — the real transport (http-transport.ts) reads it
  // separately via localFileId + BLOB_TABLE_FOR_ENTITY, never inlining a Blob into queue JSON.
  await enqueueSync("Attachment", attachment.id, "create", { ...attachment });
  return attachment;
}

export async function listAttachments(inspectionId: string): Promise<Attachment[]> {
  const rows = await getLocalDb().attachments.where("inspectionId").equals(inspectionId).toArray();
  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getAttachmentBlob(localFileId: string): Promise<Blob | undefined> {
  const row = await getLocalDb().attachmentBlobs.get(localFileId);
  return row?.blob;
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = getLocalDb();
  const attachment = await db.attachments.get(id);
  if (!attachment) return;
  await db.transaction("rw", db.attachments, db.attachmentBlobs, async () => {
    await db.attachmentBlobs.delete(attachment.localFileId);
    await db.attachments.delete(id);
  });
  // Same known gap as floors/rooms/contractors (see their own deleteX comments): local delete isn't
  // sync-propagated to the server yet (SyncOp has no "delete" op) — flagged, not silently pretended away.
}
