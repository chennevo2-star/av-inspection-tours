import { describe, expect, it } from "vitest";
import { SyncQueue } from "../src/queue.js";
import { FakeQueueStore, FakeStatusSink, FakeTransport, makeQueueItem } from "./fakes.js";

describe("SyncQueue.drain", () => {
  it("marks a successfully-sent item SYNCED and removes it from the queue", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const transport = new FakeTransport();

    const item = makeQueueItem({ entityType: "Issue", entityId: "11111111-1111-1111-1111-111111111111" });
    await store.enqueue(item);

    const summary = await new SyncQueue(store, transport, statusSink).drain();

    expect(summary).toEqual({ attempted: 1, succeeded: 1, requeued: 0, errored: 0 });
    expect(statusSink.current.get(item.entityId)).toBe("SYNCED");
    expect(await store.listAll()).toEqual([]);
  });

  it("never marks SYNCED before the transport confirms — a failed send stays queued, not deleted", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const item = makeQueueItem({ entityType: "Photo", entityId: "22222222-2222-2222-2222-222222222222" });
    await store.enqueue(item);
    const transport = new FakeTransport({ alwaysFail: new Set([item.entityId]) });

    await new SyncQueue(store, transport, statusSink, { maxAttempts: 5 }).drain();

    // Core data-loss guarantee (OFFLINE_SYNC.md): item is still in the queue, entity is not SYNCED.
    expect(await store.listAll()).toHaveLength(1);
    expect(statusSink.current.get(item.entityId)).not.toBe("SYNCED");
  });

  it("requeues (WAITING_FOR_SYNC) on a retriable failure below the attempt cap", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const item = makeQueueItem({ entityType: "AudioChunk", entityId: "33333333-3333-3333-3333-333333333333" });
    await store.enqueue(item);
    const transport = new FakeTransport({ failFirstNTimes: { [item.entityId]: 1 } });

    const summary1 = await new SyncQueue(store, transport, statusSink, { maxAttempts: 3 }).drain();
    expect(summary1).toEqual({ attempted: 1, succeeded: 0, requeued: 1, errored: 0 });
    expect(statusSink.current.get(item.entityId)).toBe("WAITING_FOR_SYNC");
    expect(await store.listAll()).toHaveLength(1); // still queued — will be retried on the next drain

    // Simulates "internet returns" — a second drain resumes the same item, and this time it succeeds.
    const summary2 = await new SyncQueue(store, transport, statusSink, { maxAttempts: 3 }).drain();
    expect(summary2).toEqual({ attempted: 1, succeeded: 1, requeued: 0, errored: 0 });
    expect(statusSink.current.get(item.entityId)).toBe("SYNCED");
  });

  it("escalates to SYNC_ERROR (visibly, not silently) once maxAttempts is exceeded", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const item = makeQueueItem({ entityType: "Issue", entityId: "44444444-4444-4444-4444-444444444444" });
    await store.enqueue(item);
    const transport = new FakeTransport({ alwaysFail: new Set([item.entityId]) });
    const queue = new SyncQueue(store, transport, statusSink, { maxAttempts: 2 });

    await queue.drain(); // attempt 1 -> requeued
    expect(statusSink.current.get(item.entityId)).toBe("WAITING_FOR_SYNC");

    const summary = await queue.drain(); // attempt 2 -> exceeds maxAttempts(2) -> SYNC_ERROR
    expect(summary.errored).toBe(1);
    expect(statusSink.current.get(item.entityId)).toBe("SYNC_ERROR");
    // Still not deleted — spec §88, no silent data loss. A manual retry can pick it up again later.
    expect(await store.listAll()).toHaveLength(1);
  });

  it("escalates a non-retriable failure to SYNC_ERROR immediately, without waiting for maxAttempts", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const item = makeQueueItem({ entityType: "Task", entityId: "55555555-5555-5555-5555-555555555555" });
    await store.enqueue(item);
    const transport = new FakeTransport({ alwaysFail: new Set([item.entityId]), retriable: false });

    const summary = await new SyncQueue(store, transport, statusSink, { maxAttempts: 5 }).drain();

    expect(summary).toEqual({ attempted: 1, succeeded: 0, requeued: 0, errored: 1 });
    expect(statusSink.current.get(item.entityId)).toBe("SYNC_ERROR");
  });

  it("drains in the required priority order: Inspection, Issue, Task, Photo, AudioChunk, Attachment", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const transport = new FakeTransport();

    // Enqueue deliberately out of order.
    const photo = makeQueueItem({ entityType: "Photo", entityId: "a1111111-1111-1111-1111-111111111111", createdAt: "2026-01-01T10:00:00.000Z" });
    const audioChunk = makeQueueItem({ entityType: "AudioChunk", entityId: "a2222222-2222-2222-2222-222222222222", createdAt: "2026-01-01T09:00:00.000Z" });
    const inspection = makeQueueItem({ entityType: "Inspection", entityId: "a3333333-3333-3333-3333-333333333333", createdAt: "2026-01-01T11:00:00.000Z" });
    const task = makeQueueItem({ entityType: "Task", entityId: "a4444444-4444-4444-4444-444444444444", createdAt: "2026-01-01T08:00:00.000Z" });
    const issue = makeQueueItem({ entityType: "Issue", entityId: "a5555555-5555-5555-5555-555555555555", createdAt: "2026-01-01T12:00:00.000Z" });

    for (const item of [photo, audioChunk, inspection, task, issue]) {
      await store.enqueue(item);
    }

    await new SyncQueue(store, transport, statusSink).drain();

    expect(transport.sentOrder.map((i) => i.entityType)).toEqual([
      "Inspection",
      "Issue",
      "Task",
      "Photo",
      "AudioChunk",
    ]);
  });

  it("a second drain with an empty queue is a safe no-op (idempotent — no duplicate sends)", async () => {
    const store = new FakeQueueStore();
    const statusSink = new FakeStatusSink();
    const transport = new FakeTransport();
    const item = makeQueueItem({ entityType: "Issue", entityId: "66666666-6666-6666-6666-666666666666" });
    await store.enqueue(item);
    const queue = new SyncQueue(store, transport, statusSink);

    await queue.drain();
    const secondSummary = await queue.drain();

    expect(secondSummary).toEqual({ attempted: 0, succeeded: 0, requeued: 0, errored: 0 });
    expect(transport.sentOrder).toHaveLength(1); // the item was only ever sent once
  });
});
