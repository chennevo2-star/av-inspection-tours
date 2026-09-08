import { Task } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export interface CreateTaskInput {
  projectId: string;
  inspectionId: string;
  description: string;
  responsibleParty?: string | null;
  floorId?: string | null;
  roomId?: string | null;
}

/** Field-created task (spec §10 "✅ משימה" / the New Task wizard), not tied to a specific Issue. */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  const db = getLocalDb();
  const existingCount = await db.tasks.where("projectId").equals(input.projectId).count();

  const task = Task.parse({
    id: crypto.randomUUID(),
    issueId: null,
    projectId: input.projectId,
    floorId: input.floorId ?? null,
    roomId: input.roomId ?? null,
    friendlyNumber: existingCount + 1,
    description: input.description,
    responsibleParty: input.responsibleParty ?? null,
    status: "פתוח",
    createdInspectionId: input.inspectionId,
    lastUpdatedInspectionId: null,
    closedInspectionId: null,
    dueDate: null,
    timestamp: new Date().toISOString(),
    syncStatus: "LOCAL_ONLY",
  });
  await db.tasks.add(task);
  await enqueueSync("Task", task.id, "create", task);
  return task;
}

/** Open/in-progress/waiting tasks for the "משימות פתוחות" list (spec §27–28). */
export async function listOpenTasks(projectId: string): Promise<Task[]> {
  const tasks = await getLocalDb().tasks.where("projectId").equals(projectId).toArray();
  return tasks.filter((t) => t.status === "פתוח" || t.status === "בטיפול" || t.status === "ממתין");
}

/**
 * Every task created during one specific tour, most-recently-created first (the "טבלת משימות" screen).
 * Sorted by `friendlyNumber` (a real monotonic per-project counter), not `timestamp` — the same class of
 * bug already hit once with ContextEvent applies here too: two tasks created in quick succession could
 * land on the same millisecond, making timestamp-only ordering unstable.
 */
export async function listTasksForInspection(inspectionId: string): Promise<Task[]> {
  const tasks = await getLocalDb().tasks.where("createdInspectionId").equals(inspectionId).toArray();
  return tasks.sort((a, b) => (b.friendlyNumber ?? 0) - (a.friendlyNumber ?? 0));
}

/** Closes a previously-open task from the current inspection (spec §27 — "סגור משימה #14"). */
export async function closeTask(id: string, closedInspectionId: string): Promise<Task> {
  const db = getLocalDb();
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error(`closeTask: task ${id} not found locally`);

  const updated = Task.parse({
    ...existing,
    status: "הושלם",
    lastUpdatedInspectionId: closedInspectionId,
    closedInspectionId,
    syncStatus: existing.syncStatus === "SYNCED" ? "WAITING_FOR_SYNC" : existing.syncStatus,
  });
  await db.tasks.put(updated);
  await enqueueSync("Task", id, "update", updated);
  return updated;
}
