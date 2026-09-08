import { SYNC_ENTITY_PRIORITY, type SyncQueueItem } from "@av-inspection/shared-types";
import type { EntityStatusSink, QueueStore, SyncQueueOptions, SyncTransport } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 5;

export interface DrainSummary {
  attempted: number;
  succeeded: number;
  requeued: number; // transient failure, will retry automatically
  errored: number; // escalated to SYNC_ERROR, needs a manual retry or investigation
}

/**
 * Drains the local sync queue in the order required by /OFFLINE_SYNC.md: Inspection metadata → Issues →
 * Tasks → Photos → Audio chunks → other attachments, oldest-first within the same entity type.
 *
 * This class knows nothing about IndexedDB, fetch, or the DOM — it only talks to the QueueStore /
 * SyncTransport / EntityStatusSink interfaces it's given, so it can be unit-tested with in-memory fakes
 * (see test/queue.test.ts) and reused verbatim by the real Dexie-backed app.
 */
export class SyncQueue {
  private readonly maxAttempts: number;

  constructor(
    private readonly store: QueueStore,
    private readonly transport: SyncTransport,
    private readonly statusSink: EntityStatusSink,
    options: SyncQueueOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** One drain pass: attempts every item currently queued, once each, in priority order. */
  async drain(): Promise<DrainSummary> {
    const items = await this.sortedPending();
    const summary: DrainSummary = { attempted: 0, succeeded: 0, requeued: 0, errored: 0 };

    for (const item of items) {
      summary.attempted++;
      await this.statusSink.setStatus(item.entityType, item.entityId, "UPLOADING");

      const result = await this.transport.send(item);

      if (result.ok) {
        await this.store.remove(item.id);
        await this.statusSink.setStatus(item.entityType, item.entityId, "SYNCED");
        summary.succeeded++;
        continue;
      }

      const attempts = item.attempts + 1;
      await this.store.recordAttempt(item.id, attempts, result.error);

      // A non-retriable error (e.g. server rejected the payload as invalid) escalates immediately —
      // no point retrying the exact same request. A retriable error escalates only after maxAttempts.
      if (!result.retriable || attempts >= this.maxAttempts) {
        await this.statusSink.setStatus(item.entityType, item.entityId, "SYNC_ERROR", result.error);
        summary.errored++;
      } else {
        await this.statusSink.setStatus(item.entityType, item.entityId, "WAITING_FOR_SYNC", result.error);
        summary.requeued++;
      }
    }

    return summary;
  }

  private async sortedPending(): Promise<SyncQueueItem[]> {
    const items = await this.store.listAll();
    return [...items].sort((a, b) => {
      const priorityDelta = SYNC_ENTITY_PRIORITY[a.entityType] - SYNC_ENTITY_PRIORITY[b.entityType];
      if (priorityDelta !== 0) return priorityDelta;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }
}
