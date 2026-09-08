import { Floor } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export async function createFloor(
  projectId: string,
  name: string,
  floorNumber: number | null = null
): Promise<Floor> {
  const db = getLocalDb();
  const existingCount = await db.floors.where("projectId").equals(projectId).count();

  const floor = Floor.parse({
    id: crypto.randomUUID(),
    projectId,
    name,
    floorNumber,
    sortOrder: existingCount,
    syncStatus: "LOCAL_ONLY",
  });
  await db.floors.add(floor);
  await enqueueSync("Floor", floor.id, "create", floor);
  return floor;
}

export async function listFloors(projectId: string): Promise<Floor[]> {
  const floors = await getLocalDb().floors.where("projectId").equals(projectId).toArray();
  return floors.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function deleteFloor(id: string): Promise<void> {
  const db = getLocalDb();
  // Cascade locally so the UI never shows orphaned rooms — mirrors the server's ON DELETE CASCADE
  // (packages/db/src/schema.ts) so local and eventual server state can't diverge in shape.
  const rooms = await db.rooms.where("floorId").equals(id).toArray();
  await db.transaction("rw", db.floors, db.rooms, async () => {
    await db.rooms.bulkDelete(rooms.map((r) => r.id));
    await db.floors.delete(id);
  });
  // A delete is still a sync-worthy fact — Phase 4 will need a real "delete" op once a server round-trip
  // exists; not modeled in SyncOp yet (today's SyncOp is create|update only, see ADR-005/shared-types).
  // Flagged here rather than silently doing nothing, per CLAUDE.md's no-mock-success rule.
}
