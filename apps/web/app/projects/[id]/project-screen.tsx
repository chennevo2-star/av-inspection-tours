"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import type { Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { deleteProject, updateProject } from "../../../lib/db/projects";
import { useMounted } from "../../../lib/hooks/use-mounted";
import { ContractorsSection } from "./contractors-section";
import { FloorsSection } from "./floors-section";
import { PreviousToursSection } from "./previous-tours-section";
import { TourSection } from "./tour-section";
import styles from "./project-screen.module.css";

/**
 * Project screen (spec §8). Now covers: סיור חדש/המשך סיור (Phase 3), settings
 * (name/number/client/address/description), Contractors, Floors&Rooms, and סיורים קודמים (user request:
 * reach a past tour of this project again, or of the same client across other projects). Still
 * deliberately omits משימות פתוחות (as its own dedicated view) / תמונות / דוחות — task-closing (§27) is
 * reachable from inside an active tour's ✅ panel, but a standalone project-level task/report/photo
 * history browser is Phase 6+ (Review UI) / Phase 8 (Reports) territory; a stub tab for those now would
 * be exactly the kind of mock-success CLAUDE.md forbids.
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
        <Link href="/projects" className={styles.backLink}>
          ← חזרה לפרויקטים
        </Link>
        <p className={styles.emptyHint}>טוען…</p>
      </main>
    );
  }

  if (lookup.state === "not-found") {
    return (
      <main className={styles.main}>
        <Link href="/projects" className={styles.backLink}>
          ← חזרה לפרויקטים
        </Link>
        <p className={styles.emptyHint}>הפרויקט לא נמצא במכשיר זה.</p>
      </main>
    );
  }

  return <ProjectBody project={lookup.project} />;
}

function ProjectBody({ project }: { project: Project }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [projectNumber, setProjectNumber] = useState(project.projectNumber ?? "");
  const [client, setClient] = useState(project.client ?? "");
  const [address, setAddress] = useState(project.address ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDeleteProject() {
    const syncedWarning =
      project.syncStatus === "SYNCED" || project.syncStatus === "WAITING_FOR_SYNC"
        ? "\n\n⚠ הפרויקט הזה כבר סונכרן/ממתין לסנכרון לענן — הוא יימחק גם מהענן."
        : "";
    const confirmed = window.confirm(
      `למחוק לצמיתות את הפרויקט "${project.name}"? כל הסיורים, הקבלנים, הקומות והחדרים שלו — כולל כל המשימות, התמונות וההקלטות מכל סיור — יימחקו גם הם. פעולה זו אינה הפיכה.${syncedWarning}`
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteProject(project.id);
      router.push("/projects");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className={styles.main}>
      <Link href="/projects" className={styles.backLink}>
        ← חזרה לפרויקטים
      </Link>
      <h1 className={styles.title}>{project.name}</h1>
      <p className={styles.subtitle}>
        {project.syncStatus === "SYNCED" ? "✅ מסונכרן" : "🟠 מקומי בלבד"}
      </p>

      <TourSection projectId={project.id} projectName={project.name} />
      <PreviousToursSection project={project} />

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
        <div className={styles.saveRow} style={{ marginTop: 10 }}>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => void handleDeleteProject()}
            disabled={deleting}
          >
            {deleting ? "מוחק…" : "🗑️ מחק פרויקט"}
          </button>
        </div>
      </section>

      <ContractorsSection projectId={project.id} />
      <FloorsSection projectId={project.id} />
    </main>
  );
}
