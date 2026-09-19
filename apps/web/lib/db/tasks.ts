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
 * Every task created during one specific tour, in creation order (first task added first — the "טבלת
 * משימות" screen; user-requested direction, matches reading a numbered list top to bottom). Sorted by
 * `friendlyNumber` (a real monotonic per-project counter), not `timestamp` — the same class of bug
 * already hit once with ContextEvent applies here too: two tasks created in quick succession could land
 * on the same millisecond, making timestamp-only ordering unstable.
 */
export async function listTasksForInspection(inspectionId: string): Promise<Task[]> {
  const tasks = await getLocalDb().tasks.where("createdInspectionId").equals(inspectionId).toArray();
  return tasks.sort((a, b) => (a.friendlyNumber ?? 0) - (b.friendlyNumber ?? 0));
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

/**
 * Field-text edits made on the report screen's task table (user request: those edits must actually save
 * back to the real task, not just shape one export) -- deliberately narrow to the fields the report
 * screen's row editor actually exposes as real Task columns (description/responsibleParty/status);
 * floorName/roomName there are display-only derived strings with no direct write path back to
 * Floor/Room, so they're never accepted here.
 */
export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "description" | "responsibleParty" | "status">>
): Promise<Task> {
  const db = getLocalDb();
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error(`updateTask: task ${id} not found locally`);

  const updated = Task.parse({
    ...existing,
    ...patch,
    syncStatus: existing.syncStatus === "SYNCED" ? "WAITING_FOR_SYNC" : existing.syncStatus,
  });
  await db.tasks.put(updated);
  await enqueueSync("Task", id, "update", updated);
  return updated;
}

/**
 * Real, permanent task deletion (user request: deleting a task from either the tasks table or the summary
 * report must delete it in both -- previously the report screen's own delete only ever hid the row from
 * that one export, per its old doc comment; this replaces that with a real delete). Photos/attachments
 * that were tagged to this task are kept but detached (taskId cleared), mirroring the server's own
 * `onDelete: "set null"` FK behavior for exactly the same reason (packages/db/src/schema.ts) -- a task
 * being removed shouldn't take its photos down with it.
 */
export async function deleteTask(id: string): Promise<void> {
  const db = getLocalDb();
  await db.transaction("rw", db.tasks, db.photos, db.attachments, db.syncQueue, async () => {
    const existing = await db.tasks.get(id);
    if (!existing) return; // already gone locally -- idempotent, matches deleteInspection()'s own rule

    const [taggedPhotos, taggedAttachments] = await Promise.all([
      db.photos.where("taskId").equals(id).toArray(),
      db.attachments.where("taskId").equals(id).toArray(),
    ]);
    await Promise.all([
      ...taggedPhotos.map((p) => db.photos.update(p.id, { taskId: null })),
      ...taggedAttachments.map((a) => db.attachments.update(a.id, { taskId: null })),
    ]);

    await db.tasks.delete(id);

    const staleQueueItems = await db.syncQueue.where("entityId").equals(id).toArray();
    await db.syncQueue.bulkDelete(staleQueueItems.map((item) => item.id));

    await enqueueSync("Task", id, "delete");
  });
}
