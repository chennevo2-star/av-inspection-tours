import { Inspection } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

/**
 * Starts a new inspection purely locally (ADR-002) — no network call in the critical path. Friendly
 * inspection number is derived from the local count of the project's own inspections; it's a display
 * number only (spec §31), the real join key is always the UUID.
 */
export async function startInspection(
  projectId: string,
  inspector: string,
  participants: string[] = [],
  inspectorId: string | null = null
): Promise<Inspection> {
  const db = getLocalDb();
  const existingCount = await db.inspections.where("projectId").equals(projectId).count();
  const now = new Date();

  const inspection = Inspection.parse({
    id: crypto.randomUUID(),
    projectId,
    inspectionNumber: existingCount + 1,
    date: now.toISOString().slice(0, 10),
    startTime: now.toISOString(),
    endTime: null,
    inspector,
    inspectorId,
    participants,
    status: "בתהליך",
    syncStatus: "LOCAL_ONLY",
    aiStatus: "לא_רלוונטי",
    reportStatus: "לא_הופק",
  });
  await db.inspections.add(inspection);
  await enqueueSync("Inspection", inspection.id, "create", inspection);
  return inspection;
}

/**
 * Appends a name to the inspection's participant list if it isn't already there (e.g. the New Task
 * wizard's "add manually" option for "באחריות") — grows the list in place so the new name is available
 * for the rest of this tour's tasks too, not just a one-off value.
 */
export async function addParticipant(inspectionId: string, name: string): Promise<Inspection> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("addParticipant: name must not be empty");

  const db = getLocalDb();
  const existing = await db.inspections.get(inspectionId);
  if (!existing) throw new Error(`addParticipant: inspection ${inspectionId} not found locally`);
  if (existing.participants.includes(trimmed)) return existing;

  const updated = Inspection.parse({
    ...existing,
    participants: [...existing.participants, trimmed],
    syncStatus: existing.syncStatus === "SYNCED" ? "WAITING_FOR_SYNC" : existing.syncStatus,
  });
  await db.inspections.put(updated);
  await enqueueSync("Inspection", inspectionId, "update", updated);
  return updated;
}

export async function getInspection(id: string): Promise<Inspection | undefined> {
  return getLocalDb().inspections.get(id);
}

/** The project's own in-progress inspection, if any (endTime === null) — used to resume rather than duplicate. */
export async function getActiveInspectionForProject(projectId: string): Promise<Inspection | undefined> {
  const rows = await getLocalDb()
    .inspections.where("projectId")
    .equals(projectId)
    .and((i) => i.endTime === null)
    .toArray();
  return rows.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
}

/**
 * Any in-progress inspection across every project on this device — powers the home screen's
 * "נמצא סיור שלא הסתיים" recovery banner (spec §44), which needs to work regardless of which project
 * screen the user happens to land on after reopening the app.
 */
export async function getAnyActiveInspection(): Promise<Inspection | undefined> {
  const rows = await getLocalDb().inspections.filter((i) => i.endTime === null).toArray();
  return rows.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
}

export async function endInspection(id: string): Promise<Inspection> {
  const db = getLocalDb();
  const existing = await db.inspections.get(id);
  if (!existing) throw new Error(`endInspection: inspection ${id} not found locally`);

  const updated = Inspection.parse({
    ...existing,
    endTime: new Date().toISOString(),
    status: "הסתיים_מקומית",
    syncStatus: existing.syncStatus === "SYNCED" ? "WAITING_FOR_SYNC" : existing.syncStatus,
  });
  await db.inspections.put(updated);
  await enqueueSync("Inspection", id, "update", updated);
  return updated;
}
