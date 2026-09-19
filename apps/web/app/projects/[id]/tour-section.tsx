"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { getActiveInspectionForProject, startInspection } from "../../../lib/db/inspections";
import { listInspectors } from "../../../lib/db/inspectors";
import { formatTourName } from "../../../lib/format-tour-name";
import styles from "./project-screen.module.css";

/** A remembered convenience only (per-device, per-browser) — never treated as authentication/identity. */
const INSPECTOR_STORAGE_KEY = "av-inspection-tours:last-inspector-name";

/**
 * Start/resume a tour (spec §8 "סיור חדש", §44 recovery). The most important action on this screen —
 * field work is the point of the whole app — so it's placed first, before Settings. Now also collects
 * the tour's participant list up front (this session's user request) — that list is what the New Task
 * wizard's "באחריות" step lets you pick from.
 *
 * An existing open tour no longer blocks starting another one (user request: "גם אם קיים ללקוח סיור פתוח
 * אפשר סיור חדש") — e.g. a second visit the same day before the first one's report was closed out. The
 * "המשך" shortcut for the most recent open tour still shows above the form as a convenience; any OTHER
 * open tour (there can now be more than one) is still reachable via "סיורים קודמים" below, which already
 * marks open tours with 🟡.
 */
export function TourSection({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [inspector, setInspector] = useState("");
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [participantInput, setParticipantInput] = useState("");
  const [starting, setStarting] = useState(false);

  const inspectorBank = useLiveQuery(listInspectors, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(INSPECTOR_STORAGE_KEY);
      if (saved) setInspector(saved);
    } catch {
      // localStorage can throw (private mode, blocked storage) — a remembered name is a convenience,
      // never required, so just skip it silently.
    }
  }, []);

  // Once the bank has loaded, if the remembered name matches a real bank inspector, re-select them (so
  // the stamp is picked up again automatically) rather than leaving it as a plain, id-less free-text name.
  useEffect(() => {
    if (!inspectorBank || inspectorId) return;
    const match = inspectorBank.find((i) => i.name === inspector);
    if (match) setInspectorId(match.id);
  }, [inspectorBank, inspector, inspectorId]);

  function selectBankInspector(id: string, name: string) {
    setInspectorId(id);
    setInspector(name);
  }

  function handleInspectorTyped(value: string) {
    setInspector(value);
    setInspectorId(null); // free-text entry is always ad-hoc, even if it happens to match a bank name
  }

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
      const inspection = await startInspection(projectId, name, participants, inspectorId);
      router.push(`/tour/${inspection.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>סיור</h2>

      {activeInspection ? (
        <div style={{ marginBottom: 16 }}>
          <p className={styles.emptyHint}>יש סיור פתוח שטרם הסתיים.</p>
          <button className={styles.addButton} onClick={() => router.push(`/tour/${activeInspection.id}`)}>
            ▶ המשך {formatTourName(activeInspection.date, projectName)}
          </button>
        </div>
      ) : null}

      <>
        {activeInspection ? (
          <p className={styles.emptyHint} style={{ margin: "0 0 8px" }}>
            או התחל סיור נוסף:
          </p>
        ) : null}
        {inspectorBank && inspectorBank.length > 0 ? (
          <div className={styles.aliasRow} style={{ marginBottom: 8 }}>
            {inspectorBank.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={styles.aliasChip}
                style={inspectorId === candidate.id ? { borderColor: "var(--accent)" } : undefined}
                onClick={() => selectBankInspector(candidate.id, candidate.name)}
              >
                {candidate.stampLocalFileId ? "✍️ " : ""}
                {candidate.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.inlineForm}>
          <input
            placeholder="שם המפקח (או בחר מהרשימה למעלה)"
            value={inspector}
            onChange={(e) => handleInspectorTyped(e.target.value)}
            aria-label="שם המפקח"
          />
        </div>
        <p className={styles.emptyHint} style={{ margin: "4px 0 12px", fontSize: 12 }}>
          <Link href="/inspectors">ניהול בנק מפקחים וחותמות ←</Link>
        </p>

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
    </section>
  );
}
