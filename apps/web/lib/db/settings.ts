import { getLocalDb } from "./local-db";

/**
 * Small local-only app-preference store (spec's "Settings" table). Deliberately NOT for secrets —
 * the Microsoft Graph client secret / tenant credentials live server-side only (env vars, read by
 * packages/storage/src/graph-auth.ts), never in the browser (spec §19). This is for harmless UI
 * preferences: today, just whether newly-created/opened projects should be auto-prepared for offline
 * use (spec §8's "prepare all active projects automatically" behavior) — real callers own the actual
 * "prepare for offline" logic; this module only remembers the user's stated preference across sessions.
 */
const AUTO_PREPARE_OFFLINE_KEY = "autoPrepareOffline";

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await getLocalDb().settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getLocalDb().settings.put({ key, value });
}

/** Default true — matches spec §8's stated default behavior ("when there's internet, the system should
 * automatically sync all active projects"); the user can turn it off from the offline-status screen. */
export async function getAutoPrepareOffline(): Promise<boolean> {
  return getSetting(AUTO_PREPARE_OFFLINE_KEY, true);
}

export async function setAutoPrepareOffline(value: boolean): Promise<void> {
  await setSetting(AUTO_PREPARE_OFFLINE_KEY, value);
}
