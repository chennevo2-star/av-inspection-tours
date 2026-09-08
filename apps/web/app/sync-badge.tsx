"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDb } from "../lib/db/local-db";
import { useMounted } from "../lib/hooks/use-mounted";
import styles from "./sync-badge.module.css";

/**
 * Always-visible, app-wide sync status indicator (spec §16 — "יש להציג למשתמש מצב ברור"), linking to the
 * full /sync screen (§21). Hidden on /tour/* specifically: that screen is the one place spec §10/§75
 * explicitly asks to keep free of anything but the tour's own big buttons — a fixed corner badge risks
 * overlapping them on small viewports, and the tour screen already surfaces recording status inline.
 */
export function SyncBadge() {
  const mounted = useMounted();
  const pathname = usePathname();

  const pendingCount =
    useLiveQuery(() => (mounted ? getLocalDb().syncQueue.count() : Promise.resolve(0)), [mounted]) ?? 0;

  if (!mounted || pathname?.startsWith("/tour/")) return null;

  return (
    <Link href="/sync" className={styles.badge}>
      <span>{pendingCount > 0 ? "🟠 סנכרון" : "✅ מסונכרן"}</span>
      {pendingCount > 0 ? <span className={styles.count}>{pendingCount}</span> : null}
    </Link>
  );
}
