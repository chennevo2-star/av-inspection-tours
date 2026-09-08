"use client";

import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { closeTask, createTask, listOpenTasks } from "../../../lib/db/tasks";
import styles from "./tour-screen.module.css";

/**
 * Task panel (spec §10 "✅ משימה", §27 — "closes task #14" rather than creating a duplicate). Shows the
 * project's currently-open tasks with a one-tap close, plus a quick form for a brand-new one.
 */
export function QuickTaskPanel({
  inspectionId,
  projectId,
  onSaved,
  onClose,
}: {
  inspectionId: string;
  projectId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const openTasks = useLiveQuery(() => listOpenTasks(projectId), [projectId]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = description.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createTask(projectId, inspectionId, trimmed);
      setDescription("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleClose(taskId: string) {
    setClosingId(taskId);
    try {
      await closeTask(taskId, inspectionId);
      onSaved();
    } finally {
      setClosingId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>✅ משימות</span>
        <button className={styles.panelClose} onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>

      {openTasks && openTasks.length > 0 ? (
        <>
          <p className={styles.hint}>{openTasks.length} משימות פתוחות בפרויקט — אפשר לסגור ישירות מכאן:</p>
          <ul className={styles.panelList}>
            {openTasks.map((task) => (
              <li key={task.id}>
                <div className={styles.panelListItem}>
                  <span>
                    #{task.friendlyNumber} {task.description}
                  </span>
                  <button
                    className={styles.recActionButton}
                    onClick={() => handleClose(task.id)}
                    disabled={closingId === task.id}
                  >
                    {closingId === task.id ? "…" : "✓ סגור"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <form onSubmit={handleCreate}>
        <textarea
          className={styles.panelTextarea}
          rows={2}
          placeholder="משימה חדשה…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className={styles.panelSubmit} type="submit" disabled={saving || !description.trim()}>
          {saving ? "שומר…" : "➕ משימה חדשה"}
        </button>
      </form>
    </section>
  );
}
