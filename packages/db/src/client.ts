import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "..", "migrations");

/**
 * Two possible backends, chosen at first use by whether `DATABASE_URL` is set:
 *
 * - Set → real Postgres (`postgres-js` driver). The production/Docker path from ARCHITECTURE.md.
 * - Unset → PGlite, an embedded WASM Postgres with zero installation (ADR-007). This is what actually
 *   runs in this project's own dev environment (no Docker available) — it's real Postgres SQL semantics,
 *   not a mock, persisted to a local directory so data survives across dev-server restarts.
 *
 * Kept as a discriminated union (not a bare union of the two `db` types) so `runMigrations()` below can
 * call the matching driver-specific migrator without an `any` cast — each driver's `migrate()` needs the
 * db instance *it* created, not the other one.
 */
type DbHandle =
  | { driver: "postgres"; db: PostgresJsDatabase<typeof schema> }
  | { driver: "pglite"; db: PgliteDatabase<typeof schema> };

let _handle: DbHandle | null = null;

function getHandle(): DbHandle {
  if (_handle) return _handle;

  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const client = postgres(connectionString);
    _handle = { driver: "postgres", db: drizzlePg(client, { schema }) };
    return _handle;
  }

  const dataDir = process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), ".pglite-data");
  const pglite = new PGlite(dataDir);
  _handle = { driver: "pglite", db: drizzlePglite(pglite, { schema }) };
  return _handle;
}

export function getDb(): DbHandle["db"] {
  return getHandle().db;
}

export function getDbDriver(): DbHandle["driver"] {
  return getHandle().driver;
}

/** Applies every migration in packages/db/migrations/ (generated via `npm run db:generate`). Idempotent — safe to call on every server start; already-applied migrations are skipped. */
export async function runMigrations(): Promise<void> {
  const handle = getHandle();
  if (handle.driver === "postgres") {
    await migratePg(handle.db, { migrationsFolder });
  } else {
    await migratePglite(handle.db, { migrationsFolder });
  }
}

export { schema };
