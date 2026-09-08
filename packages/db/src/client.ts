import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Lazily-created Drizzle client. Not instantiated until first use so importing this module (e.g. from
 * shared-types-adjacent tooling) never requires `DATABASE_URL` to be set. Real connection is exercised
 * by whoever stands up Postgres for a given environment — untested against a live DB in this sandbox
 * (see drizzle.config.ts's note).
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. packages/db needs a Postgres connection string to do anything real " +
        "(see ARCHITECTURE.md). This is expected to throw in any environment that hasn't provisioned a database yet."
    );
  }
  const client = postgres(connectionString);
  _db = drizzle(client, { schema });
  return _db;
}

export { schema };
