"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Room } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { createTask } from "../../../lib/db/tasks";
import { capturePhoto } from "../../../lib/db/photos";
import { addParticipant } from "../../../lib/db/inspections";
import { useSpeechDictation, type UseSpeechDictationResult } from "../../../lib/recording/use-speech-dictation";
import styles from "./new-task-wizard.module.css";

interface DraftPhoto {
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
  participants,
  onParticipantsChanged,
  onClose,
  onTaskCreated,
}: {
  inspectionId: string;
  projectId: string;
  participants: string[];
  onParticipantsChanged: (participants: string[]) => void;
  onClose: () => void;
  onTaskCreated: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [description, setDescription] = useState("");
  const [responsibleParty, setResponsibleParty] = useState<string | null>(null);
  const [newParticipantName, setNewParticipantName] = useState("");
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

  function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow selecting/retaking the same shot again
    if (!file) return;
    setPhotos((current) => [...current, { blob: file, previewUrl: URL.createObjectURL(file) }]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  async function handleAddParticipant() {
    const name = newParticipantName.trim();
    if (!name) return;
    const updated = await addParticipant(inspectionId, name);
    onParticipantsChanged(updated.participants);
    setResponsibleParty(name);
    setNewParticipantName("");
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const task = await createTask({
        projectId,
        inspectionId,
        description: description.trim() || "(ללא תיאור)",
        responsibleParty,
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
          <PhotosStep photos={photos} onAdd={() => fileInputRef.current?.click()} onRemove={removePhoto} />
        ) : null}
        {step === 3 ? (
          <DescriptionStep description={description} onChange={setDescription} dictation={dictation} />
        ) : null}
        {step === 4 ? (
          <ResponsibleStep
            participants={participants}
            selected={responsibleParty}
            onSelect={setResponsibleParty}
            newName={newParticipantName}
            onNewNameChange={setNewParticipantName}
            onAddParticipant={handleAddParticipant}
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
          {step === 1 ? "ביטול" : "← הקודם"}
        </button>
        <button className={styles.primaryButton} onClick={goNext} disabled={submitting}>
          {step === 4 ? (submitting ? "שומר…" : "✓ אשר משימה") : "הבא ←"}
        </button>
      </footer>
    </div>
  );
}

function LocationStep({
  projectId,
  floorId,
  roomId,
  onSelectFloor,
  onSelectRoom,
}: {
  projectId: string;
  floorId: string | null;
  roomId: string | null;
  onSelectFloor: (id: string) => void;
  onSelectRoom: (id: string) => void;
}) {
  const floors = useLiveQuery(async () => {
    const rows = await getLocalDb().floors.where("projectId").equals(projectId).toArray();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [projectId]);

  const rooms = useLiveQuery(
    () => (floorId ? getLocalDb().rooms.where("floorId").equals(floorId).toArray() : Promise.resolve<Room[]>([])),
    [floorId]
  );

  if (floors === undefined) return <p className={styles.skipHint}>טוען…</p>;
  if (floors.length === 0) {
    return (
      <p className={styles.skipHint}>
        אין עדיין קומות בפרויקט זה. ניתן להמשיך בלי לבחור — אפשר להוסיף קומות מעמוד הפרויקט.
      </p>
    );
  }

  return (
    <ul className={styles.floorList}>
      {floors.map((floor) => (
        <li key={floor.id}>
          <button
            className={`${styles.floorButton} ${floor.id === floorId ? styles.floorButtonActive : ""}`}
            onClick={() => onSelectFloor(floor.id)}
          >
            <span>🏢 {floor.name}</span>
          </button>
          {floor.id === floorId ? (
            <div className={styles.roomGrid}>
              {rooms === undefined ? (
                <span className={styles.skipHint}>טוען חדרים…</span>
              ) : rooms.length === 0 ? (
                <span className={styles.skipHint}>אין חדרים בקומה זו.</span>
              ) : (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    className={`${styles.roomChip} ${room.id === roomId ? styles.roomChipActive : ""}`}
                    onClick={() => onSelectRoom(room.id)}
                  >
                    {room.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PhotosStep({
  photos,
  onAdd,
  onRemove,
}: {
  photos: DraftPhoto[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      {photos.length > 0 ? (
        <div className={styles.photoGrid}>
          {photos.map((photo, index) => (
            <div key={photo.previewUrl} className={styles.photoThumb}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image */}
              <img src={photo.previewUrl} alt="" />
              <button className={styles.removePhotoButton} onClick={() => onRemove(index)} aria-label="הסר תמונה">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button className={styles.addPhotoButton} onClick={onAdd} type="button">
        📷 {photos.length > 0 ? "הוסף תמונה נוספת" : "הוסף תמונה (לא חובה)"}
      </button>
    </div>
  );
}

function DescriptionStep({
  description,
  onChange,
  dictation,
}: {
  description: string;
  onChange: (value: string) => void;
  dictation: UseSpeechDictationResult;
}) {
  return (
    <div>
      <textarea
        className={styles.descriptionArea}
        value={description}
        onChange={(event) => onChange(event.target.value)}
        placeholder="תאר את הממצא/המשימה…"
        autoFocus
      />
      <div className={styles.dictateRow}>
        {!dictation.checked ? null : dictation.status === "unsupported" ? (
          <span className={styles.dictateHint}>הכתבה קולית לא נתמכת בדפדפן זה — אפשר להקליד.</span>
        ) : (
          <button
            type="button"
            className={`${styles.dictateButton} ${dictation.status === "listening" ? styles.dictateButtonListening : ""}`}
            onClick={dictation.status === "listening" ? dictation.stop : dictation.start}
          >
            🎙️ {dictation.status === "listening" ? "מקשיב… (לחץ לעצירה)" : "הכתב בקול"}
          </button>
        )}
      </div>
      {dictation.errorMessage ? <p className={styles.dictateHint}>{dictation.errorMessage}</p> : null}
    </div>
  );
}

function ResponsibleStep({
  participants,
  selected,
  onSelect,
  newName,
  onNewNameChange,
  onAddParticipant,
}: {
  participants: string[];
  selected: string | null;
  onSelect: (name: string) => void;
  newName: string;
  onNewNameChange: (value: string) => void;
  onAddParticipant: () => void;
}) {
  return (
    <div>
      {participants.length > 0 ? (
        <div className={styles.participantGrid}>
          {participants.map((name) => (
            <button
              key={name}
              type="button"
              className={`${styles.participantChip} ${name === selected ? styles.participantChipActive : ""}`}
              onClick={() => onSelect(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.skipHint}>אין עדיין משתתפים רשומים לסיור זה — אפשר להוסיף ידנית למטה.</p>
      )}
      <div className={styles.addParticipantRow}>
        <input
          placeholder="הוסף שם ידנית"
          value={newName}
          onChange={(event) => onNewNameChange(event.target.value)}
          aria-label="הוסף משתתף ידנית"
        />
        <button type="button" onClick={onAddParticipant}>
          הוסף
        </button>
      </div>
    </div>
  );
}
