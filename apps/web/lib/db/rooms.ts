import { Room } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export async function createRoom(
  floorId: string,
  name: string,
  roomNumber: string | null = null,
  roomType: string | null = null
): Promise<Room> {
  const room = Room.parse({
    id: crypto.randomUUID(),
    floorId,
    name,
    roomNumber,
    roomType,
    syncStatus: "LOCAL_ONLY",
  });
  await getLocalDb().rooms.add(room);
  await enqueueSync("Room", room.id, "create", room);
  return room;
}

export async function listRooms(floorId: string): Promise<Room[]> {
  return getLocalDb().rooms.where("floorId").equals(floorId).toArray();
}

export async function deleteRoom(id: string): Promise<void> {
  // See floors.ts's deleteFloor comment — same known gap: local delete isn't sync-propagated yet
  // (SyncOp has no "delete" op until Phase 4 defines real delete semantics against a live server).
  await getLocalDb().rooms.delete(id);
}
