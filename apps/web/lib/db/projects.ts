import { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

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
