"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Room } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import type { UseSpeechDictationResult } from "../../../lib/recording/use-speech-dictation";
import styles from "./task-form-fields.module.css";

/**
 * Task-editing form fields shared between new-task-wizard.tsx (a fresh task) and edit-task-modal.tsx (an
 * existing one) -- extracted 2026-09-19 when the edit screen needed the identical location/description/
 * responsible-party UI a second time. Deliberately just the fields + their own local UI state (e.g. the
 * responsible-party category filter); each caller owns the actual form state and submit/save behavior,
 * since those genuinely differ (a multi-step wizard that only writes on final confirm vs. a single-page
 * editor that writes immediately per field).
 */

export function LocationStep({
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
            type="button"
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
                    type="button"
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

export interface PhotoTile {
  key: string;
  previewUrl: string | null; // null while a real photo's blob URL is still loading
}

/** Pure presentational grid -- doesn't know or care whether a tile is an already-saved photo or a new
 * draft one; each caller supplies its own tiles + remove handler for that distinction. */
export function PhotoGrid({
  photos,
  onAdd,
  onRemove,
  addLabel,
}: {
  photos: PhotoTile[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  addLabel: string;
}) {
  return (
    <div>
      {photos.length > 0 ? (
        <div className={styles.photoGrid}>
          {photos.map((photo) => (
            <div key={photo.key} className={styles.photoThumb}>
              {photo.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
                <img src={photo.previewUrl} alt="" />
              ) : null}
              <button type="button" className={styles.removePhotoButton} onClick={() => onRemove(photo.key)} aria-label="הסר תמונה">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className={styles.addPhotoButton} onClick={onAdd}>
        📷 {addLabel}
      </button>
    </div>
  );
}

export function DescriptionStep({
  description,
  onChange,
  dictation,
  autoFocus = false,
}: {
  description: string;
  onChange: (value: string) => void;
  dictation: UseSpeechDictationResult;
  /** The wizard's own single-field step wants this (nothing else on screen to jerk focus from); the
   * edit screen's flat multi-field layout does not, so it defaults off. */
  autoFocus?: boolean;
}) {
  return (
    <div>
      <textarea
        className={styles.descriptionArea}
        value={description}
        onChange={(event) => onChange(event.target.value)}
        placeholder="תאר את הממצא/המשימה…"
        autoFocus={autoFocus}
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

export const UNCATEGORIZED = "ללא קטגוריה";

export function groupByField(options: { name: string; field: string | null }[]): Array<[string, string[]]> {
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
 * A real, grouped, checkbox-driven list (user request: a task can be shared by more than one contractor)
 * -- mirrors projects/[id]/contractor-picker-modal.tsx's own "list + checkbox, multiple selection"
 * pattern for associating contractors with a project.
 */
export function ResponsibleStep({
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

export function AddResponsibleRow({
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

/**
 * Shared derivation: the checkbox list's options, grouped by real project contractors + tour-scoped
 * ad-hoc names (typed free-text, not in the contractor bank) -- identical logic for the wizard and the
 * edit screen, so both offer exactly the same picks.
 */
export function useResponsibleOptions(
  projectId: string,
  inspectionId: string,
  sessionAdHocNames: string[]
): { name: string; field: string | null }[] {
  const contractors = useLiveQuery(
    () => getLocalDb().contractors.where("projectId").equals(projectId).toArray(),
    [projectId]
  );
  const contractorNames = useMemo(() => (contractors ?? []).map((c) => c.companyName), [contractors]);

  const inspectionTasks = useLiveQuery(
    () => getLocalDb().tasks.where("createdInspectionId").equals(inspectionId).toArray(),
    [inspectionId]
  );
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

  return useMemo(() => {
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
}
