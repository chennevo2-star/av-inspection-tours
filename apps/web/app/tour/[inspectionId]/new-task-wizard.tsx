"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Room } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { createTask, listTasksForInspection } from "../../../lib/db/tasks";
import { capturePhoto } from "../../../lib/db/photos";
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
  // `tourAdHocNames` below, which is derived from already-saved tasks, can't see them). Merged with that
  // list for display so a second "type a new name" this same session doesn't need retyping -- reset per
  // wizard open, not persisted anywhere on its own; it only sticks around because the task that used it
  // gets saved with that `responsibleParty` string (see the tour-scoped comment on `tourAdHocNames`).
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
  const contractors = useLiveQuery(
    () => getLocalDb().contractors.where("projectId").equals(projectId).toArray(),
    [projectId]
  );
  const contractorNames = useMemo(() => (contractors ?? []).map((c) => c.companyName), [contractors]);

  // A typed-but-not-a-real-contractor name (user request: still assignable by typing, without adding it
  // to the project's own contractor list) stays an option "of that tour only" — derived from this
  // inspection's own already-saved tasks rather than a new field/table, so it needs nothing extra to
  // persist correctly across a reload mid-tour or a reopened New Task wizard.
  const inspectionTasks = useLiveQuery(() => listTasksForInspection(inspectionId), [inspectionId]);
  const tourAdHocNames = useMemo(() => {
    const contractorSet = new Set(contractorNames);
    const names = new Set<string>();
    for (const task of inspectionTasks ?? []) {
      for (const name of task.responsibleParties) {
        if (!contractorSet.has(name)) names.add(name);
      }
    }
    return [...names];
  }, [inspectionTasks, contractorNames]);

  // Grouped-by-domain checkbox list (user request: same pattern as ContractorPickerModal's "רשימת
  // קבלנים" -- a real list with checkboxes, not a row of single-select chips). Real project contractors
  // carry their own `field` (domain); ad-hoc/typed-only names have none, so they fall into the same
  // "ללא קטגוריה" bucket ResponsibleStep groups under.
  const responsibleOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { name: string; field: string | null }[] = [];
    for (const c of contractors ?? []) {
      if (seen.has(c.companyName)) continue;
      seen.add(c.companyName);
      options.push({ name: c.companyName, field: c.field });
    }
    for (const name of [...tourAdHocNames, ...sessionAdHocNames]) {
      if (seen.has(name)) continue;
      seen.add(name);
      options.push({ name, field: null });
    }
    return options;
  }, [contractors, tourAdHocNames, sessionAdHocNames]);

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
          <PhotosStep photos={photos} onAdd={() => fileInputRef.current?.click()} onRemove={removePhoto} />
        ) : null}
        {step === 3 ? (
          <DescriptionStep description={description} onChange={setDescription} dictation={dictation} />
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

const UNCATEGORIZED = "ללא קטגוריה";

function groupByField(options: { name: string; field: string | null }[]): Array<[string, string[]]> {
  const byField = new Map<string, string[]>();
  for (const option of options) {
    const key = option.field?.trim() || UNCATEGORIZED;
    const list = byField.get(key) ?? [];
    list.push(option.name);
    byField.set(key, list);
  }
  return [...byField.entries()].sort(([a], [b]) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b, "he");
  });
}

/**
 * A real, grouped, checkbox-driven list (user request: replace the old single-select chip row with the
 * same "list + checkbox, multiple selection" pattern already used to associate contractors with a
 * project — see projects/[id]/contractor-picker-modal.tsx, which this mirrors) -- a task can now be
 * shared by more than one contractor.
 */
function ResponsibleStep({
  options,
  selected,
  onToggle,
  newName,
  onNewNameChange,
  onAddNew,
}: {
  options: { name: string; field: string | null }[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  newName: string;
  onNewNameChange: (value: string) => void;
  onAddNew: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const groups = useMemo(() => groupByField(options), [options]);
  const visibleGroups = activeFilter ? groups.filter(([field]) => field === activeFilter) : groups;

  if (options.length === 0) {
    return (
      <div>
        <p className={styles.skipHint}>אין עדיין קבלנים רשומים בפרויקט זה — אפשר להוסיף ידנית למטה.</p>
        <AddResponsibleRow newName={newName} onNewNameChange={onNewNameChange} onAddNew={onAddNew} />
      </div>
    );
  }

  return (
    <div>
      {groups.length > 1 ? (
        <div className={styles.filterRow}>
          <button
            type="button"
            className={`${styles.filterChip} ${activeFilter === null ? styles.filterChipActive : ""}`}
            onClick={() => setActiveFilter(null)}
          >
            הכל ({options.length})
          </button>
          {groups.map(([field, names]) => (
            <button
              key={field}
              type="button"
              className={`${styles.filterChip} ${activeFilter === field ? styles.filterChipActive : ""}`}
              onClick={() => setActiveFilter(field)}
            >
              {field} ({names.length})
            </button>
          ))}
        </div>
      ) : null}

      {visibleGroups.map(([field, names]) => (
        <section key={field} className={styles.responsibleGroup}>
          {groups.length > 1 ? <h2 className={styles.groupTitle}>{field}</h2> : null}
          <ul className={styles.responsibleList}>
            {names.map((name) => (
              <li key={name}>
                <label className={`${styles.responsibleRow} ${selected.has(name) ? styles.responsibleRowSelected : ""}`}>
                  <input type="checkbox" checked={selected.has(name)} onChange={() => onToggle(name)} />
                  <span className={styles.responsibleRowName}>{name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <AddResponsibleRow newName={newName} onNewNameChange={onNewNameChange} onAddNew={onAddNew} />
    </div>
  );
}

function AddResponsibleRow({
  newName,
  onNewNameChange,
  onAddNew,
}: {
  newName: string;
  onNewNameChange: (value: string) => void;
  onAddNew: () => void;
}) {
  return (
    <div className={styles.addParticipantRow}>
      <input
        placeholder="הוסף קבלן שלא ברשימה"
        value={newName}
        onChange={(event) => onNewNameChange(event.target.value)}
        aria-label="הוסף קבלן שלא ברשימה"
      />
      <button type="button" onClick={onAddNew}>
        הוסף
      </button>
    </div>
  );
}
