"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getAnyActiveInspection } from "../lib/db/inspections";
import { getProject } from "../lib/db/projects";
import { useMounted } from "../lib/hooks/use-mounted";
import { formatTourName } from "../lib/format-tour-name";
import styles from "./home-screen.module.css";

/**
 * Main menu (user request: a real top-level menu instead of landing straight on the project list) — just
 * two destinations, פרויקטים and הגדרות, plus the tour-recovery banner (spec §44), which stays here
 * rather than on /projects: after a crash/close the user may not remember which project had the open
 * tour, and this is the very first screen they land on regardless, so "נמצא סיור שלא הסתיים" has to be
 * findable from here.
 */
export function HomeScreen() {
  const mounted = useMounted();

  const activeInspection = useLiveQuery(
    () => (mounted ? getAnyActiveInspection() : Promise.resolve(undefined)),
    [mounted]
  );

  const activeProject = useLiveQuery(
    () => (activeInspection ? getProject(activeInspection.projectId) : Promise.resolve(undefined)),
    [activeInspection]
  );

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>AV Inspection Tours</h1>
      <p className={styles.subtitle}>ניהול סיורי פיקוח עליון בתחום המולטימדיה</p>

      {activeInspection ? (
        <Link href={`/tour/${activeInspection.id}`} className={styles.recoveryBanner}>
          <span>⚠ נמצא סיור שלא הסתיים: {formatTourName(activeInspection.date, activeProject?.name ?? "…", activeInspection.categories)}</span>
          <span className={styles.recoveryAction}>המשך סיור ←</span>
        </Link>
      ) : null}

      <nav className={styles.menu}>
        <Link href="/projects" className={styles.menuCard}>
          <span className={styles.menuIcon}>📁</span>
          <span className={styles.menuLabel}>פרויקטים</span>
        </Link>
        <Link href="/contractors" className={styles.menuCard}>
          <span className={styles.menuIcon}>🏗️</span>
          <span className={styles.menuLabel}>רשימת קבלנים</span>
        </Link>
        <Link href="/settings" className={styles.menuCard}>
          <span className={styles.menuIcon}>⚙️</span>
          <span className={styles.menuLabel}>הגדרות</span>
        </Link>
      </nav>
    </main>
  );
}
