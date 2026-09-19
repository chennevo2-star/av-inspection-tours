import { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";
import { deleteInspection } from "./inspections";

/**
 * Creates a project purely locally — no network call in the critical path (ADR-002). It's queued for
 * sync immediately (see lib/sync/enqueue.ts); nothing actually drains that queue until Phase 4.
 */
export async function createProject(name: string): Promise<Project> {
  const now = new Date().toISOString();
  const project = Project.parse({
    id: crypto.randomUUID(),
    name,
    status: "פעיל",
    offlineReady: false,
    createdAt: now,
    updatedAt: now,
    syncStatus: "LOCAL_ONLY",
  });
  await getLocalDb().projects.add(project);
  await enqueueSync("Project", project.id, "create", project);
  return project;
}

export async function listProjects(): Promise<Project[]> {
  return getLocalDb().projects.orderBy("updatedAt").reverse().toArray();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return getLocalDb().projects.get(id);
}

/** Partial update — merges `patch` onto the existing project, bumps `updatedAt`, re-queues for sync. */
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "projectNumber" | "client" | "address" | "description" | "status">>
): Promise<Project> {
  const db = getLocalDb();
  const existing = await db.projects.get(id);
  if (!existing) throw new Error(`updateProject: project ${id} not found locally`);

  const updated = Project.parse({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
    syncStatus: existing.syncStatus === "SYNCED" ? "WAITING_FOR_SYNC" : existing.syncStatus,
  });
  await db.projects.put(updated);
  await enqueueSync("Project", id, "update", updated);
  return updated;
}

/**
 * Deletes a project and everything it owns locally (user request: "אפשר מחיקת פרויקטים") -- every one of
 * its tours (reusing `deleteInspection()`, which already cascades each tour's own context
 * events/notes/issues/tasks/photos/audio/attachments correctly), then its floors/rooms and
 * contractors/aliases, then the project itself. Real cloud propagation too, same as tour deletion: the
 * server's own FK `onDelete: "cascade"` chain from `projects.id` (packages/db/src/schema.ts) already
 * reaches every one of these tables, so deleting just the project row server-side is enough -- no
 * per-child delete needs to be queued separately.
 *
 * Deliberately NOT touched: `contractorBank`/`contractorCategories` -- both are cross-project convenience
 * lists (see their own doc comments in shared-types), never scoped to a single project, so deleting one
 * project must never remove entries other projects still rely on.
 */
export async function deleteProject(id: string): Promise<void> {
  const db = getLocalDb();

  // Each deleteInspection() call is its own transaction, run to completion before the next starts --
  // simpler and safer than re-deriving that whole cascade by hand here, and it already purges each tour's
  // stale sync-queue items and enqueues its own "delete" correctly.
  const inspections = await db.inspections.where("projectId").equals(id).toArray();
  for (const inspection of inspections) {
    await deleteInspection(inspection.id);
  }

  const floors = await db.floors.where("projectId").equals(id).toArray();
  const roomLists = await Promise.all(floors.map((f) => db.rooms.where("floorId").equals(f.id).toArray()));
  const rooms = roomLists.flat();
  const contractors = await db.contractors.where("projectId").equals(id).toArray();
  const aliasLists = await Promise.all(
    contractors.map((c) => db.contractorAliases.where("contractorId").equals(c.id).toArray())
  );
  const aliases = aliasLists.flat();

  await db.transaction(
    "rw",
    [db.projects, db.floors, db.rooms, db.contractors, db.contractorAliases, db.syncQueue],
    async () => {
      await db.rooms.bulkDelete(rooms.map((r) => r.id));
      await db.floors.bulkDelete(floors.map((f) => f.id));
      await db.contractorAliases.bulkDelete(aliases.map((a) => a.id));
      await db.contractors.bulkDelete(contractors.map((c) => c.id));
      await db.projects.delete(id);

      const deletedIds = [id, ...floors.map((f) => f.id), ...rooms.map((r) => r.id), ...contractors.map((c) => c.id), ...aliases.map((a) => a.id)];
      const staleQueueItems = await db.syncQueue.where("entityId").anyOf(deletedIds).toArray();
      await db.syncQueue.bulkDelete(staleQueueItems.map((item) => item.id));

      await enqueueSync("Project", id, "delete");
    }
  );
}
