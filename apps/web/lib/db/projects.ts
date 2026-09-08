import { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";

/**
 * Creates a project purely locally — no network call in the critical path (ADR-002). It is enqueued for
 * sync implicitly by staying `LOCAL_ONLY`; the actual sync-queue wiring for Project happens in Phase 2
 * (Projects) alongside the API route it would sync to — this function is the honest Phase 1 slice: real
 * local persistence, nothing faked, sync not yet wired.
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
  return project;
}

export async function listProjects(): Promise<Project[]> {
  return getLocalDb().projects.orderBy("updatedAt").reverse().toArray();
}
