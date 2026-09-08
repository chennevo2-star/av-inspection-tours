import type { QueueStore } from "@av-inspection/sync-engine";
import type { SyncQueueItem } from "@av-inspection/shared-types";
import { getLocalDb } from "../db/local-db";

/** The Dexie-backed QueueStore packages/sync-engine's SyncQueue drains against — see ADR-005. */
export class DexieQueueStore implements QueueStore {
  async enqueue(item: SyncQueueItem): Promise<void> {
    await getLocalDb().syncQueue.add(item);
  }

  async listAll(): Promise<SyncQueueItem[]> {
    return getLocalDb().syncQueue.toArray();
  }

  async recordAttempt(id: string, attempts: number, lastError: string | null): Promise<void> {
    await getLocalDb().syncQueue.update(id, { attempts, lastError, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    await getLocalDb().syncQueue.delete(id);
  }
}
