"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Inspector } from "@av-inspection/shared-types";
import {
  createInspector,
  deleteInspector,
  getInspectorStampBlob,
  listInspectors,
  setInspectorStamp,
} from "../../lib/db/inspectors";
import { useMounted } from "../../lib/hooks/use-mounted";
import styles from "./inspectors-screen.module.css";

/**
 * "עריכת מפקח" (session's user request): manage the reusable bank of inspectors/supervisors, each with
 * an optional stamp image embedded on a generated report's closing page. Reachable from the home screen.
 */
export function InspectorsScreen() {
  const mounted = useMounted();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const inspectors = useLiveQuery(() => (mounted ? listInspectors() : Promise.resolve<Inspector[]>([])), [mounted]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createInspector(name);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(inspector: Inspector) {
    const confirmed = window.confirm(`למחוק את "${inspector.name}" מבנק המפקחים?`);
    if (!confirmed) return;
    await deleteInspector(inspector.id);
  }

  return (
    <main className={styles.main}>
      <Link href="/settings" className={styles.backLink}>
        ← חזרה להגדרות
      </Link>
      <h1 className={styles.title}>עריכת מפקח</h1>
      <p className={styles.hint}>בנק המפקחים משמש לבחירת המפקח בתחילת סיור, וחותמת המפקח מוטמעת בסוף דו״ח שיוצא.</p>

      <form className={styles.addForm} onSubmit={handleCreate}>
        <input
          className={styles.input}
          placeholder="שם מפקח חדש"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          aria-label="שם מפקח חדש"
        />
        <button className={styles.addButton} type="submit" disabled={creating || !newName.trim()}>
          הוסף מפקח +
        </button>
      </form>

      {!mounted || inspectors === undefined ? (
        <p className={styles.empty}>טוען…</p>
      ) : inspectors.length === 0 ? (
        <p className={styles.empty}>אין עדיין מפקחים בבנק. הוסף מפקח ראשון למעלה.</p>
      ) : (
        <ul className={styles.list}>
          {inspectors.map((inspector) => (
            <InspectorCard key={inspector.id} inspector={inspector} onDelete={() => handleDelete(inspector)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function InspectorCard({ inspector, onDelete }: { inspector: Inspector; onDelete: () => void }) {
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (inspector.stampLocalFileId) {
      void getInspectorStampBlob(inspector.stampLocalFileId).then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setStampUrl(objectUrl);
      });
    } else {
      setStampUrl(null);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [inspector.stampLocalFileId]);

  async function handleStampSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await setInspectorStamp(inspector.id, file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <li className={styles.card}>
      <div className={styles.stampThumb}>
        {stampUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
          <img src={stampUrl} alt="" />
        ) : (
          "✍️"
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.name}>{inspector.name}</div>
        <div className={styles.stampStatus}>{inspector.stampLocalFileId ? "יש חותמת" : "אין עדיין חותמת"}</div>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.stampButton} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? "מטמיע…" : inspector.stampLocalFileId ? "החלף חותמת" : "הטמע חותמת"}
        </button>
        <button type="button" className={styles.deleteButton} onClick={onDelete}>
          מחק מפקח
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleStampSelected} />
    </li>
  );
}
