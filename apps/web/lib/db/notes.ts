import { Note } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export async function createNote(
  inspectionId: string,
  projectId: string,
  text: string,
  ctx: { floorId?: string | null; roomId?: string | null } = {}
): Promise<Note> {
  const note = Note.parse({
    id: crypto.randomUUID(),
    inspectionId,
    projectId,
    floorId: ctx.floorId ?? null,
    roomId: ctx.roomId ?? null,
    text,
    timestamp: new Date().toISOString(),
    syncStatus: "LOCAL_ONLY",
  });
  await getLocalDb().notes.add(note);
  await enqueueSync("Note", note.id, "create", note);
  return note;
}

export async function listNotes(inspectionId: string): Promise<Note[]> {
  const notes = await getLocalDb().notes.where("inspectionId").equals(inspectionId).toArray();
  return notes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
