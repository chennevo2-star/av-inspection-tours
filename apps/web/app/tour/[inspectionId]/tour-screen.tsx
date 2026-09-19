"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Inspection, Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { endInspection, reopenInspection } from "../../../lib/db/inspections";
import { useMounted } from "../../../lib/hooks/use-mounted";
import { formatTourName } from "../../../lib/format-tour-name";
import { NewTaskWizard } from "./new-task-wizard";
import { TasksTable } from "./tasks-table";
import styles from "./tour-screen.module.css";

// Dexie's `.get()` resolves to `undefined` both while a query hasn't run yet AND when the record
// genuinely doesn't exist — same footgun already hit twice in this codebase, same fix.
type InspectionLookup = { state: "loading" } | { state: "not-found" } | { state: "found"; inspection: Inspection };

export function TourScreen({ inspectionId }: { inspectionId: string }) {
  const mounted = useMounted();

  const lookup = useLiveQuery<InspectionLookup>(async () => {
    if (!mounted) return { state: "loading" };
    const inspection = await getLocalDb().inspections.get(inspectionId);
    return inspection ? { state: "found", inspection } : { state: "not-found" };
  }, [mounted, inspectionId]);

  if (lookup === undefined || lookup.state === "loading") {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint}>טוען…</p>
      </main>
    );
  }

  if (lookup.state === "not-found") {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint}>הסיור לא נמצא במכשיר זה.</p>
      </main>
    );
  }

  return <ActiveTour inspection={lookup.inspection} />;
}

type Overlay = "new-task" | "tasks-table" | null;

/**
 * Main tour screen (this session's user request, replacing the earlier 6-button/continuous-recording
 * design entirely). 4 actions: start a guided task-entry wizard, view the running tasks table, end the
 * tour, export a report. Room/floor selection, photos, and description all moved INTO the New Task
 * wizard itself — there's no longer a standalone "switch room" or "talk about photo" action here.
 */
function ActiveTour({ inspection }: { inspection: Inspection }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Read-only here: the New Task wizard used to be able to grow this list too (typing a new name there
  // added it as a tour participant), a conflation this session's user request corrected -- see
  // new-task-wizard.tsx's own comment. Editing participants now only happens at tour-start
  // (tour-section.tsx), which is the only place that still writes to it.
  const [participants] = useState(inspection.participants);
  const [ended, setEnded] = useState(inspection.endTime !== null);
  const [ending, setEnding] = useState(false);
  const [reopening, setReopening] = useState(false);

  const project = useLiveQuery<Project | undefined>(
    () => getLocalDb().projects.get(inspection.projectId),
    [inspection.projectId]
  );

  async function handleEndTour() {
    const confirmed = window.confirm("לסיים את הסיור? כל המידע כבר שמור במכשיר.");
    if (!confirmed) return;
    setEnding(true);
    try {
      await endInspection(inspection.id);
      setEnded(true);
    } finally {
      setEnding(false);
    }
  }

  async function handleReopen() {
    setReopening(true);
    try {
      await reopenInspection(inspection.id);
      setEnded(false);
    } finally {
      setReopening(false);
    }
  }

  if (ended) {
    return (
      <main className={styles.wrap}>
        <div className={styles.doneScreen}>
          <div className={styles.doneTitle}>✅ הסיור נשמר בהצלחה במכשיר</div>
          <p className={styles.projectName}>{formatTourName(inspection.date, project?.name ?? "…")}</p>
          <p className={styles.doneHint}>
            ניתן עדיין לייצא דו״ח סיכום מהסיור הזה, או לפתוח אותו מחדש כדי לערוך משימות. הסנכרון לענן יבוצע
            ברקע כשיש חיבור.
          </p>
          <Link href={`/tour/${inspection.id}/report`} className={styles.doneButton} style={{ marginLeft: 10 }}>
            📄 דוח מסכם
          </Link>
          <button className={styles.doneButton} onClick={handleReopen} disabled={reopening} style={{ marginLeft: 10 }}>
            {reopening ? "פותח…" : "✏️ פתח לעריכה"}
          </button>
          <Link href="/" className={styles.doneButton}>
            חזרה למסך הראשי
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <div className={styles.inspectionNumber}>{formatTourName(inspection.date, project?.name ?? "…")}</div>
          </div>
          <Link href={`/projects/${inspection.projectId}`} className={styles.exitLink}>
            יציאה
          </Link>
        </div>
        {participants.length > 0 ? (
          <div className={styles.participantsRow}>משתתפים: {participants.join(", ")}</div>
        ) : null}
      </header>

      <div className={styles.grid}>
        <button className={styles.bigButton} onClick={() => setOverlay("new-task")}>
          <span className={styles.bigButtonIcon}>➕</span>
          משימה חדשה
        </button>
        <button className={styles.bigButton} onClick={() => setOverlay("tasks-table")}>
          <span className={styles.bigButtonIcon}>📋</span>
          טבלת משימות
        </button>
        <Link href={`/tour/${inspection.id}/report`} className={styles.bigButton}>
          <span className={styles.bigButtonIcon}>📄</span>
          דוח מסכם
        </Link>
        <button className={styles.bigButton} onClick={handleEndTour} disabled={ending}>
          <span className={styles.bigButtonIcon}>■</span>
          {ending ? "מסיים…" : "סיום סיור"}
        </button>
      </div>

      {overlay === "new-task" ? (
        <NewTaskWizard
          inspectionId={inspection.id}
          projectId={inspection.projectId}
          onClose={() => setOverlay(null)}
          onTaskCreated={() => setOverlay(null)}
        />
      ) : null}
      {overlay === "tasks-table" ? <TasksTable inspectionId={inspection.id} onClose={() => setOverlay(null)} /> : null}
    </main>
  );
}
