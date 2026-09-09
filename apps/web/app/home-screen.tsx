"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../lib/db/local-db";
import { createProject } from "../lib/db/projects";
import { getAnyActiveInspection } from "../lib/db/inspections";
import { useMounted } from "../lib/hooks/use-mounted";
import styles from "./home-screen.module.css";

/**
 * Home screen — project list (spec §7) + tour-recovery banner (spec §44), which deliberately lives here
 * rather than only on the project screen: after a crash/close, the user may land here first with no idea
 * which project had the open tour — "נמצא סיור שלא הסתיים" has to be findable regardless. Still without
 * the last-inspection/open-task counts spec §7 also asks for on each card — those need a dedicated
 * inspection-history view (Phase 6+) to be meaningful; a fake always-zero count would be exactly the kind
 * of mock-success CLAUDE.md forbids.
 */
export function HomeScreen() {
  const mounted = useMounted();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const activeInspection = useLiveQuery(
    () => (mounted ? getAnyActiveInspection() : Promise.resolve(undefined)),
    [mounted]
  );

  // Both branches resolve to Promise<Project[]> (never `undefined`) so useLiveQuery's inferred type
  // stays a plain array — "still loading" is tracked separately via `mounted`/the live-query's own
  // undefined-until-first-result state below, not by overloading this return type.
  const projects = useLiveQuery(
    () =>
      mounted
        ? getLocalDb().projects.orderBy("updatedAt").reverse().toArray()
        : Promise.resolve<Project[]>([]),
    [mounted]
  );

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createProject(name);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>פרויקטים</h1>
        <Link href="/inspectors" className={styles.inspectorsLink}>
          👤 עריכת מפקח
        </Link>
      </div>

      {activeInspection ? (
        <Link href={`/tour/${activeInspection.id}`} className={styles.recoveryBanner}>
          <span>⚠ נמצא סיור שלא הסתיים (#{activeInspection.inspectionNumber})</span>
          <span className={styles.recoveryAction}>המשך סיור ←</span>
        </Link>
      ) : null}

      <form className={styles.newProjectForm} onSubmit={handleCreate}>
        <input
          className={styles.input}
          type="text"
          placeholder="שם פרויקט חדש"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          aria-label="שם פרויקט חדש"
        />
        <button className={styles.addButton} type="submit" disabled={creating || !newName.trim()}>
          פרויקט חדש +
        </button>
      </form>

      {!mounted || projects === undefined ? (
        <p className={styles.empty}>טוען…</p>
      ) : projects.length === 0 ? (
        <p className={styles.empty}>אין עדיין פרויקטים. צור פרויקט ראשון למעלה.</p>
      ) : (
        <ul className={styles.list}>
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className={styles.card}>
                <span className={styles.projectName}>
                  {project.name}
                  {project.projectNumber ? (
                    <span className={styles.projectNumber}> #{project.projectNumber}</span>
                  ) : null}
                </span>
                <span className={styles.syncBadge}>
                  {project.syncStatus === "SYNCED" ? "✅ מסונכרן" : "🟠 מקומי בלבד"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
