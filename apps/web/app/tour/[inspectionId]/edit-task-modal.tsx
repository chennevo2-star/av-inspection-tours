"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { TaskStatus } from "@av-inspection/shared-types";
import type { Task } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { updateTask } from "../../../lib/db/tasks";
import { capturePhoto, deletePhoto, getPhotoBlob } from "../../../lib/db/photos";
import { useSpeechDictation } from "../../../lib/recording/use-speech-dictation";
import { LocationStep, PhotoGrid, DescriptionStep, ResponsibleStep, useResponsibleOptions, type PhotoTile } from "./task-form-fields";
import styles from "./edit-task-modal.module.css";

interface DraftPhoto {
  key: string;
  blob: Blob;
  previewUrl: string;
}

/**
 * Full task-edit screen (user request, 2026-09-19: clicking a task in the tasks table should open every
 * field it has for editing, including adding photos) -- a flat, single-page form, not a stepped wizard
 * like NewTaskWizard: all fields already have real values to show at once, so there's no "nothing to lose
 * by going back" reason to force one field at a time. Field edits (location/description/responsible/
 * status/new photos) are staged locally and committed together on "שמור"; deleting an EXISTING photo is
 * immediate + confirmed instead, matching this app's established pattern for every other real delete
 * (deleteTask, deleteProject, …) — removing something that already exists is its own destructive action,
 * not a value waiting to be saved.
 */
export function EditTaskModal({ task, projectId, onClose }: { task: Task; projectId: string; onClose: () => void }) {
  const [floorId, setFloorId] = useState(task.floorId);
  const [roomId, setRoomId] = useState(task.roomId);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState(task.status);
  const [responsibleParties, setResponsibleParties] = useState<Set<string>>(new Set(task.responsibleParties));
  const [newResponsibleName, setNewResponsibleName] = useState("");
  const [sessionAdHocNames, setSessionAdHocNames] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<DraftPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newPhotosRef = useRef(newPhotos);
  newPhotosRef.current = newPhotos;

  const dictation = useSpeechDictation((text) => {
    setDescription((current) => (current ? `${current} ${text}` : text));
  });

  useEffect(() => {
    return () => {
      newPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const existingPhotos = useLiveQuery(() => getLocalDb().photos.where("taskId").equals(task.id).toArray(), [task.id]);
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!existingPhotos) return;
    let cancelled = false;
    const urls: Record<string, string> = {};
    void Promise.all(
      existingPhotos.map(async (photo) => {
        const blob = await getPhotoBlob(photo.localFileId);
        if (blob) urls[photo.id] = URL.createObjectURL(blob);
      })
    ).then(() => {
      if (!cancelled) setExistingPhotoUrls(urls);
    });
    return () => {
      cancelled = true;
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [existingPhotos]);

  const responsibleOptions = useResponsibleOptions(projectId, task.createdInspectionId, sessionAdHocNames);

  function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow selecting/retaking the same shot again
    if (!file) return;
    setNewPhotos((current) => [...current, { key: crypto.randomUUID(), blob: file, previewUrl: URL.createObjectURL(file) }]);
  }

  function removeNewPhoto(key: string) {
    setNewPhotos((current) => {
      const target = current.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((p) => p.key !== key);
    });
  }

  async function handleDeleteExistingPhoto(photoId: string) {
    const confirmed = window.confirm("למחוק את התמונה הזו? לא ניתן יהיה לשחזר אותה.");
    if (!confirmed) return;
    await deletePhoto(photoId);
  }

  function handleRemoveTile(key: string) {
    if (key.startsWith("existing:")) {
      void handleDeleteExistingPhoto(key.slice("existing:".length));
    } else {
      removeNewPhoto(key.slice("new:".length));
    }
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

  async function handleSave() {
    setSaving(true);
    try {
      await updateTask(task.id, {
        description: description.trim() || "(ללא תיאור)",
        responsibleParties: [...responsibleParties],
        status,
        floorId,
        roomId,
      });
      for (const photo of newPhotos) {
        await capturePhoto(task.createdInspectionId, photo.blob, { floorId, roomId, taskId: task.id });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const photoTiles: PhotoTile[] = [
    ...(existingPhotos ?? []).map((p) => ({ key: `existing:${p.id}`, previewUrl: existingPhotoUrls[p.id] ?? null })),
    ...newPhotos.map((p) => ({ key: `new:${p.key}`, previewUrl: p.previewUrl })),
  ];

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגור">
          ✕
        </button>
        <h1 className={styles.title}>עריכת משימה #{task.friendlyNumber}</h1>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>באיזו קומה וחדר?</h2>
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
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>תיאור</h2>
          <DescriptionStep description={description} onChange={setDescription} dictation={dictation} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>סטטוס</h2>
          <select className={styles.statusSelect} value={status} onChange={(e) => setStatus(e.target.value as Task["status"])}>
            {TaskStatus.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>באחריות מי?</h2>
          <ResponsibleStep
            options={responsibleOptions}
            selected={responsibleParties}
            onToggle={toggleResponsible}
            newName={newResponsibleName}
            onNewNameChange={setNewResponsibleName}
            onAddNew={handleAddResponsible}
          />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>תמונות</h2>
          <PhotoGrid
            photos={photoTiles}
            onAdd={() => fileInputRef.current?.click()}
            onRemove={handleRemoveTile}
            addLabel={photoTiles.length > 0 ? "הוסף תמונה נוספת" : "הוסף תמונה"}
          />
        </section>
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
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          ביטול
        </button>
        <button type="button" className={styles.primaryButton} onClick={() => void handleSave()} disabled={saving}>
          {saving ? "שומר…" : "✓ שמור"}
        </button>
      </footer>
    </div>
  );
}
