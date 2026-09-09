import { Inspector } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";

/**
 * The "bank" of supervisors/inspectors (session's user request — "בנק חותמות של מפקחים"): a reusable,
 * cross-project list, each with an optional embeddable stamp image that appears on a generated report's
 * closing page. Deliberately local-only (no enqueueSync) — see the Inspector type's own doc comment.
 */
export async function createInspector(name: string): Promise<Inspector> {
  const inspector = Inspector.parse({
    id: crypto.randomUUID(),
    name,
    stampLocalFileId: null,
  });
  await getLocalDb().inspectors.add(inspector);
  return inspector;
}

export async function listInspectors(): Promise<Inspector[]> {
  const inspectors = await getLocalDb().inspectors.toArray();
  return inspectors.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export async function getInspector(id: string): Promise<Inspector | undefined> {
  return getLocalDb().inspectors.get(id);
}

export async function renameInspector(id: string, name: string): Promise<Inspector> {
  const db = getLocalDb();
  const existing = await db.inspectors.get(id);
  if (!existing) throw new Error(`renameInspector: inspector ${id} not found locally`);
  const updated = Inspector.parse({ ...existing, name });
  await db.inspectors.put(updated);
  return updated;
}

/** Replaces (or sets, for the first time) this inspector's stamp image. */
export async function setInspectorStamp(id: string, blob: Blob): Promise<Inspector> {
  const db = getLocalDb();
  const existing = await db.inspectors.get(id);
  if (!existing) throw new Error(`setInspectorStamp: inspector ${id} not found locally`);

  const localFileId = crypto.randomUUID();
  await db.inspectorStampBlobs.add({ id: localFileId, blob });

  const previousFileId = existing.stampLocalFileId;
  const updated = Inspector.parse({ ...existing, stampLocalFileId: localFileId });
  await db.inspectors.put(updated);
  // Clean up the old blob now that nothing references it -- an inspector rarely swaps stamps, but no
  // reason to let orphaned blobs accumulate in IndexedDB when it does happen.
  if (previousFileId) await db.inspectorStampBlobs.delete(previousFileId);
  return updated;
}

export async function getInspectorStampBlob(localFileId: string): Promise<Blob | undefined> {
  const row = await getLocalDb().inspectorStampBlobs.get(localFileId);
  return row?.blob;
}

export async function deleteInspector(id: string): Promise<void> {
  const db = getLocalDb();
  const existing = await db.inspectors.get(id);
  await db.transaction("rw", db.inspectors, db.inspectorStampBlobs, async () => {
    if (existing?.stampLocalFileId) await db.inspectorStampBlobs.delete(existing.stampLocalFileId);
    await db.inspectors.delete(id);
  });
}
