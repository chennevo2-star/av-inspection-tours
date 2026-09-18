import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
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
 * Real ground truth established here, the hard way, against the real deployed Worker (see this repo's git
 * log for the two dead ends this rules out): `env.HYPERDRIVE.connectionString` on a genuine production
 * request is a Hyperdrive-internal proxy address (`<id>.hyperdrive.local:5432`, `sslmode=disable` already
 * set by Hyperdrive itself) -- NOT the real Neon hostname, confirmed via a temporary debug route. postgres.js's
 * default `net.Socket()`, reached through workerd's `node:net` compat shim, does NOT get Hyperdrive's
 * interception for that hostname at all -- confirmed by waiting a full clean deploy cycle and curling the
 * real endpoint directly: it just hangs (DNS for a `.hyperdrive.local` sentinel host can't resolve through
 * a generic compat `net.connect`) until Workers force-kills the request. Only Workers' own native TCP API,
 * `cloudflare:sockets`, actually gets Hyperdrive's real interception/routing.
 *
 * postgres.js supports a custom per-connection `options.socket` factory for exactly this kind of runtime,
 * but its connection.js immediately calls Node-`net.Socket`-style methods on whatever that factory returns
 * (`.on('error'|'close'|'drain'|'data', ...)`, `.write(chunk, cb)`, `.destroy()`, `.readyState`) -- a raw
 * `cloudflare:sockets` `Socket` exposes WHATWG `readable`/`writable` streams instead, a genuine API
 * mismatch (an earlier attempt returning the raw socket directly hung silently: `.on()` calls on an object
 * without that method don't throw synchronously here, they just never fire, so postgres.js's internal
 * promise chain never resolves or rejects). `CloudflareSocketAdapter` below bridges the two.
 */
class CloudflareSocketAdapter extends EventEmitter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private isClosed = false;

  constructor(private cfSocket: CloudflareSocket) {
    super();
    this.writer = cfSocket.writable.getWriter();
    this.pump();
    cfSocket.closed
      .then(() => {
        this.isClosed = true;
        this.emit("close", false);
      })
      .catch((err: unknown) => {
        this.isClosed = true;
        this.emit("error", err);
        this.emit("close", true);
      });
  }

  private async pump() {
    const reader = this.cfSocket.readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.emit("data", Buffer.from(value));
      }
    } catch (err) {
      this.emit("error", err);
    }
  }

  write(chunk: Uint8Array, cb?: (err?: Error) => void): boolean {
    this.writer
      .write(chunk)
      .then(() => cb?.())
      .catch((err: Error) => (cb ? cb(err) : this.emit("error", err)));
    return true;
  }

  end(chunk?: Uint8Array): void {
    (chunk ? this.writer.write(chunk) : Promise.resolve()).finally(() => {
      this.writer.close().catch(() => {});
    });
  }

  destroy(): void {
    this.cfSocket.close().catch(() => {});
  }

  get readyState(): "open" | "closed" {
    return this.isClosed ? "closed" : "open";
  }
}

interface CloudflareSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close(): Promise<void>;
}

// `cloudflare:sockets` isn't a real npm package or Node builtin -- it only exists as a workerd runtime
// built-in, and a plain `import("cloudflare:sockets")` broke both Next's webpack build and OpenNext's own
// separate esbuild re-bundle pass (neither can resolve it, and OpenNext exposes no externals config for
// its stage). A `new Function(...)`-based indirection fixed both builds but then crashed at actual request
// time (`EvalError: Code generation from strings disallowed for this context` -- workerd hard-disallows
// eval/Function-constructor code generation). Routing the specifier through a `string`-WIDENED variable
// sidesteps both problems with zero dynamic code generation: neither bundler's `import()` static analysis
// triggers on a plain identifier (only on literal strings, left as genuine runtime code instead), and it's
// ordinary `import()`, not `eval`, so workerd's sandboxing doesn't apply.
const cloudflareSocketsSpecifier: string = "cloudflare:sockets";

async function createWorkersSocket(options: { host: string; port: number }): Promise<CloudflareSocketAdapter> {
  const { connect } = (await import(cloudflareSocketsSpecifier)) as {
    connect: (address: { hostname: string; port: number }) => CloudflareSocket;
  };
  const cfSocket = connect({ hostname: options.host, port: options.port });
  await cfSocket.opened; // established before handing back -- postgres.js writes immediately, no 'connect' wait
  return new CloudflareSocketAdapter(cfSocket);
}

function getHandle(): DbHandle {
  if (_handle) return _handle;

  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const isWorkersRuntime = typeof (globalThis as { Cloudflare?: unknown }).Cloudflare !== "undefined";
    // postgres.js's own TS types don't declare `socket` at all, even though its real JS implementation
    // (connection.js) supports it -- widening the type here (rather than casting an object literal
    // directly) is what keeps TS's excess-property check from rejecting it.
    const options: postgres.Options<Record<string, never>> & { socket?: typeof createWorkersSocket } = {};
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
