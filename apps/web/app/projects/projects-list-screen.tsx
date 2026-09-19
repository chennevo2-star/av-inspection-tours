"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../../lib/db/local-db";
import { createProject } from "../../lib/db/projects";
import { useMounted } from "../../lib/hooks/use-mounted";
import styles from "../home-screen.module.css";

/**
 * Project list (spec §7) -- moved here from `/` when the home screen became a main menu (user request).
 * The tour-recovery banner stayed on the menu screen, not here -- see home-screen.tsx's own comment.
 * Still without the last-inspection/open-task counts spec §7 also asks for on each card -- those need a
 * dedicated inspection-history view (Phase 6+) to be meaningful; a fake always-zero count would be
 * exactly the kind of mock-success CLAUDE.md forbids.
 */
export function ProjectsListScreen() {
  const mounted = useMounted();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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
        <Link href="/" className={styles.inspectorsLink}>
          ← תפריט ראשי
        </Link>
      </div>

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
