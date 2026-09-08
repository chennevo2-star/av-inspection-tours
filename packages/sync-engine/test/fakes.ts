import type { SyncEntityType, SyncQueueItem, SyncStatus } from "@av-inspection/shared-types";
import type { EntityStatusSink, QueueStore, SendResult, SyncTransport } from "../src/types.js";

/** In-memory QueueStore for tests — no IndexedDB, no browser. */
export class FakeQueueStore implements QueueStore {
  items = new Map<string, SyncQueueItem>();

  async enqueue(item: SyncQueueItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async listAll(): Promise<SyncQueueItem[]> {
    return [...this.items.values()];
  }

  async recordAttempt(id: string, attempts: number, lastError: string | null): Promise<void> {
    const item = this.items.get(id);
    if (!item) throw new Error(`recordAttempt: unknown queue item ${id}`);
    this.items.set(id, { ...item, attempts, lastError, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/** In-memory EntityStatusSink for tests — records every status transition so tests can assert on it. */
export class FakeStatusSink implements EntityStatusSink {
  current = new Map<string, SyncStatus>();
  history: { entityType: SyncEntityType; entityId: string; status: SyncStatus; error?: string | null }[] = [];

  async setStatus(
    entityType: SyncEntityType,
    entityId: string,
    status: SyncStatus,
    lastError: string | null = null
  ): Promise<void> {
    this.current.set(entityId, status);
    this.history.push({ entityType, entityId, status, error: lastError });
  }
}

/**
 * Configurable fake transport: `failFirstNTimes` per entityId lets a test simulate "fails twice then
 * succeeds" (retry/resume behavior); `retriable` controls whether a failure should be retried at all.
 */
export class FakeTransport implements SyncTransport {
  sentOrder: SyncQueueItem[] = [];
  private failuresRemaining = new Map<string, number>();

  constructor(private opts: { failFirstNTimes?: Record<string, number>; retriable?: boolean; alwaysFail?: Set<string> } = {}) {
    for (const [entityId, n] of Object.entries(opts.failFirstNTimes ?? {})) {
      this.failuresRemaining.set(entityId, n);
    }
  }

  async send(item: SyncQueueItem): Promise<SendResult> {
    this.sentOrder.push(item);

    if (this.opts.alwaysFail?.has(item.entityId)) {
      return { ok: false, retriable: this.opts.retriable ?? true, error: "simulated permanent failure" };
    }

    const remaining = this.failuresRemaining.get(item.entityId) ?? 0;
    if (remaining > 0) {
      this.failuresRemaining.set(item.entityId, remaining - 1);
      return { ok: false, retriable: this.opts.retriable ?? true, error: "simulated transient failure" };
    }

    return { ok: true };
  }
}

export function makeQueueItem(overrides: Partial<SyncQueueItem> & Pick<SyncQueueItem, "entityType" | "entityId">): SyncQueueItem {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    entityType: overrides.entityType,
    entityId: overrides.entityId,
    op: overrides.op ?? "create",
    payload: overrides.payload,
    localBlobRef: overrides.localBlobRef,
    attempts: overrides.attempts ?? 0,
    lastError: overrides.lastError ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}
