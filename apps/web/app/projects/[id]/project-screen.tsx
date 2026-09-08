"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { updateProject } from "../../../lib/db/projects";
import { useMounted } from "../../../lib/hooks/use-mounted";
import { ContractorsSection } from "./contractors-section";
import { FloorsSection } from "./floors-section";
import styles from "./project-screen.module.css";

/**
 * Project screen (spec §8). Phase 2 scope: settings (name/number/client/address/description) +
 * Contractors + Floors&Rooms. Deliberately omits the spec's other §8 sections (סיור חדש, סיורים קודמים,
 * משימות פתוחות, תמונות, דוחות) — those need Phase 3+ (Inspections/Tasks/Photos/Reports) to actually
 * exist; a disabled-looking button for them would be exactly the kind of mock-success CLAUDE.md forbids.
 */
/**
 * Dexie's `.get()` resolves to `undefined` both while a query hasn't run yet AND when the record
 * genuinely doesn't exist — those aren't the same thing to a user (loading vs. wrong link), so the
 * querier below returns this discriminated shape instead of a bare `Project | undefined`.
 */
type ProjectLookup = { state: "loading" } | { state: "not-found" } | { state: "found"; project: Project };

export function ProjectScreen({ projectId }: { projectId: string }) {
  const mounted = useMounted();

  const lookup = useLiveQuery<ProjectLookup>(async () => {
    if (!mounted) return { state: "loading" };
    const project = await getLocalDb().projects.get(projectId);
    return project ? { state: "found", project } : { state: "not-found" };
  }, [mounted, projectId]);

  if (lookup === undefined || lookup.state === "loading") {
    return (
      <main className={styles.main}>
        <Link href="/" className={styles.backLink}>
          ← חזרה לפרויקטים
        </Link>
        <p className={styles.emptyHint}>טוען…</p>
      </main>
    );
  }

  if (lookup.state === "not-found") {
    return (
      <main className={styles.main}>
        <Link href="/" className={styles.backLink}>
          ← חזרה לפרויקטים
        </Link>
        <p className={styles.emptyHint}>הפרויקט לא נמצא במכשיר זה.</p>
      </main>
    );
  }

  return <ProjectBody project={lookup.project} />;
}

function ProjectBody({ project }: { project: Project }) {
  const [name, setName] = useState(project.name);
  const [projectNumber, setProjectNumber] = useState(project.projectNumber ?? "");
  const [client, setClient] = useState(project.client ?? "");
  const [address, setAddress] = useState(project.address ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Keep local form state in sync if the underlying record changes from elsewhere (e.g. a future sync
  // pulling a server-side edit) — but only while the user hasn't started editing, so we never clobber
  // in-progress input.
  useEffect(() => {
    if (dirty) return;
    setName(project.name);
    setProjectNumber(project.projectNumber ?? "");
    setClient(project.client ?? "");
    setAddress(project.address ?? "");
    setDescription(project.description ?? "");
  }, [project, dirty]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateProject(project.id, {
        name: name.trim() || project.name,
        projectNumber: projectNumber.trim() || null,
        client: client.trim() || null,
        address: address.trim() || null,
        description: description.trim() || null,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.backLink}>
        ← חזרה לפרויקטים
      </Link>
      <h1 className={styles.title}>{project.name}</h1>
      <p className={styles.subtitle}>
        {project.syncStatus === "SYNCED" ? "✅ מסונכרן" : "🟠 מקומי בלבד"}
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>הגדרות פרויקט</h2>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="proj-name">שם הפרויקט</label>
            <input
              id="proj-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="proj-number">מספר פרויקט</label>
            <input
              id="proj-number"
              value={projectNumber}
              onChange={(e) => {
                setProjectNumber(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="proj-client">לקוח</label>
            <input
              id="proj-client"
              value={client}
              onChange={(e) => {
                setClient(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="proj-address">כתובת</label>
            <input
              id="proj-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setDirty(true);
              }}
            />
          </div>
        </div>
        <div className={styles.field} style={{ marginTop: 10 }}>
          <label htmlFor="proj-desc">תיאור</label>
          <textarea
            id="proj-desc"
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className={styles.saveRow}>
          {dirty && !saving ? <span className={styles.saveStatus}>יש שינויים שלא נשמרו</span> : null}
          <button className={styles.saveButton} onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "שומר…" : "שמור"}
          </button>
        </div>
      </section>

      <ContractorsSection projectId={project.id} />
      <FloorsSection projectId={project.id} />
    </main>
  );
}
