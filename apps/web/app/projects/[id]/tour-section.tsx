"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { getActiveInspectionForProject, startInspection } from "../../../lib/db/inspections";
import styles from "./project-screen.module.css";

/** A remembered convenience only (per-device, per-browser) — never treated as authentication/identity. */
const INSPECTOR_STORAGE_KEY = "av-inspection-tours:last-inspector-name";

/** Start/resume a tour (spec §8 "סיור חדש", §44 recovery). The most important action on this screen — field work is the point of the whole app — so it's placed first, before Settings. */
export function TourSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [inspector, setInspector] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(INSPECTOR_STORAGE_KEY);
      if (saved) setInspector(saved);
    } catch {
      // localStorage can throw (private mode, blocked storage) — a remembered name is a convenience,
      // never required, so just skip it silently.
    }
  }, []);

  const activeInspection = useLiveQuery(() => getActiveInspectionForProject(projectId), [projectId]);

  async function handleStart() {
    const name = inspector.trim();
    if (!name) return;
    setStarting(true);
    try {
      try {
        localStorage.setItem(INSPECTOR_STORAGE_KEY, name);
      } catch {
        // Same as above — non-fatal.
      }
      const inspection = await startInspection(projectId, name);
      router.push(`/tour/${inspection.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>סיור</h2>

      {activeInspection ? (
        <>
          <p className={styles.emptyHint}>יש סיור פתוח שטרם הסתיים.</p>
          <button className={styles.addButton} onClick={() => router.push(`/tour/${activeInspection.id}`)}>
            ▶ המשך סיור #{activeInspection.inspectionNumber}
          </button>
        </>
      ) : (
        <div className={styles.inlineForm}>
          <input
            placeholder="שם המפקח"
            value={inspector}
            onChange={(e) => setInspector(e.target.value)}
            aria-label="שם המפקח"
          />
          <button className={styles.addButton} onClick={handleStart} disabled={starting || !inspector.trim()}>
            🚶 התחל סיור חדש
          </button>
        </div>
      )}
    </section>
  );
}
