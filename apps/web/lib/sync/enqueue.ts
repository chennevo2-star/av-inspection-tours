import type { SyncEntityType, SyncOp } from "@av-inspection/shared-types";
import { getLocalDb } from "../db/local-db";

/**
 * Appends one item to the local sync queue (see /OFFLINE_SYNC.md). This is the client-side half of the
 * "Local Write → Queue" step — every entity-create/update function in apps/web/lib/db calls this in the
 * same logical operation as its own local write, never as an afterthought.
 *
 * No transport drains this queue yet (that's Phase 4 — packages/sync-engine's SyncQueue needs a real
 * SyncTransport implementation wired to API routes that don't exist yet). Enqueueing now is still real
 * and correct: it's exactly the durable, replayable record Phase 4 will drain, and it means nothing
 * written in Phase 2/3 is silently unsynceable once Phase 4 lands — no data written today needs to be
 * migrated or backfilled later.
 */
export async function enqueueSync(
  entityType: SyncEntityType,
  entityId: string,
  op: SyncOp,
  payload?: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  await getLocalDb().syncQueue.add({
    id: crypto.randomUUID(),
    entityType,
    entityId,
    op,
    payload,
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}
