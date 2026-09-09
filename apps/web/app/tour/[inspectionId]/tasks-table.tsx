"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Photo, Task } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { listTasksForInspection } from "../../../lib/db/tasks";
import { getPhotoBlob } from "../../../lib/db/photos";
import styles from "./tasks-table.module.css";

/** "טבלת משימות" — every task from this tour, first-added first, with its photos (this session's user
 * request — flipped from an earlier most-recent-first ordering per direct feedback). A full-screen
 * overlay like the wizard, not a separate route, so it can be opened/closed instantly without losing the
 * main tour screen's state. */
export function TasksTable({ inspectionId, onClose }: { inspectionId: string; onClose: () => void }) {
  const tasks = useLiveQuery(() => listTasksForInspection(inspectionId), [inspectionId]);
  const floors = useLiveQuery(() => getLocalDb().floors.toArray(), []);
  const rooms = useLiveQuery(() => getLocalDb().rooms.toArray(), []);

  const floorNames = new Map((floors ?? []).map((f) => [f.id, f.name]));
  const roomNames = new Map((rooms ?? []).map((r) => [r.id, r.name]));

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <button className={styles.closeButton} onClick={onClose} aria-label="סגור">
          ✕
        </button>
        <h1 className={styles.title}>טבלת משימות</h1>
      </header>

      <div className={styles.body}>
        {tasks === undefined ? (
          <p className={styles.empty}>טוען…</p>
        ) : tasks.length === 0 ? (
          <p className={styles.empty}>אין עדיין משימות בסיור זה.</p>
        ) : (
          <ul className={styles.list}>
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                floorName={task.floorId ? floorNames.get(task.floorId) : undefined}
                roomName={task.roomId ? roomNames.get(task.roomId) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, floorName, roomName }: { task: Task; floorName?: string; roomName?: string }) {
  const photos = useLiveQuery(
    () => getLocalDb().photos.where("taskId").equals(task.id).toArray(),
    [task.id]
  );

  const location = [floorName, roomName].filter(Boolean).join(" · ");

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.taskNumber}>#{task.friendlyNumber}</span>
        {location ? <span className={styles.location}>{location}</span> : null}
      </div>
      <p className={styles.description}>{task.description}</p>
      <div className={styles.metaRow}>
        <span>{task.responsibleParty ? <>באחריות: <span className={styles.responsible}>{task.responsibleParty}</span></> : "לא הוגדר אחראי"}</span>
        <span>{task.status}</span>
      </div>
      {photos && photos.length > 0 ? (
        <div className={styles.photoRow}>
          {photos.map((photo) => (
            <TaskPhotoThumb key={photo.id} photo={photo} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function TaskPhotoThumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void getPhotoBlob(photo.localFileId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.localFileId]);

  if (!url) return <div className={styles.photoThumb} />;
  // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
  return (
    <div className={styles.photoThumb}>
      <img src={url} alt="" />
    </div>
  );
}
