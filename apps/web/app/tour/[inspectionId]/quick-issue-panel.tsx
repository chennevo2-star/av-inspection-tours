"use client";

import { useState, type FormEvent } from "react";
import { IssueCategory, Priority } from "@av-inspection/shared-types";
import { createIssue } from "../../../lib/db/issues";
import styles from "./tour-screen.module.css";

export function QuickIssuePanel({
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
  const [subject, setSubject] = useState("");
  const [finding, setFinding] = useState("");
  const [category, setCategory] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !finding.trim()) return;
    setSaving(true);
    try {
      await createIssue(
        inspectionId,
        projectId,
        { floorId, roomId },
        {
          subject: subject.trim(),
          finding: finding.trim(),
          category: category ? (category as IssueCategory) : null,
          priority: priority ? (priority as Priority) : null,
        }
      );
      setSubject("");
      setFinding("");
      setCategory("");
      setPriority("");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>⚠️ ליקוי חדש</span>
        <button className={styles.panelClose} onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.panelInput}
          placeholder="נושא (למשל: חיבור HDMI)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          autoFocus
        />
        <textarea
          className={styles.panelTextarea}
          rows={3}
          placeholder="תיאור הממצא"
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
        />
        <select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">קטגוריה (לא חובה)</option>
          {IssueCategory.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select className={styles.select} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">עדיפות (לא חובה)</option>
          {Priority.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button className={styles.panelSubmit} type="submit" disabled={saving || !subject.trim() || !finding.trim()}>
          {saving ? "שומר…" : "שמור ליקוי"}
        </button>
      </form>
    </section>
  );
}
