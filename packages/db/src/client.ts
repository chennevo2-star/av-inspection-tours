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

/**
 * Real bug hit here (confirmed live via `wrangler tail` against the deployed Worker, across several
 * attempts): postgres.js's own `net.Socket()` + `tls.connect()` connection path -- reached through
 * workerd's `node:net`/`node:tls` compat shim on the Cloudflare Workers/Hyperdrive deploy path
 * (apps/web/wrangler.jsonc) -- never actually gets intercepted/routed by Hyperdrive at all, no matter what
 * `ssl` option is passed (`ssl: 'require'` crashes on the unsupported `rejectUnauthorized` option; `ssl:
 * false` and `ssl: {}` both just hang until Workers force-kills the request as "hung and would never
 * generate a response"). Hyperdrive's real interception only engages for connections made through Workers'
 * own native TCP API (`cloudflare:sockets`), which this driver doesn't use by default -- postgres.js does
 * support supplying a custom per-connection socket factory for exactly this kind of runtime (its own
 * `options.socket`), so this detects the Workers runtime the same way postgres.js's own code already does
 * internally (`globalThis.Cloudflare`, see its index.js pool-size default) and wires that up.
 *
 * `cloudflare:sockets` isn't a real npm package or Node builtin -- it only exists as a workerd runtime
 * built-in, and a plain `import("cloudflare:sockets")` broke the build TWICE, in two different bundlers:
 * Next's own webpack build failed outright ("Module not found") until marked external, and then OpenNext's
 * OWN separate esbuild re-bundle pass (no exposed config for its own externals) failed the exact same way
 * regardless. A first attempt at hiding the specifier via `new Function("specifier", "return
 * import(specifier)")` fixed both build failures but broke at actual runtime instead -- confirmed live via
 * `wrangler tail`: `EvalError: Code generation from strings disallowed for this context`, a hard workerd
 * sandboxing restriction (no `eval`/`Function` constructor at all, regardless of CSP-style config). Moving
 * the specifier into a `string`-WIDENED variable (not `new Function`) sidesteps both problems without any
 * dynamic code generation: neither bundler's `import()` static-analysis triggers on a plain identifier
 * (only on literal strings), so it's left as genuine runtime code, needing no bundler config in either
 * stage -- and it's ordinary `import()`, not `eval`, so it's unaffected by workerd's sandboxing.
 */
const cloudflareSocketsSpecifier: string = "cloudflare:sockets";

async function createWorkersSocket(options: { host: string; port: number }) {
  const { connect } = (await import(cloudflareSocketsSpecifier)) as {
    connect: (address: { hostname: string; port: number }) => unknown;
  };
  return connect({ hostname: options.host, port: options.port });
}

function getHandle(): DbHandle {
  if (_handle) return _handle;

  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const isWorkersRuntime = typeof (globalThis as { Cloudflare?: unknown }).Cloudflare !== "undefined";
    // postgres.js's own TS types don't declare `socket` at all, even though its real JS implementation
    // (connection.js) supports it -- widening the type here (rather than casting the object literal
    // itself) is what keeps TS's excess-property check from rejecting it.
    const options: postgres.Options<Record<string, never>> & { socket?: typeof createWorkersSocket } = {
      ssl: {},
    };
    if (isWorkersRuntime) options.socket = createWorkersSocket;
    const client = postgres(connectionString, options);
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
