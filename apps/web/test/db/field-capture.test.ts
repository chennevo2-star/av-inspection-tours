import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "../../lib/db/local-db";
import { startInspection } from "../../lib/db/inspections";
import { createNote, listNotes } from "../../lib/db/notes";
import { createIssue, listIssues } from "../../lib/db/issues";
import { closeTask, createTask, listOpenTasks, listTasksForInspection } from "../../lib/db/tasks";
import { capturePhoto, getPhotoBlob, listPhotos } from "../../lib/db/photos";
import { resetLocalDb } from "./helpers";

const PROJECT = "77777777-7777-7777-7777-777777777777";
const ROOM = "88888888-8888-8888-8888-888888888888";

beforeEach(resetLocalDb);

describe("Note (spec §10 📝 הערה)", () => {
  it("creates a note scoped to the current room and enqueues it for sync", async () => {
    const inspection = await startInspection(PROJECT, "דני");
    const note = await createNote(inspection.id, PROJECT, "יש רעש רקע מוזר במיזוג", { roomId: ROOM });

    expect(note.text).toBe("יש רעש רקע מוזר במיזוג");
    expect(note.roomId).toBe(ROOM);
    expect(note.syncStatus).toBe("LOCAL_ONLY");

    const notes = await listNotes(inspection.id);
    expect(notes).toHaveLength(1);

    const queued = await getLocalDb().syncQueue.where("entityType").equals("Note").toArray();
    expect(queued).toHaveLength(1);
  });
});

describe("Issue (spec §10 ⚠️ ליקוי, §94 QA scenario)", () => {
  it("creates an issue with an incrementing friendly number, no contractor forced at capture time", async () => {
    const inspection = await startInspection(PROJECT, "דני");

    const first = await createIssue(
      inspection.id,
      PROJECT,
      { roomId: ROOM },
      { subject: "פתחים בשולחן", finding: "מיקום הפתחים בשולחן אינו תואם" }
    );
    const second = await createIssue(
      inspection.id,
      PROJECT,
      { roomId: ROOM },
      { subject: "HDMI", finding: "אין חיבור HDMI קווי למסך" }
    );

    expect(first.friendlyNumber).toBe(1);
    expect(second.friendlyNumber).toBe(2);
    expect(first.responsibleContractorId).toBeNull(); // spec §53 — never forced/guessed at capture time
    expect(first.status).toBe("חדש");

    const issues = await listIssues(inspection.id);
    expect(issues).toHaveLength(2);
  });
});

describe("Task (spec §10 ✅ משימה, §27 close-not-duplicate)", () => {
  it("creates an open task and lists it under open tasks", async () => {
    const inspection = await startInspection(PROJECT, "דני");
    const task = await createTask({
      projectId: PROJECT,
      inspectionId: inspection.id,
      description: "השלמת חיבור HDMI בעמדת מנהל",
    });

    expect(task.status).toBe("פתוח");
    expect(task.createdInspectionId).toBe(inspection.id);

    const open = await listOpenTasks(PROJECT);
    expect(open.map((t) => t.id)).toContain(task.id);
  });

  it("carries floorId/roomId (the New Task wizard's step 1) through", async () => {
    const inspection = await startInspection(PROJECT, "דני");
    const task = await createTask({
      projectId: PROJECT,
      inspectionId: inspection.id,
      description: "בדיקת מיקום",
      floorId: "11111111-1111-1111-1111-111111111111",
      roomId: ROOM,
    });

    expect(task.floorId).toBe("11111111-1111-1111-1111-111111111111");
    expect(task.roomId).toBe(ROOM);
  });

  it("listTasksForInspection returns most-recently-created first", async () => {
    const inspection = await startInspection(PROJECT, "דני");
    const first = await createTask({ projectId: PROJECT, inspectionId: inspection.id, description: "משימה 1" });
    const second = await createTask({ projectId: PROJECT, inspectionId: inspection.id, description: "משימה 2" });
    const third = await createTask({ projectId: PROJECT, inspectionId: inspection.id, description: "משימה 3" });

    const listed = await listTasksForInspection(inspection.id);

    expect(listed.map((t) => t.id)).toEqual([third.id, second.id, first.id]);
  });

  it("closeTask closes a task from a later inspection and records which one closed it", async () => {
    const firstTour = await startInspection(PROJECT, "דני");
    const task = await createTask({
      projectId: PROJECT,
      inspectionId: firstTour.id,
      description: "השלמת חיבור HDMI בעמדת מנהל",
    });

    const laterTour = await startInspection(PROJECT, "דני");
    const closed = await closeTask(task.id, laterTour.id);

    expect(closed.status).toBe("הושלם");
    expect(closed.closedInspectionId).toBe(laterTour.id);
    expect(closed.createdInspectionId).toBe(firstTour.id); // history preserved, not overwritten

    const open = await listOpenTasks(PROJECT);
    expect(open.map((t) => t.id)).not.toContain(task.id);
  });
});

describe("Photo (spec §13 — Blob stored locally, never inlined)", () => {
  it("stores the blob separately from the Photo row and both are retrievable", async () => {
    const inspection = await startInspection(PROJECT, "דני");
    const blob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });

    const photo = await capturePhoto(inspection.id, blob, { roomId: ROOM });

    expect(photo.roomId).toBe(ROOM);
    expect(photo.cloudFileId).toBeNull();
    expect(photo.localFileId).toBeTruthy();

    const storedBlob = await getPhotoBlob(photo.localFileId);
    expect(storedBlob).toBeInstanceOf(Blob);
    expect(storedBlob?.size).toBe(blob.size);

    const photos = await listPhotos(inspection.id);
    expect(photos).toHaveLength(1);

    const queued = await getLocalDb().syncQueue.where("entityType").equals("Photo").toArray();
    expect(queued).toHaveLength(1);
    // The queued payload must never carry the blob itself — see lib/db/photos.ts's comment.
    expect(queued[0]?.payload).not.toHaveProperty("blob");
  });
});
