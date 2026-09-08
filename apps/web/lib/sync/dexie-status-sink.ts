import type { EntityStatusSink } from "@av-inspection/sync-engine";
import type { SyncEntityType, SyncStatus } from "@av-inspection/shared-types";
import { getLocalDb } from "../db/local-db";

type LocalDbTableName =
  | "projects"
  | "floors"
  | "rooms"
  | "contractors"
  | "inspections"
  | "issues"
  | "tasks"
  | "notes"
  | "photos"
  | "audioChunks";

/** Which local table (and therefore which entity actually has a `syncStatus` field) each SyncEntityType
 * maps to. ContractorAlias and Attachment are deliberately absent — see the class comment below. */
const TABLE_FOR_ENTITY: Partial<Record<SyncEntityType, LocalDbTableName>> = {
  Project: "projects",
  Floor: "floors",
  Room: "rooms",
  Contractor: "contractors",
  Inspection: "inspections",
  Issue: "issues",
  Task: "tasks",
  Note: "notes",
  Photo: "photos",
  AudioChunk: "audioChunks",
};

/**
 * Writes sync status back onto the local entity row the queue item is about (so the UI's 🟠/✅ badges
 * update live). `ContractorAlias` has no `syncStatus` field on its own (a deliberate simplicity choice,
 * see shared-types/entities.ts) and `Attachment` has no concrete implementation yet — both are safe
 * no-ops here: the queue item still drains normally, there's just no per-row badge to update.
 */
export class DexieStatusSink implements EntityStatusSink {
  async setStatus(entityType: SyncEntityType, entityId: string, status: SyncStatus): Promise<void> {
    const tableName = TABLE_FOR_ENTITY[entityType];
    if (!tableName) return;

    const db = getLocalDb();
    // Heterogeneous table map — every table listed in TABLE_FOR_ENTITY genuinely has a
    // `syncStatus: SyncStatus` field (see shared-types/entities.ts), which is what makes this narrow
    // cast safe despite the tables otherwise holding structurally different entities.
    const table = db[tableName] as unknown as {
      update: (id: string, changes: { syncStatus: SyncStatus }) => Promise<number>;
    };
    await table.update(entityId, { syncStatus: status });
  }
}
