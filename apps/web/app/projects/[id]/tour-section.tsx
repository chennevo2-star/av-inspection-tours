"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { getActiveInspectionForProject, startInspection } from "../../../lib/db/inspections";
import styles from "./project-screen.module.css";

/** A remembered convenience only (per-device, per-browser) — never treated as authentication/identity. */
const INSPECTOR_STORAGE_KEY = "av-inspection-tours:last-inspector-name";

/**
 * Start/resume a tour (spec §8 "סיור חדש", §44 recovery). The most important action on this screen —
 * field work is the point of the whole app — so it's placed first, before Settings. Now also collects
 * the tour's participant list up front (this session's user request) — that list is what the New Task
 * wizard's "באחריות" step lets you pick from.
 */
export function TourSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [inspector, setInspector] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState("");
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

  function handleAddParticipant(event: FormEvent) {
    event.preventDefault();
    const name = participantInput.trim();
    if (!name || participants.includes(name)) return;
    setParticipants((current) => [...current, name]);
    setParticipantInput("");
  }

  function handleRemoveParticipant(name: string) {
    setParticipants((current) => current.filter((p) => p !== name));
  }

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
      const inspection = await startInspection(projectId, name, participants);
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
        <>
          <div className={styles.inlineForm}>
            <input
              placeholder="שם המפקח"
              value={inspector}
              onChange={(e) => setInspector(e.target.value)}
              aria-label="שם המפקח"
            />
          </div>

          <form onSubmit={handleAddParticipant} className={styles.inlineForm}>
            <input
              placeholder="הוסף משתתף לסיור (שם)"
              value={participantInput}
              onChange={(e) => setParticipantInput(e.target.value)}
              aria-label="הוסף משתתף"
            />
            <button className={styles.addButton} type="submit" disabled={!participantInput.trim()}>
              הוסף
            </button>
          </form>

          {participants.length > 0 ? (
            <div className={styles.aliasRow} style={{ marginBottom: 12 }}>
              {participants.map((name) => (
                <span key={name} className={styles.aliasChip}>
                  {name}
                  <button onClick={() => handleRemoveParticipant(name)} aria-label={`הסר את ${name}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <button className={styles.addButton} onClick={handleStart} disabled={starting || !inspector.trim()}>
            🚶 התחל סיור חדש
          </button>
        </>
      )}
    </section>
  );
}
