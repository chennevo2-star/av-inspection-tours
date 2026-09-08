"use client";

import { useState, type FormEvent } from "react";
import { createNote } from "../../../lib/db/notes";
import styles from "./tour-screen.module.css";

export function QuickNotePanel({
  inspectionId,
  projectId,
  floorId,
  roomId,
  onSaved,
  onClose,
}: {
  inspectionId: string;
  projectId: string;
  floorId: string | null;
  roomId: string | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createNote(inspectionId, projectId, trimmed, { floorId, roomId });
      setText("");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>📝 הערה</span>
        <button className={styles.panelClose} onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <textarea
          className={styles.panelTextarea}
          rows={3}
          autoFocus
          placeholder="כתוב הערה חופשית…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className={styles.panelSubmit} type="submit" disabled={saving || !text.trim()}>
          {saving ? "שומר…" : "שמור הערה"}
        </button>
      </form>
    </section>
  );
}
