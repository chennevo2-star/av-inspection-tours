"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Photo, Task } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { deleteTask, listTasksForInspection } from "../../../lib/db/tasks";
import { getPhotoBlob } from "../../../lib/db/photos";
import { EditTaskModal } from "./edit-task-modal";
import styles from "./tasks-table.module.css";

async function handleDeleteTask(task: Task) {
  const confirmed = window.confirm(
    `למחוק את משימה #${task.friendlyNumber}? היא תימחק גם מהדו״ח המסכם ולא ניתן יהיה לשחזר אותה.`
  );
  if (!confirmed) return;
  await deleteTask(task.id);
}

/** "טבלת משימות" — every task from this tour, first-added first, with its photos (this session's user
 * request — flipped from an earlier most-recent-first ordering per direct feedback). A full-screen
 * overlay like the wizard, not a separate route, so it can be opened/closed instantly without losing the
 * main tour screen's state. Deletion here is real (user request: deleting a task here or from the summary
 * report removes it in both) -- this list is live-queried, so a delete from either screen is reflected the
 * next time this one is opened. Clicking a card (user request, 2026-09-19: every field a task has should
 * be editable, including adding photos) opens EditTaskModal for that task -- everywhere except the
 * delete button itself, which stops the click from also opening edit. */
export function TasksTable({ inspectionId, onClose }: { inspectionId: string; onClose: () => void }) {
  const tasks = useLiveQuery(() => listTasksForInspection(inspectionId), [inspectionId]);
  const floors = useLiveQuery(() => getLocalDb().floors.toArray(), []);
  const rooms = useLiveQuery(() => getLocalDb().rooms.toArray(), []);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

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
                onEdit={() => setEditingTask(task)}
              />
            ))}
          </ul>
        )}
      </div>

      {editingTask ? (
        <EditTaskModal task={editingTask} projectId={editingTask.projectId} onClose={() => setEditingTask(null)} />
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  floorName,
  roomName,
  onEdit,
}: {
  task: Task;
  floorName?: string;
  roomName?: string;
  onEdit: () => void;
}) {
  const photos = useLiveQuery(
    () => getLocalDb().photos.where("taskId").equals(task.id).toArray(),
    [task.id]
  );

  const location = [floorName, roomName].filter(Boolean).join(" · ");

  return (
    <li className={styles.card} onClick={onEdit} role="button" tabIndex={0}>
      <div className={styles.cardTop}>
        <span className={styles.taskNumber}>#{task.friendlyNumber}</span>
        {location ? <span className={styles.location}>{location}</span> : null}
        <span className={styles.cardTopSpacer} />
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            void handleDeleteTask(task);
          }}
          aria-label={`מחק משימה #${task.friendlyNumber}`}
        >
          🗑️
        </button>
      </div>
      <p className={styles.description}>{task.description}</p>
      <div className={styles.metaRow}>
        <span>{task.responsibleParties.length > 0 ? <>באחריות: <span className={styles.responsible}>{task.responsibleParties.join(", ")}</span></> : "לא הוגדר אחראי"}</span>
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
