import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, inspections, projects, tasks, photos } from "@av-inspection/db";
import { getStorage } from "@av-inspection/storage";
import { ensureDbReady } from "../../../../../lib/server/ensure-db-ready";

/**
 * DELETE side of the sync protocol (user request: tour/task/project deletion should also delete from the
 * cloud) -- see SyncOp's own comment in shared-types for which entity types this actually covers, and
 * packages/db/src/schema.ts's own FK `onDelete` comments for the cascade/set-null behavior that makes one
 * row delete here correctly ripple through every child row server-side without this route needing to
 * delete each table itself in the right order (Project cascades through floors/contractors/inspections and
 * everything those own in turn; Inspection cascades through its own context events/notes/issues/tasks/
 * photos/audio/attachments; Task only detaches photos/attachments via `set null`, it owns no rows itself).
 *
 * Idempotent by the same rule every other sync route follows (spec §17): deleting an id that's already
 * gone (a retried request, or one that raced an earlier successful delete) is a success, not an error --
 * `drizzle`'s delete-by-id is naturally a no-op when nothing matches, so this needs no extra existence
 * check to be idempotent.
 */
const DELETE_HANDLERS: Partial<Record<string, (id: string) => Promise<void>>> = {
  Inspection: async (id) => {
    await getDb().delete(inspections).where(eq(inspections.id, id));
  },
  Task: async (id) => {
    await getDb().delete(tasks).where(eq(tasks.id, id));
  },
  Project: async (id) => {
    await getDb().delete(projects).where(eq(projects.id, id));
  },
  // Real bug closed here (user request, 2026-09-19: deleting a photo from the task edit screen must
  // actually delete it, not just hide it locally) -- Photo carries a real uploaded file (see
  // file-sync-entities.ts), so deleting the DB row alone would leave it orphaned in cloud storage
  // forever. `cloudFileId` is null for a photo that was captured but never finished syncing yet (still
  // LOCAL_ONLY/WAITING_FOR_SYNC) -- nothing to delete remotely in that case, the DB row delete is enough.
  Photo: async (id) => {
    const [row] = await getDb().select({ cloudFileId: photos.cloudFileId }).from(photos).where(eq(photos.id, id));
    if (row?.cloudFileId) {
      await getStorage().delete(row.cloudFileId);
    }
    await getDb().delete(photos).where(eq(photos.id, id));
  },
};

export async function DELETE(_request: Request, props: { params: Promise<{ entityType: string; entityId: string }> }) {
  const { entityType, entityId } = await props.params;

  const deleteById = DELETE_HANDLERS[entityType];
  if (!deleteById) {
    return NextResponse.json(
      { error: `Delete sync isn't implemented for entity type "${entityType}" yet` },
      { status: 400 }
    );
  }

  try {
    await ensureDbReady();
    await deleteById(entityId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[sync] ${entityType} delete failed:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
