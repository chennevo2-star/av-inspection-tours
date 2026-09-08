"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { Inspection, Project } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { endInspection } from "../../../lib/db/inspections";
import { getCurrentPosition, logContextEvent } from "../../../lib/db/context-events";
import { capturePhoto } from "../../../lib/db/photos";
import { useAudioRecorder } from "../../../lib/recording/use-audio-recorder";
import { useMounted } from "../../../lib/hooks/use-mounted";
import { FloorRoomPanel } from "./floor-room-panel";
import { QuickNotePanel } from "./quick-note-panel";
import { QuickIssuePanel } from "./quick-issue-panel";
import { QuickTaskPanel } from "./quick-task-panel";
import styles from "./tour-screen.module.css";

type ActivePanel = "room" | "note" | "issue" | "task" | null;

function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Dexie's `.get()` resolves to `undefined` both while a query hasn't run yet AND when the record
// genuinely doesn't exist — same footgun already hit once in app/projects/[id]/project-screen.tsx, so
// same fix: a discriminated result instead of a bare `Inspection | undefined`.
type InspectionLookup = { state: "loading" } | { state: "not-found" } | { state: "found"; inspection: Inspection };

export function TourScreen({ inspectionId }: { inspectionId: string }) {
  const mounted = useMounted();

  const lookup = useLiveQuery<InspectionLookup>(async () => {
    if (!mounted) return { state: "loading" };
    const inspection = await getLocalDb().inspections.get(inspectionId);
    return inspection ? { state: "found", inspection } : { state: "not-found" };
  }, [mounted, inspectionId]);

  if (lookup === undefined || lookup.state === "loading") {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint} style={{ padding: 20 }}>
          טוען…
        </p>
      </main>
    );
  }

  if (lookup.state === "not-found") {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint} style={{ padding: 20 }}>
          הסיור לא נמצא במכשיר זה.
        </p>
      </main>
    );
  }

  return <ActiveTour inspection={lookup.inspection} />;
}

function ActiveTour({ inspection }: { inspection: Inspection }) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ended, setEnded] = useState(inspection.endTime !== null);
  const [ending, setEnding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const project = useLiveQuery<Project | undefined>(
    () => getLocalDb().projects.get(inspection.projectId),
    [inspection.projectId]
  );

  const position = useLiveQuery(() => getCurrentPosition(inspection.id), [inspection.id]) ?? {
    floorId: null,
    roomId: null,
  };

  // Wrapped in an `async` arrow (not a bare ternary between two differently-shaped Promise types) so
  // TS infers a single consistent `Promise<Floor | undefined>` — a ternary between Dexie's
  // `PromiseExtended<Floor | undefined>` and a plain `Promise.resolve(undefined)` confused useLiveQuery's
  // generic inference into typing the result as the raw Promise itself instead of its resolved value.
  const floor = useLiveQuery(async () => {
    if (!position.floorId) return undefined;
    return getLocalDb().floors.get(position.floorId);
  }, [position.floorId]);
  const room = useLiveQuery(async () => {
    if (!position.roomId) return undefined;
    return getLocalDb().rooms.get(position.roomId);
  }, [position.roomId]);

  const issueCount = useLiveQuery(
    () => getLocalDb().issues.where("inspectionId").equals(inspection.id).count(),
    [inspection.id]
  );
  const photoCount = useLiveQuery(
    () => getLocalDb().photos.where("inspectionId").equals(inspection.id).count(),
    [inspection.id]
  );
  const priorAudioChunks = useLiveQuery(
    () => getLocalDb().audioChunks.where("inspectionId").equals(inspection.id).count(),
    [inspection.id]
  );

  const recorder = useAudioRecorder(inspection.id, () => ({
    floorId: position.floorId,
    roomId: position.roomId,
  }));

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 3500);
  }

  async function handleSelectFloor(floorId: string) {
    await logContextEvent(inspection.id, "enter_floor", { floorId });
  }

  async function handleSelectRoom(floorId: string, roomId: string) {
    await logContextEvent(inspection.id, "enter_room", { floorId, roomId });
  }

  async function handlePhotoButton() {
    fileInputRef.current?.click();
  }

  async function handlePhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow selecting the same file again later
    if (!file) return;

    const photo = await capturePhoto(inspection.id, file, { floorId: position.floorId, roomId: position.roomId });
    await logContextEvent(inspection.id, "photo_captured", {
      floorId: position.floorId,
      roomId: position.roomId,
      refId: photo.id,
    });
    showToast("📷 התמונה נשמרה. אפשר ללחוץ 🎙️ דבר על התמונה ולתאר מה רואים.");
  }

  async function handleTalkAboutPhoto() {
    if (recorder.status === "idle" || recorder.status === "error" || recorder.status === "interrupted") {
      await recorder.start();
      await logContextEvent(inspection.id, "recording_started", { floorId: position.floorId, roomId: position.roomId });
    } else if (recorder.status === "paused") {
      recorder.resume();
      await logContextEvent(inspection.id, "recording_resumed", { floorId: position.floorId, roomId: position.roomId });
    }
    showToast("🎙️ מקליט — אפשר לתאר בקול מה רואים בתמונה.");
  }

  async function handleToggleRecording() {
    if (recorder.status === "recording") {
      recorder.pause();
      await logContextEvent(inspection.id, "recording_paused", { floorId: position.floorId, roomId: position.roomId });
    } else if (recorder.status === "paused") {
      recorder.resume();
      await logContextEvent(inspection.id, "recording_resumed", { floorId: position.floorId, roomId: position.roomId });
    } else {
      await recorder.start();
      await logContextEvent(inspection.id, "recording_started", { floorId: position.floorId, roomId: position.roomId });
    }
  }

  async function handleEndTour() {
    const confirmed = window.confirm("לסיים את הסיור? כל המידע כבר שמור במכשיר.");
    if (!confirmed) return;
    setEnding(true);
    try {
      if (recorder.status !== "idle") {
        await recorder.stop();
      }
      await endInspection(inspection.id);
      setEnded(true);
    } finally {
      setEnding(false);
    }
  }

  if (ended) {
    return (
      <main className={styles.wrap}>
        <div className={styles.doneScreen}>
          <div className={styles.doneTitle}>✅ הסיור נשמר בהצלחה במכשיר</div>
          <p className={styles.doneHint}>
            ניתוח AI והפקת הדוח יבוצעו לאחר חיבור מנוע הסנכרון (שלב 4) והשלמת הסנכרון לענן — עדיין לא
            זמין בשלב זה של הפיתוח. שום מידע מהסיור לא אבד: הוא שמור במלואו במכשיר.
          </p>
          <Link href={`/projects/${inspection.projectId}`} className={styles.doneButton}>
            חזרה לפרויקט
          </Link>
        </div>
      </main>
    );
  }

  const recDotClass = recorder.status === "paused" ? styles.recDotPaused : styles.recDot;
  const showRecordingIndicator = recorder.status === "recording" || recorder.status === "paused";

  return (
    <main className={styles.wrap}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handlePhotoSelected}
      />

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <div className={styles.projectName}>{project?.name ?? "…"}</div>
            <div className={styles.inspectionNumber}>סיור #{inspection.inspectionNumber}</div>
          </div>
          <Link href={`/projects/${inspection.projectId}`} className={styles.exitLink}>
            יציאה
          </Link>
        </div>

        <div className={styles.positionRow}>
          {floor ? `🏢 ${floor.name}` : <span className={styles.positionMuted}>לא נבחרה קומה</span>}
          {floor && room ? " · " : null}
          {room ? `🚪 ${room.name}` : floor ? <span className={styles.positionMuted}> · לא נבחר חדר</span> : null}
        </div>

        <div className={styles.recordingRow}>
          {showRecordingIndicator ? (
            <>
              <span className={recDotClass} />
              <span>{recorder.status === "recording" ? "מקליט" : "⏸ מושהה"}</span>
              <span className={styles.timer}>{formatTimer(recorder.elapsedSeconds)}</span>
            </>
          ) : recorder.status === "interrupted" ? (
            <span>⚠ ההקלטה נקטעה</span>
          ) : (
            <span className={styles.positionMuted}>
              {priorAudioChunks && priorAudioChunks > 0 ? "⏸ ההקלטה הופסקה — ניתן להתחיל הקלטה חדשה" : "לא מתבצעת הקלטה"}
            </span>
          )}
          <button className={styles.recActionButton} onClick={handleToggleRecording}>
            {recorder.status === "recording" ? "השהה" : recorder.status === "paused" ? "המשך" : "🔴 התחל הקלטה"}
          </button>
        </div>

        {recorder.errorMessage ? <div className={styles.recErrorBanner}>{recorder.errorMessage}</div> : null}
      </header>

      {toast ? <div className={styles.toast}>{toast}</div> : null}

      <div className={styles.grid}>
        <button className={styles.bigButton} onClick={handlePhotoButton}>
          <span className={styles.bigButtonIcon}>📷</span>
          צילום {photoCount ? `(${photoCount})` : ""}
        </button>
        <button className={styles.bigButton} onClick={handleTalkAboutPhoto}>
          <span className={styles.bigButtonIcon}>🎙️</span>
          דבר על התמונה
        </button>
        <button
          className={`${styles.bigButton} ${activePanel === "issue" ? styles.bigButtonActive : ""}`}
          onClick={() => setActivePanel(activePanel === "issue" ? null : "issue")}
        >
          <span className={styles.bigButtonIcon}>⚠️</span>
          ליקוי {issueCount ? `(${issueCount})` : ""}
        </button>
        <button
          className={`${styles.bigButton} ${activePanel === "note" ? styles.bigButtonActive : ""}`}
          onClick={() => setActivePanel(activePanel === "note" ? null : "note")}
        >
          <span className={styles.bigButtonIcon}>📝</span>
          הערה
        </button>
        <button
          className={`${styles.bigButton} ${activePanel === "task" ? styles.bigButtonActive : ""}`}
          onClick={() => setActivePanel(activePanel === "task" ? null : "task")}
        >
          <span className={styles.bigButtonIcon}>✅</span>
          משימה
        </button>
        <button
          className={`${styles.bigButton} ${activePanel === "room" ? styles.bigButtonActive : ""}`}
          onClick={() => setActivePanel(activePanel === "room" ? null : "room")}
        >
          <span className={styles.bigButtonIcon}>🚪🏢</span>
          החלף חדר/קומה
        </button>
      </div>

      {activePanel === "room" ? (
        <FloorRoomPanel
          projectId={inspection.projectId}
          currentFloorId={position.floorId}
          currentRoomId={position.roomId}
          onSelectFloor={handleSelectFloor}
          onSelectRoom={handleSelectRoom}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "note" ? (
        <QuickNotePanel
          inspectionId={inspection.id}
          projectId={inspection.projectId}
          floorId={position.floorId}
          roomId={position.roomId}
          onSaved={() => showToast("📝 ההערה נשמרה")}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "issue" ? (
        <QuickIssuePanel
          inspectionId={inspection.id}
          projectId={inspection.projectId}
          floorId={position.floorId}
          roomId={position.roomId}
          onSaved={() => showToast("⚠️ הליקוי נשמר")}
          onClose={() => setActivePanel(null)}
        />
      ) : null}
      {activePanel === "task" ? (
        <QuickTaskPanel
          inspectionId={inspection.id}
          projectId={inspection.projectId}
          onSaved={() => showToast("✅ המשימה נשמרה")}
          onClose={() => {}}
        />
      ) : null}

      <button className={styles.endButton} onClick={handleEndTour} disabled={ending}>
        {ending ? "מסיים…" : "■ סיום סיור"}
      </button>
    </main>
  );
}
