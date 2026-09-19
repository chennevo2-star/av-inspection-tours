"use client";

import Link from "next/link";
import styles from "./settings-hub-screen.module.css";

/**
 * Settings hub (user request: a menu screen for סנכרון, תיקיית גיבוי, and future settings, instead of
 * scattering these across ad-hoc links). Each row links to its own existing/new screen rather than
 * inlining that screen's content here — sync status and the inspector bank already have real, complete
 * screens of their own; no reason to duplicate or flatten them.
 */
export function SettingsHubScreen() {
  return (
    <main className={styles.main}>
      <Link href="/" className={styles.backLink}>
        ← תפריט ראשי
      </Link>
      <h1 className={styles.title}>הגדרות</h1>

      <ul className={styles.list}>
        <li>
          <Link href="/sync" className={styles.row}>
            <span className={styles.rowIcon}>🔄</span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>מצב סנכרון</span>
              <span className={styles.rowHint}>מה סונכרן לענן ומה עדיין ממתין</span>
            </span>
            <span aria-hidden="true">←</span>
          </Link>
        </li>
        <li>
          <Link href="/settings/storage-folder" className={styles.row}>
            <span className={styles.rowIcon}>📂</span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>תיקיית גיבוי (SharePoint)</span>
              <span className={styles.rowHint}>איפה נשמרים הקבצים והתמונות בענן</span>
            </span>
            <span aria-hidden="true">←</span>
          </Link>
        </li>
        <li>
          <Link href="/inspectors" className={styles.row}>
            <span className={styles.rowIcon}>👤</span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>בנק מפקחים וחותמות</span>
              <span className={styles.rowHint}>ניהול רשימת המפקחים והחתימות שלהם</span>
            </span>
            <span aria-hidden="true">←</span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
