import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema.js";

/** Computed lazily, inside runMigrations() itself, not at module load — see that function's own
 * comment for why: `import.meta.url`-based path resolution breaks once this module is bundled for an
 * edge/Workers deploy (same root-cause family as a real bug already hit and fixed in
 * packages/report-generator's Hebrew-font loading), so this must never even be evaluated on that path,
 * which SKIP_RUNTIME_MIGRATIONS guards against below. */
function resolveMigrationsFolder(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "..", "migrations");
}

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

/**
 * Applies every migration in packages/db/migrations/ (generated via `npm run db:generate`). Idempotent —
 * safe to call on every server start; already-applied migrations are skipped.
 *
 * `SKIP_RUNTIME_MIGRATIONS=true` makes this a documented no-op instead -- set only in the Cloudflare
 * Workers/edge deploy's own config (apps/web/wrangler.jsonc), never in the Container/local-dev path,
 * which keeps working exactly as before. Two real reasons this is needed there, not just a preference:
 * (1) `migrate()`'s own file-based migration reading needs a real filesystem path resolved via
 * `import.meta.url` (see resolveMigrationsFolder() above) -- reliable under Node, but not something to
 * trust once bundled for an edge runtime. (2) apps/web/lib/server/ensure-db-ready.ts calls this from
 * every sync API request (memoized per-process) -- on a traditional long-lived Node server that's cheap
 * after the first call, but Workers isolates are recycled far more often, so this could run far more
 * frequently there than the "once per server lifetime" it was designed for. Migrations against the real
 * production DB are applied out-of-band instead (`npm run db:migrate -w packages/db`, run manually
 * before deploying a schema change) -- see CLOUDFLARE_DEPLOY.md.
 */
export async function runMigrations(): Promise<void> {
  if (process.env.SKIP_RUNTIME_MIGRATIONS === "true") return;

  const handle = getHandle();
  const migrationsFolder = resolveMigrationsFolder();
  if (handle.driver === "postgres") {
    await migratePg(handle.db, { migrationsFolder });
  } else {
    await migratePglite(handle.db, { migrationsFolder });
  }
}

export { schema };
