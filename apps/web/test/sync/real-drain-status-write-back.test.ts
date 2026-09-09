import { beforeEach, describe, expect, it } from "vitest";
import { SyncQueue } from "@av-inspection/sync-engine";
import type { SyncQueueItem, SendResult } from "@av-inspection/sync-engine";
import { createProject } from "../../lib/db/projects";
import { createFloor } from "../../lib/db/floors";
import { getLocalDb } from "../../lib/db/local-db";
import { DexieQueueStore } from "../../lib/sync/dexie-queue-store";
import { DexieStatusSink } from "../../lib/sync/dexie-status-sink";
import { resetLocalDb } from "../db/helpers";

beforeEach(resetLocalDb);

/**
 * This file exists because a live sync badge (project list) was once seen staying "🟠 מקומי בלבד" long
 * after the server had genuinely accepted the entity -- which first looked like DexieStatusSink failing
 * to persist "SYNCED" back onto the local record. It doesn't: both tests below prove a real drain against
 * the REAL Dexie-backed store/sink (not the in-memory fakes in packages/sync-engine/test/queue.test.ts)
 * correctly writes SYNCED every time. Root cause, confirmed live (apps/web app, real browser): creating
 * an entity while the app is already open and online does NOT itself trigger a new drain -- syncNow() only
 * runs on initial mount and on the browser's `online` event (see sync-manager.ts's wireAutoSync). The
 * badge was stale only until the next reload/reconnect, not stuck. That gap is a real UX question (should
 * every local write kick off an immediate sync attempt?) rather than a correctness bug -- left alone here,
 * flagged separately rather than "fixed" as if it were the originally-suspected persistence bug.
 *
 * Kept as real regression coverage for the write-back path itself either way, since it wasn't covered
 * against the real Dexie implementation before.
 */
class AlwaysSucceedsTransport {
  sent: SyncQueueItem[] = [];
  async send(item: SyncQueueItem): Promise<SendResult> {
    this.sent.push(item);
    return { ok: true };
  }
}

describe("A real SyncQueue.drain() against the real Dexie-backed store/sink (not the in-memory fakes)", () => {
  it("persists syncStatus: SYNCED back onto the local Project record after a successful drain", async () => {
    const project = await createProject("Biocatch");
    expect(project.syncStatus).toBe("LOCAL_ONLY");

    const transport = new AlwaysSucceedsTransport();
    const queue = new SyncQueue(new DexieQueueStore(), transport, new DexieStatusSink());

    const summary = await queue.drain();

    expect(summary.succeeded).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.entityId).toBe(project.id);

    const afterDrain = await getLocalDb().projects.get(project.id);
    expect(afterDrain?.syncStatus).toBe("SYNCED");

    const queueAfter = await getLocalDb().syncQueue.toArray();
    expect(queueAfter).toHaveLength(0);
  });

  it("also persists SYNCED for a second, differently-typed entity in the same drain (Floor)", async () => {
    const project = await createProject("Biocatch");
    const floor = await createFloor(project.id, "קומה 30");

    const transport = new AlwaysSucceedsTransport();
    const queue = new SyncQueue(new DexieQueueStore(), transport, new DexieStatusSink());
    await queue.drain();

    const projectAfter = await getLocalDb().projects.get(project.id);
    const floorAfter = await getLocalDb().floors.get(floor.id);
    expect(projectAfter?.syncStatus).toBe("SYNCED");
    expect(floorAfter?.syncStatus).toBe("SYNCED");
  });
});
