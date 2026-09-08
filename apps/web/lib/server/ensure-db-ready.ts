import { runMigrations } from "@av-inspection/db";

let migrationsPromise: Promise<void> | null = null;

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
export function ensureDbReady(migrate: () => Promise<void> = runMigrations): Promise<void> {
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
