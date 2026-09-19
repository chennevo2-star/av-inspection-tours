"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { SyncQueueItem } from "@av-inspection/shared-types";
import { getLocalDb } from "../../lib/db/local-db";
import { syncNow } from "../../lib/sync/sync-manager";
import { useMounted } from "../../lib/hooks/use-mounted";
import styles from "./sync-status-screen.module.css";

const ENTITY_LABELS: Record<string, string> = {
  Project: "פרויקטים",
  Floor: "קומות",
  Room: "חדרים",
  Contractor: "קבלנים",
  ContractorAlias: "כינויי קבלנים",
  Inspection: "סיורים",
  Issue: "ליקויים",
  Task: "משימות",
  Note: "הערות",
  Photo: "תמונות",
  AudioChunk: "קטעי הקלטה",
  Attachment: "קבצים מצורפים",
};

/**
 * Sync status screen (spec §21). Source of truth is the local sync queue itself, not a derived
 * per-entity status table — a queued item is, by definition, everything not yet SYNCED (the queue entry
 * is removed the moment the server confirms it, see packages/sync-engine), so counting the queue
 * directly can't drift out of sync with reality the way a separately-maintained counter could.
 */
export function SyncStatusScreen() {
  const mounted = useMounted();
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const queueItems =
    useLiveQuery(
      () => (mounted ? getLocalDb().syncQueue.toArray() : Promise.resolve<SyncQueueItem[]>([])),
      [mounted]
    ) ?? [];

  const countByType = new Map<string, number>();
  for (const item of queueItems) {
    countByType.set(item.entityType, (countByType.get(item.entityType) ?? 0) + 1);
  }
  const errored = queueItems.filter((item) => item.lastError);

  async function handleSyncNow() {
    setSyncing(true);
    setLastResult(null);
    try {
      const summary = await syncNow();
      setLastResult(
        `הסתיים: ${summary.succeeded} הצליחו · ${summary.requeued} ימתינו לניסיון נוסף · ${summary.errored} בשגיאה`
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className={styles.main}>
      <Link href="/settings" className={styles.backLink}>
        ← חזרה להגדרות
      </Link>
      <h1 className={styles.title}>מצב סנכרון</h1>

      <div className={styles.statusRow}>
        <span className={styles.onlineBadge}>{online ? "🟢 מחובר" : "🟠 Offline"}</span>
        <button className={styles.syncButton} onClick={handleSyncNow} disabled={syncing}>
          {syncing ? "מסנכרן…" : "↻ סנכרן עכשיו"}
        </button>
      </div>

      {lastResult ? <div className={styles.resultBanner}>{lastResult}</div> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ממתין לסנכרון</h2>
        {!mounted ? (
          <p className={styles.allSynced}>טוען…</p>
        ) : queueItems.length === 0 ? (
          <p className={styles.allSynced}>✅ הכל מסונכרן</p>
        ) : (
          <ul className={styles.typeList}>
            {[...countByType.entries()].map(([type, count]) => (
              <li key={type} className={styles.typeRow}>
                <span>{ENTITY_LABELS[type] ?? type}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {errored.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>שגיאות סנכרון ({errored.length})</h2>
          <ul className={styles.errorList}>
            {errored.map((item) => (
              <li key={item.id} className={styles.errorItem}>
                <div className={styles.errorType}>{ENTITY_LABELS[item.entityType] ?? item.entityType}</div>
                <div>{item.lastError}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
