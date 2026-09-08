"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../lib/db/local-db";
import { createProject } from "../lib/db/projects";
import styles from "./home-screen.module.css";

/**
 * Home screen — project list (spec §7). Deliberately minimal for Phase 1: it exists to prove the
 * offline-first foundation end to end (write → IndexedDB → live re-render → survives reload), not to be
 * the finished Projects UI (that's Phase 2 — search, project cards with last-inspection/open-task counts,
 * sync status, etc. per spec §7 and §81).
 */
export function HomeScreen() {
  // IndexedDB doesn't exist during server-side rendering. `mounted` stays false for the SSR pass and the
  // very first client render (so they match, avoiding a hydration mismatch), then flips true in an
  // effect — only after that do we touch getLocalDb(). See lib/db/local-db.ts's getLocalDb() guard.
  const [mounted, setMounted] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => setMounted(true), []);

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
      <h1 className={styles.title}>פרויקטים</h1>

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
            <li key={project.id} className={styles.card}>
              <span className={styles.projectName}>{project.name}</span>
              <span className={styles.syncBadge}>
                {project.syncStatus === "SYNCED" ? "✅ מסונכרן" : "🟠 מקומי בלבד"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
