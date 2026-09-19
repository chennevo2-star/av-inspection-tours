import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, inspections } from "@av-inspection/db";
import { ensureDbReady } from "../../../../../lib/server/ensure-db-ready";

/**
 * DELETE side of the sync protocol (user request: tour deletion should also delete from the cloud) --
 * see SyncOp's own comment in shared-types for why this only actually does something for "Inspection"
 * right now, and packages/db/src/schema.ts's tasks/photos/attachments comments for the real FK `onDelete`
 * behavior that makes one row delete here correctly cascade every child row server-side (context events,
 * notes, issues, the tasks/photos/audio/attachments this inspection created) without this route needing
 * to delete each table itself in the right order.
 *
 * Idempotent by the same rule every other sync route follows (spec §17): deleting an id that's already
 * gone (a retried request, or one that raced an earlier successful delete) is a success, not an error --
 * `drizzle`'s delete-by-id is naturally a no-op when nothing matches, so this needs no extra existence
 * check to be idempotent.
 */
export async function DELETE(_request: Request, props: { params: Promise<{ entityType: string; entityId: string }> }) {
  const { entityType, entityId } = await props.params;

  if (entityType !== "Inspection") {
    return NextResponse.json(
      { error: `Delete sync isn't implemented for entity type "${entityType}" yet` },
      { status: 400 }
    );
  }

  try {
    await ensureDbReady();
    await getDb().delete(inspections).where(eq(inspections.id, entityId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[sync] ${entityType} delete failed:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
