"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderPickerCancelledError, openSharePointFolderPicker } from "../../../lib/graph-picker/open-folder-picker";
import styles from "./storage-folder-screen.module.css";

type CurrentValue = { state: "loading" } | { state: "loaded"; path: string | null };

const PICKER_CONFIGURED =
  !!process.env.NEXT_PUBLIC_MS_GRAPH_CLIENT_ID &&
  !!process.env.NEXT_PUBLIC_MS_GRAPH_TENANT_ID &&
  !!process.env.NEXT_PUBLIC_MS_GRAPH_SITE_URL;

/**
 * Storage settings screen (user request: choose the SharePoint folder photos/files get saved to, via a
 * real Microsoft folder picker, instead of only an env var set at deploy time). See
 * apps/web/lib/graph-picker/msal-client.ts's top comment for the one-time Entra admin setup this needs
 * (separate from and in addition to the app's existing app-only upload credentials) -- until that's done,
 * `PICKER_CONFIGURED` is false and this screen explains that instead of showing a picker that would just
 * fail.
 */
export function StorageFolderScreen() {
  const [current, setCurrent] = useState<CurrentValue>({ state: "loading" });
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  async function loadCurrent() {
    setCurrent({ state: "loading" });
    try {
      const response = await fetch("/api/settings/storage-folder");
      const body = (await response.json()) as { path: string | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "טעינת ההגדרה הנוכחית נכשלה");
      setCurrent({ state: "loaded", path: body.path });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCurrent({ state: "loaded", path: null });
    }
  }

  useEffect(() => {
    loadCurrent();
  }, []);

  async function handlePick() {
    setError(null);
    setPicking(true);
    try {
      const picked = await openSharePointFolderPicker();
      const response = await fetch("/api/settings/storage-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveId: picked.driveId, itemId: picked.id }),
      });
      const body = (await response.json()) as { path?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "שמירת התיקייה שנבחרה נכשלה");
      await loadCurrent();
    } catch (err) {
      if (!(err instanceof FolderPickerCancelledError)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPicking(false);
    }
  }

  async function handleClear() {
    const confirmed = window.confirm("לחזור לתיקיית ברירת המחדל (המוגדרת בשרת)?");
    if (!confirmed) return;
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/storage-folder", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "האיפוס נכשל");
      }
      await loadCurrent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className={styles.main}>
      <Link href="/settings" className={styles.backLink}>
        ← חזרה להגדרות
      </Link>
      <h1 className={styles.title}>תיקיית גיבוי (SharePoint)</h1>
      <p className={styles.hint}>
        כאן נשמרים כל התמונות, ההקלטות והקבצים המצורפים של הסיורים, בתוך אתר ה-SharePoint שכבר מוגדר
        לאפליקציה. בחירת תיקייה אחרת כאן לא דורשת פריסה מחדש של האפליקציה.
      </p>

      {current.state === "loading" ? (
        <p className={styles.hint}>טוען…</p>
      ) : (
        <div className={styles.currentBox}>
          <span className={styles.currentLabel}>תיקייה נוכחית:</span>
          <span className={styles.currentPath}>
            {current.path ?? "ברירת המחדל של השרת (לא נבחרה תיקייה מותאמת)"}
          </span>
        </div>
      )}

      {error ? <p className={styles.error}>⚠ {error}</p> : null}

      {!PICKER_CONFIGURED ? (
        <div className={styles.notConfigured}>
          <p>
            בחירת תיקייה עדיין לא זמינה — חסרה הגדרה חד-פעמית של Microsoft Entra (הרשאת כניסת משתמש לבורר
            התיקיות, בנפרד מהרשאת ההעלאות הקיימת). ראה את ההוראות בקובץ
            <code> apps/web/lib/graph-picker/msal-client.ts</code>.
          </p>
        </div>
      ) : (
        <div className={styles.actions}>
          <button className={styles.pickButton} onClick={handlePick} disabled={picking}>
            {picking ? "פותח את הבורר…" : "📂 בחר תיקייה ב-SharePoint"}
          </button>
          {current.state === "loaded" && current.path ? (
            <button className={styles.clearButton} onClick={handleClear} disabled={clearing}>
              {clearing ? "מאפס…" : "אפס לברירת המחדל"}
            </button>
          ) : null}
        </div>
      )}
    </main>
  );
}
