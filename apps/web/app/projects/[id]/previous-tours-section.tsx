"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Inspection, Project } from "@av-inspection/shared-types";
import { deleteInspection, listInspectionsForClient, listInspectionsForProject } from "../../../lib/db/inspections";
import { useMounted } from "../../../lib/hooks/use-mounted";
import styles from "./project-screen.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

async function handleDelete(inspection: Inspection) {
  const syncedWarning =
    inspection.syncStatus === "SYNCED" || inspection.syncStatus === "WAITING_FOR_SYNC"
      ? "\n\n⚠ סיור זה כבר סונכרן/ממתין לסנכרון לענן — המחיקה כרגע מקומית בלבד ולא תמחק אותו מהענן."
      : "";
  const confirmed = window.confirm(
    `למחוק את סיור #${inspection.inspectionNumber} לצמיתות? כל המשימות, התמונות וההקלטות שלו יימחקו גם הן. פעולה זו אינה הפיכה.${syncedWarning}`
  );
  if (!confirmed) return;
  await deleteInspection(inspection.id);
}

/** `onDelete` is only passed for a project's OWN tours (not the "same client, other projects" list below)
 * — deleting a tour that belongs to a different project from inside this one would be confusing at best. */
function TourRow({
  inspection,
  projectLabel,
  deletable,
}: {
  inspection: Inspection;
  projectLabel?: string;
  deletable?: boolean;
}) {
  return (
    <li className={styles.item}>
      <div className={styles.itemHeader}>
        <Link
          href={`/tour/${inspection.id}`}
          style={{ textDecoration: "none", color: "inherit", flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
        >
          <div>
            <div className={styles.itemName}>
              סיור #{inspection.inspectionNumber}
              {projectLabel ? ` · ${projectLabel}` : ""}
            </div>
            <div className={styles.itemMeta}>
              {formatDate(inspection.date)} · {inspection.inspector}
              {inspection.endTime === null ? " · 🟡 פתוח" : ""}
            </div>
          </div>
          <span aria-hidden="true">←</span>
        </Link>
        {deletable ? (
          <button
            type="button"
            className={styles.deleteButton}
            onClick={(event) => {
              event.preventDefault();
              void handleDelete(inspection);
            }}
            aria-label={`מחק סיור #${inspection.inspectionNumber}`}
            style={{ marginRight: 8 }}
          >
            🗑️
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * "סיורים קודמים" (user request: reach past tours again — of this project, and of the same client
 * across other projects). A past inspection's own `/tour/{id}` screen already renders a correct
 * read-only-ish summary (✅ done screen + export) once `endTime` is set — see tour-screen.tsx's
 * `ActiveTour` — so this section only needs to be a navigable list, no separate read-only view to build.
 */
export function PreviousToursSection({ project }: { project: Project }) {
  const mounted = useMounted();

  const ownInspections = useLiveQuery(
    () => (mounted ? listInspectionsForProject(project.id) : Promise.resolve<Inspection[]>([])),
    [mounted, project.id]
  );

  const clientInspections = useLiveQuery(
    () => (mounted && project.client ? listInspectionsForClient(project.client, project.id) : Promise.resolve([])),
    [mounted, project.id, project.client]
  );

  if (ownInspections === undefined) return null;
  if (ownInspections.length === 0 && (!clientInspections || clientInspections.length === 0)) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>סיורים קודמים</h2>

      {ownInspections.length > 0 ? (
        <ul className={styles.list}>
          {ownInspections.map((inspection) => (
            <TourRow key={inspection.id} inspection={inspection} deletable />
          ))}
        </ul>
      ) : (
        <p className={styles.emptyHint}>אין עדיין סיורים קודמים בפרויקט זה.</p>
      )}

      {clientInspections && clientInspections.length > 0 ? (
        <>
          <h3 className={styles.itemMeta} style={{ margin: "16px 0 6px", fontWeight: 600 }}>
            אצל {project.client} (פרויקטים אחרים)
          </h3>
          <ul className={styles.list}>
            {clientInspections.map(({ inspection, project: otherProject }) => (
              <TourRow key={inspection.id} inspection={inspection} projectLabel={otherProject.name} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
