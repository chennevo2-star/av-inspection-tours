import { ContextEvent } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";

export type ContextEventType = ContextEvent["type"];

/**
 * Logs one timeline event (spec §12) — room/floor changes, photo captures, recording state changes.
 * These aren't independently synced (there's no "ContextEvent" SyncEntityType — see shared-types/sync.ts)
 * because they're cheap, append-only, and always belong to exactly one Inspection; Phase 4 will carry
 * them as part of that Inspection's own sync payload rather than queuing each one separately.
 */
export async function logContextEvent(
  inspectionId: string,
  type: ContextEventType,
  opts: { floorId?: string | null; roomId?: string | null; refId?: string | null } = {}
): Promise<ContextEvent> {
  const db = getLocalDb();
  // Sequence, not timestamp, is the authoritative ordering — see the ContextEvent schema comment
  // (shared-types/entities.ts) for the real bug this fixed (two events in the same millisecond).
  const sequence = await db.contextEvents.where("inspectionId").equals(inspectionId).count();

  const event = ContextEvent.parse({
    id: crypto.randomUUID(),
    inspectionId,
    sequence,
    type,
    floorId: opts.floorId ?? null,
    roomId: opts.roomId ?? null,
    refId: opts.refId ?? null,
    timestamp: new Date().toISOString(),
  });
  await db.contextEvents.add(event);
  return event;
}

export async function listContextEvents(inspectionId: string): Promise<ContextEvent[]> {
  const events = await getLocalDb().contextEvents.where("inspectionId").equals(inspectionId).toArray();
  return events.sort((a, b) => a.sequence - b.sequence);
}

/**
 * Reconstructs "where is the inspector right now" purely from the latest enter_floor/enter_room events.
 * There is deliberately no separate "current floor/room" field on Inspection — this derivation IS the
 * source of truth, which is also what makes tour Recovery (spec §44) work for free after an app restart:
 * replay the same events, get the same answer, no extra state to have lost.
 */
export async function getCurrentPosition(
  inspectionId: string
): Promise<{ floorId: string | null; roomId: string | null }> {
  const events = await listContextEvents(inspectionId);
  let floorId: string | null = null;
  let roomId: string | null = null;

  for (const event of events) {
    if (event.type === "enter_floor") {
      floorId = event.floorId;
      roomId = null; // moving to a new floor clears the current room until one is entered again
    } else if (event.type === "enter_room") {
      roomId = event.roomId;
      if (event.floorId) floorId = event.floorId;
    }
  }

  return { floorId, roomId };
}
