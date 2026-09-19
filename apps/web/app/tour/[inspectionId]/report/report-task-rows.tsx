"use client";

import { useEffect, useRef, useState } from "react";
import { TaskStatus } from "@av-inspection/shared-types";
import type { ReportPhoto, ReportTaskRow } from "@av-inspection/report-generator";
import styles from "./report-screen.module.css";

const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 8;

/**
 * The editable, reorderable, deletable task list in the report preview screen (spec: "drag-reorder via
 * long-press", "delete a row via a trash-can button after selecting it", "editable table text"). Text
 * edits (description/באחריות/status) and deletion write back to the real Task record in IndexedDB (user
 * request: a task deleted here or from the tasks table must be gone from both) -- see report-screen.tsx's
 * own `editTask`/`handleDeleteTask`. Only reordering and the floorName/roomName fields stay purely local
 * to this one export's layout, since a task's floor/room are stored as ids, not names, so there's no real
 * field for those two to write back to.
 *
 * Hand-rolled drag (pointer events, no library) to match this app's existing house style -- every other
 * non-trivial interaction here (speech dictation, the wizard's step flow) is hand-rolled too, and a full
 * drag-and-drop library would be a lot of weight for one reorderable list.
 */
export function ReportTaskRows({
  tasks,
  onEdit,
  onReorder,
  onDelete,
}: {
  tasks: ReportTaskRow[];
  onEdit: (id: string, patch: Partial<ReportTaskRow>) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const longPressTimer = useRef<number | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function findRowIdAtY(y: number): string | null {
    for (const [id, el] of rowRefs.current) {
      const rect = el.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return id;
    }
    return null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>, taskId: string) {
    dragStart.current = { x: event.clientX, y: event.clientY };
    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      setDraggingId(taskId);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>, taskId: string) {
    if (longPressTimer.current !== null) {
      const movedPx = Math.hypot(event.clientX - dragStart.current.x, event.clientY - dragStart.current.y);
      if (movedPx > MOVE_CANCEL_PX) clearLongPressTimer();
      return;
    }
    if (draggingId !== taskId) return;
    const overId = findRowIdAtY(event.clientY);
    if (overId && overId !== taskId) onReorder(taskId, overId);
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    clearLongPressTimer();
    if (activePointerId.current !== null) {
      try {
        event.currentTarget.releasePointerCapture(activePointerId.current);
      } catch {
        // Already released (e.g. pointercancel) -- fine to ignore.
      }
    }
    activePointerId.current = null;
    setDraggingId(null);
  }

  function toggleSelect(taskId: string) {
    setSelectedId((current) => (current === taskId ? null : taskId));
  }

  function handleDelete(taskId: string) {
    const confirmed = window.confirm("למחוק את המשימה הזו? היא תימחק גם מטבלת המשימות ולא ניתן יהיה לשחזר אותה.");
    if (!confirmed) return;
    onDelete(taskId);
    setSelectedId(null);
  }

  if (tasks.length === 0) {
    return <p className={styles.emptyTasks}>לא נרשמו משימות בסיור זה.</p>;
  }

  return (
    <>
      <p className={styles.reorderHint}>לחיצה ארוכה על ⠿ מזיזה שורה. לחיצה על ⭘ בוחרת שורה למחיקה.</p>
      <ul className={styles.taskList}>
        {tasks.map((task, index) => (
          <li
            key={task.id}
            ref={(el) => {
              if (el) rowRefs.current.set(task.id, el);
              else rowRefs.current.delete(task.id);
            }}
            className={[
              styles.taskCard,
              selectedId === task.id ? styles.taskCardSelected : "",
              draggingId === task.id ? styles.taskCardDragging : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={styles.cardTop}>
              <button
                type="button"
                className={styles.dragHandle}
                aria-label="גרור לשינוי סדר"
                onPointerDown={(e) => handlePointerDown(e, task.id)}
                onPointerMove={(e) => handlePointerMove(e, task.id)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                ⠿
              </button>
              {/* Position in the (possibly reordered) list, not the stored friendlyNumber -- a real bug
                  found here: dragging a row used to leave its printed "#N" stuck to the original task
                  instead of following it to its new spot, so the numbers stopped reading sequentially
                  top-to-bottom after any reorder. The DOCX/PDF table numbers the same way (build-docx.ts),
                  so the exported document always matches exactly what was shown here. */}
              <span className={styles.taskNumber}>#{index + 1}</span>
              <span className={styles.cardTopSpacer} />
              {selectedId === task.id ? (
                <button type="button" className={styles.trashButton} aria-label="מחק שורה" onClick={() => handleDelete(task.id)}>
                  🗑️
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.selectCircle} ${selectedId === task.id ? styles.selectCircleActive : ""}`}
                aria-label={selectedId === task.id ? "בטל בחירה" : "בחר שורה"}
                aria-pressed={selectedId === task.id}
                onClick={() => toggleSelect(task.id)}
              >
                ✓
              </button>
            </div>

            <div className={styles.locationRow}>
              <input
                value={task.floorName ?? ""}
                placeholder="קומה"
                aria-label="קומה"
                onChange={(e) => onEdit(task.id, { floorName: e.target.value || null })}
              />
              <input
                value={task.roomName ?? ""}
                placeholder="חדר / אזור"
                aria-label="חדר"
                onChange={(e) => onEdit(task.id, { roomName: e.target.value || null })}
              />
            </div>

            <textarea
              className={styles.descriptionInput}
              value={task.description}
              aria-label="ממצא / דרישה"
              onChange={(e) => onEdit(task.id, { description: e.target.value })}
            />

            <div className={styles.metaEditRow}>
              <input
                value={task.responsibleParty ?? ""}
                placeholder="באחריות"
                aria-label="באחריות"
                onChange={(e) => onEdit(task.id, { responsibleParty: e.target.value || null })}
              />
              <select
                value={task.status}
                aria-label="סטטוס"
                onChange={(e) => onEdit(task.id, { status: e.target.value })}
              >
                {TaskStatus.options.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            {task.photos.length > 0 ? (
              <div className={styles.photoRow}>
                {task.photos.map((photo, index) => (
                  <ReportPhotoThumb key={index} photo={photo} />
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function ReportPhotoThumb({ photo }: { photo: ReportPhoto }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Cast: TS's lib.dom types this Uint8Array as Uint8Array<ArrayBufferLike>, which its own BlobPart
    // type doesn't structurally accept without the generic pinned to ArrayBuffer -- a real TS/lib
    // versioning friction (same category as build-docx.ts's RunStyle/RasterImageType notes), not a
    // runtime concern: `new Blob([uint8ArrayInstance])` has always worked correctly.
    const objectUrl = URL.createObjectURL(new Blob([photo.bytes as BlobPart], { type: photo.mimeType }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  if (!url) return <div className={styles.photoThumb} />;
  // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
  return (
    <div className={styles.photoThumb}>
      <img src={url} alt="" />
    </div>
  );
}
