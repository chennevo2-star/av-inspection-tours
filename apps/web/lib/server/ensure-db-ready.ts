import { runMigrations } from "@av-inspection/db";

let migrationsPromise: Promise<void> | null = null;

/**
 * Applies every pending migration at most once per server process, on first use — there's no clean
 * App-Router "on boot" hook without a custom server, so route handlers call this themselves before
 * touching the DB. Cheap after the first call (memoized promise), and `runMigrations()` itself is
 * idempotent (already-applied migrations are skipped), so this is safe to call from every request.
 */
export function ensureDbReady(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = runMigrations();
  }
  return migrationsPromise;
}
