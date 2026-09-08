"use client";

import { SyncQueue, type DrainSummary } from "@av-inspection/sync-engine";
import { DexieQueueStore } from "./dexie-queue-store";
import { HttpSyncTransport } from "./http-transport";
import { DexieStatusSink } from "./dexie-status-sink";

let _queue: SyncQueue | null = null;

function getQueue(): SyncQueue {
  if (!_queue) {
    _queue = new SyncQueue(new DexieQueueStore(), new HttpSyncTransport(), new DexieStatusSink());
  }
  return _queue;
}

let draining = false;

/**
 * Drains the sync queue once. Safe to call repeatedly/concurrently — a second call while one is already
 * running is a no-op (returns a zeroed summary) rather than double-draining the same items. Both the
 * manual "↻ סנכרן עכשיו" button and the automatic online-event listener below call this same function.
 */
export async function syncNow(): Promise<DrainSummary> {
  if (draining) {
    return { attempted: 0, succeeded: 0, requeued: 0, errored: 0 };
  }
  draining = true;
  try {
    return await getQueue().drain();
  } finally {
    draining = false;
  }
}

let autoSyncWired = false;

/**
 * Wires automatic sync on the `online` event (spec §19) plus one immediate attempt if the device is
 * already online when this is called (e.g. a page load right after connectivity returned). Must never be
 * relied on as the *only* trigger — the manual button always exists too (spec §19 explicitly warns
 * against relying solely on OS/browser background sync).
 */
export function wireAutoSync(): void {
  if (autoSyncWired || typeof window === "undefined") return;
  autoSyncWired = true;

  window.addEventListener("online", () => {
    void syncNow();
  });

  if (navigator.onLine) {
    void syncNow();
  }
}
