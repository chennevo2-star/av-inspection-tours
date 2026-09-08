import { getLocalDb } from "../../lib/db/local-db";

/** Empties every table between tests without touching the (module-singleton) Dexie instance itself. */
export async function resetLocalDb(): Promise<void> {
  const db = getLocalDb();
  await Promise.all(db.tables.map((table) => table.clear()));
}
