import { Task } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

/** Quick field-created task (spec §10 "✅ משימה"), not tied to a specific Issue. */
export async function createTask(
  projectId: string,
  inspectionId: string,
  description: string,
  responsibleParty: string | null = null
): Promise<Task> {
  const db = getLocalDb();
  const existingCount = await db.tasks.where("projectId").equals(projectId).count();

  const task = Task.parse({
    id: crypto.randomUUID(),
    issueId: null,
    projectId,
    friendlyNumber: existingCount + 1,
    description,
    responsibleParty,
    status: "פתוח",
    createdInspectionId: inspectionId,
    lastUpdatedInspectionId: null,
    closedInspectionId: null,
    dueDate: null,
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
