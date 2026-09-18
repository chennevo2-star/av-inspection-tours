import { runMigrations } from "@av-inspection/db";

let migrationsPromise: Promise<void> | null = null;
let hyperdriveBridged = false;

/**
 * On the Cloudflare Workers/edge deploy (apps/web/wrangler.jsonc), real Postgres isn't reachable via a
 * plain `DATABASE_URL` env var the way it is on the Container/local-dev paths -- Hyperdrive is
 * Cloudflare's connection-pooling proxy for that, exposed as a binding (`env.HYPERDRIVE`), not a
 * process-level env var. `packages/db` deliberately stays unaware of any of this (it only ever reads
 * `process.env.DATABASE_URL` -- see its own client.ts comment) so this bridge exists purely to make the
 * Hyperdrive-provided connection string SHOW UP as that same env var, once, before anything calls into
 * packages/db. Wrapped in try/catch and a no-op fallback: `getCloudflareContext()` throws (or the import
 * itself may not even resolve meaningfully) on the Container/local-dev paths, where this whole bridge is
 * correctly a no-op -- `process.env.DATABASE_URL` is already set directly there via `wrangler secret put`
 * / `.env.local`, and must keep working completely unchanged.
 */
async function bridgeHyperdriveConnectionString(): Promise<void> {
  if (hyperdriveBridged || process.env.DATABASE_URL) return;
  hyperdriveBridged = true; // only ever attempt this once, success or failure
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (hyperdrive?.connectionString) {
      process.env.DATABASE_URL = stripTlsParamsForHyperdrive(hyperdrive.connectionString);
    }
  } catch {
    // Not running under the OpenNext/Workers adapter (Container or local dev) -- expected, not an error.
  }
}

/**
 * Hyperdrive's own hop to the real Neon database is already secured on Cloudflare's network -- the
 * Worker-to-Hyperdrive leg needs no application-level TLS on top of that, and real bug hit here confirms
 * it can't have one anyway: Neon's connection string carries `sslmode=require`, which `postgres` (the
 * driver packages/db uses) turns into `{ rejectUnauthorized: false }` before calling Workers' `tls.connect()`
 * -- but workerd's `node:tls` compat shim doesn't implement that option at all (any value), throwing
 * `ERR_OPTION_NOT_IMPLEMENTED`, which then cascades into a connection timeout since the handshake never
 * completes (confirmed live via `wrangler tail` against the real deployed Worker). Stripping `sslmode`/
 * `channel_binding` here (Hyperdrive-bridge-only -- the Container/direct-to-Neon path keeps needing real
 * TLS over the public internet, untouched) makes `postgres` default to `ssl: false` and skip that whole
 * code path, matching Cloudflare's own documented Hyperdrive + postgres.js integration.
 */
function stripTlsParamsForHyperdrive(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  return url.toString();
}

/**
 * Applies every pending migration at most once per server process, on first use — there's no clean
 * App-Router "on boot" hook without a custom server, so route handlers call this themselves before
 * touching the DB. Cheap after the first call (memoized promise), and `runMigrations()` itself is
 * idempotent (already-applied migrations are skipped), so this is safe to call from every request.
 *
 * Real bug found and fixed here: the original version memoized the promise unconditionally, including
 * a REJECTED one. One transient failure (e.g. a PGlite lock hiccup during a dev-server restart) then
 * poisoned every sync request for the rest of that process's life -- every /api/sync/* route calls this
 * first, so every entity type started failing with a generic 500 permanently, recoverable only by
 * restarting the whole dev server. Found live: the local sync queue had real entries stuck at
 * `attempts: 11`, `lastError: "Internal error"`, hours old, across every entity type, while a *fresh*
 * process could run the exact same migrations against the exact same on-disk data with no error at all
 * -- proving the DB itself was fine and the bug was purely this cached-rejection logic. Clearing the
 * memo on failure lets the very next request retry instead of the whole server needing a restart.
 */
export async function ensureDbReady(migrate: () => Promise<void> = runMigrations): Promise<void> {
  await bridgeHyperdriveConnectionString();
  if (!migrationsPromise) {
    migrationsPromise = migrate().catch((err) => {
      migrationsPromise = null;
      throw err;
    });
  }
  return migrationsPromise;
}

/** Test-only escape hatch: clears the memoized promise so the next ensureDbReady() call starts fresh. */
export function __resetDbReadyForTest(): void {
  migrationsPromise = null;
}
