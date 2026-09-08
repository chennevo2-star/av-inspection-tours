import type { SyncEntityType, SyncQueueItem, SyncStatus } from "@av-inspection/shared-types";

/**
 * Storage adapter the queue runs against. In the real app this is backed by Dexie
 * (apps/web/lib/db); tests use an in-memory fake (test/fakes.ts). Keeping this abstract is what makes
 * the queue's ordering/retry logic testable without a browser — see /OFFLINE_SYNC.md and ADR-005.
 */
export interface QueueStore {
  enqueue(item: SyncQueueItem): Promise<void>;
  /** All items currently in the queue, in no particular order — SyncQueue does the priority sort. */
  listAll(): Promise<SyncQueueItem[]>;
  recordAttempt(id: string, attempts: number, lastError: string | null): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Result of attempting to send one queue item to the server. */
export type SendResult =
  | { ok: true }
  | { ok: false; retriable: boolean; error: string };

/**
 * Uploads a single queue item. Implementations must be idempotent server-side, keyed by
 * `item.entityId` — a retried send of an already-confirmed item must be a no-op, not a duplicate
 * (spec §17 "duplicate upload").
 */
export interface SyncTransport {
  send(item: SyncQueueItem): Promise<SendResult>;
}

/** Where the queue reports the sync status of the underlying entity (Issue, Photo, ...), not the queue item itself. */
export interface EntityStatusSink {
  setStatus(
    entityType: SyncEntityType,
    entityId: string,
    status: SyncStatus,
    lastError?: string | null
  ): Promise<void>;
}

export interface SyncQueueOptions {
  /** Attempts (including the first) before an item is escalated from WAITING_FOR_SYNC to SYNC_ERROR. */
  maxAttempts?: number;
}
