"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createTask } from "../../../lib/db/tasks";
import { capturePhoto } from "../../../lib/db/photos";
import { useSpeechDictation } from "../../../lib/recording/use-speech-dictation";
import { LocationStep, PhotoGrid, DescriptionStep, ResponsibleStep, useResponsibleOptions } from "./task-form-fields";
import styles from "./new-task-wizard.module.css";

interface DraftPhoto {
  key: string;
  blob: Blob;
  previewUrl: string;
}

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: "באיזו קומה וחדר?",
  2: "תמונות (לא חובה)",
  3: "תיאור",
  4: "באחריות מי?",
};

/**
 * The New Task wizard (spec, this session's user request) — the primary way a task enters the system
 * now, replacing the old separate ⚠️ ליקוי/📝 הערה quick-panels. Nothing is written to the database until
 * the final "✓ אשר משימה" — every step before that is pure local draft state, so going back with the
 * ← הקודם button never loses anything the user already entered (spec's own explicit requirement).
 */
export function NewTaskWizard({
  inspectionId,
  projectId,
  onClose,
  onTaskCreated,
}: {
  inspectionId: string;
  projectId: string;
  onClose: () => void;
  onTaskCreated: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [description, setDescription] = useState("");
  // Multiple contractors can share responsibility for one task (user request: a checkbox multi-select
  // list here, same pattern as the project's own "רשימת קבלנים" picker) -- was a single selected name.
  const [responsibleParties, setResponsibleParties] = useState<Set<string>>(new Set());
  const [newResponsibleName, setNewResponsibleName] = useState("");
  // Ad-hoc names typed during THIS wizard session, before their task has actually been saved yet (so
  // useResponsibleOptions's own tour-scoped derivation, based on already-saved tasks, can't see them).
  // Merged with that list for display so a second "type a new name" this same session doesn't need
  // retyping -- reset per wizard open, not persisted anywhere on its own; it only sticks around because
  // the task that used it gets saved with that name.
  const [sessionAdHocNames, setSessionAdHocNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const dictation = useSpeechDictation((text) => {
    setDescription((current) => (current ? `${current} ${text}` : text));
  });

  // Revoke every draft photo's object URL on unmount, whenever that happens — avoids leaking memory for
  // a wizard the user might open/cancel many times in one tour.
  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  // Tasks are assigned to CONTRACTORS (a project-level, fixed list — see contractors-section.tsx), not to
  // the tour's own participants (who's physically present, a separate and unrelated concept) — a real
  // mismatch this session's user request pointed out: the wizard used to offer `participants` here.
  const responsibleOptions = useResponsibleOptions(projectId, inspectionId, sessionAdHocNames);

  function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow selecting/retaking the same shot again
    if (!file) return;
    setPhotos((current) => [...current, { key: crypto.randomUUID(), blob: file, previewUrl: URL.createObjectURL(file) }]);
  }

  function removePhoto(key: string) {
    setPhotos((current) => {
      const target = current.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((p) => p.key !== key);
    });
  }

  function toggleResponsible(name: string) {
    setResponsibleParties((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleAddResponsible() {
    const name = newResponsibleName.trim();
    if (!name) return;
    if (!responsibleOptions.some((option) => option.name === name)) {
      setSessionAdHocNames((current) => [...current, name]);
    }
    setResponsibleParties((current) => new Set(current).add(name));
    setNewResponsibleName("");
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const task = await createTask({
        projectId,
        inspectionId,
        description: description.trim() || "(ללא תיאור)",
        responsibleParties: [...responsibleParties],
        floorId,
        roomId,
      });
      for (const photo of photos) {
        await capturePhoto(inspectionId, photo.blob, { floorId, roomId, taskId: task.id });
      }
      onTaskCreated();
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (step < 4) setStep((s) => (s + 1) as Step);
    else void handleConfirm();
  }

  function goPrev() {
    if (step > 1) setStep((s) => (s - 1) as Step);
    else onClose();
  }

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <button className={styles.closeButton} onClick={onClose} aria-label="סגור">
          ✕
        </button>
        <div className={styles.stepDots}>
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <span key={s} className={`${styles.dot} ${s === step ? styles.dotActive : ""}`} />
          ))}
        </div>
      </header>
      <h1 className={styles.stepTitle}>{STEP_TITLES[step]}</h1>

      <div className={styles.body}>
        {step === 1 ? (
          <LocationStep
            projectId={projectId}
            floorId={floorId}
            roomId={roomId}
            onSelectFloor={(id) => {
              setFloorId(id);
              setRoomId(null);
            }}
            onSelectRoom={setRoomId}
          />
        ) : null}
        {step === 2 ? (
          <PhotoGrid
            photos={photos.map((p) => ({ key: p.key, previewUrl: p.previewUrl }))}
            onAdd={() => fileInputRef.current?.click()}
            onRemove={removePhoto}
            addLabel={photos.length > 0 ? "הוסף תמונה נוספת" : "הוסף תמונה (לא חובה)"}
          />
        ) : null}
        {step === 3 ? (
          <DescriptionStep description={description} onChange={setDescription} dictation={dictation} autoFocus />
        ) : null}
        {step === 4 ? (
          <ResponsibleStep
            options={responsibleOptions}
            selected={responsibleParties}
            onToggle={toggleResponsible}
            newName={newResponsibleName}
            onNewNameChange={setNewResponsibleName}
            onAddNew={handleAddResponsible}
          />
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handlePhotoSelected}
      />

      <footer className={styles.footer}>
        <button className={styles.secondaryButton} onClick={goPrev}>
          {step === 1 ? "ביטול" : "→ הקודם"}
        </button>
        <button className={styles.primaryButton} onClick={goNext} disabled={submitting}>
          {step === 4 ? (submitting ? "שומר…" : "✓ אשר משימה") : "הבא ←"}
        </button>
      </footer>
    </div>
  );
}
