import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../../lib/db/projects";
import { createFloor } from "../../lib/db/floors";
import { createRoom } from "../../lib/db/rooms";
import { startInspection, addParticipant } from "../../lib/db/inspections";
import { createTask } from "../../lib/db/tasks";
import { capturePhoto } from "../../lib/db/photos";
import { createInspector, setInspectorStamp } from "../../lib/db/inspectors";
import { getLocalDb } from "../../lib/db/local-db";
import { assembleReportData } from "../../lib/report/assemble-report-data";
import { resetLocalDb } from "../db/helpers";

beforeEach(resetLocalDb);

describe("assembleReportData — real IndexedDB read-out into InspectionReportData", () => {
  it("maps project/inspection meta fields straight through", async () => {
    const project = await createProject("Biocatch");
    const inspection = await startInspection(project.id, "דני", ["דני", "יוני"]);

    const data = await assembleReportData(inspection.id);

    expect(data.officeName).toBe("ל.שחר");
    expect(data.projectName).toBe("Biocatch");
    expect(data.inspectionNumber).toBe(inspection.inspectionNumber);
    expect(data.inspectionDate).toBe(inspection.date);
    expect(data.participants).toEqual(["דני", "יוני"]);
    expect(data.tasks).toEqual([]);
    // The logo is embedded (logo-data.ts), never fetched over the network -- always present, real PNG
    // bytes, regardless of environment (this test's own plain-Node/vitest run included).
    expect(data.logo).not.toBeNull();
    expect(data.logo?.mimeType).toBe("image/png");
    expect(data.logo?.bytes.subarray(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // No inspector was picked from the bank -- falls back to the plain typed name, no stamp.
    expect(data.inspectorName).toBe("דני");
    expect(data.inspectorStamp).toBeNull();
  });

  it("resolves a bank-picked inspector's name and real stamp bytes (session's user request)", async () => {
    const project = await createProject("Biocatch");
    const inspector = await createInspector("אבי לוי");
    const stampBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    await setInspectorStamp(inspector.id, new Blob([stampBytes], { type: "image/png" }));
    const inspection = await startInspection(project.id, "אבי לוי", [], inspector.id);

    const data = await assembleReportData(inspection.id);

    expect(data.inspectorName).toBe("אבי לוי");
    expect(data.inspectorStamp).not.toBeNull();
    expect(data.inspectorStamp?.mimeType).toBe("image/png");
    expect(Array.from(data.inspectorStamp!.bytes)).toEqual(Array.from(stampBytes));
  });

  it("resolves a bank-picked inspector's name with a null stamp when none has been uploaded yet", async () => {
    const project = await createProject("Biocatch");
    const inspector = await createInspector("אבי לוי");
    const inspection = await startInspection(project.id, "אבי לוי", [], inspector.id);

    const data = await assembleReportData(inspection.id);

    expect(data.inspectorName).toBe("אבי לוי");
    expect(data.inspectorStamp).toBeNull();
  });

  it("falls back to the plain inspector name if the bank record was later deleted (doesn't throw)", async () => {
    const project = await createProject("Biocatch");
    const inspector = await createInspector("אבי לוי");
    const inspection = await startInspection(project.id, "אבי לוי", [], inspector.id);
    await getLocalDb().inspectors.delete(inspector.id);

    const data = await assembleReportData(inspection.id);

    expect(data.inspectorName).toBe("אבי לוי"); // falls back to Inspection.inspector itself
    expect(data.inspectorStamp).toBeNull();
  });

  it("throws a clear error rather than silently producing a blank report for an unknown inspection", async () => {
    await expect(assembleReportData("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found locally/);
  });

  it("groups tasks by floor order, then by friendly number within a floor; tasks with no floor sort last", async () => {
    const project = await createProject("Biocatch");
    const floorGround = await createFloor(project.id, "קומת קרקע");
    const floor30 = await createFloor(project.id, "קומה 30");
    const room30 = await createRoom(floor30.id, "חדר ישיבות גדול");
    const inspection = await startInspection(project.id, "דני");

    // Created deliberately out of "natural" order to prove the sort, not the insertion order, wins.
    const taskNoFloor = await createTask({ projectId: project.id, inspectionId: inspection.id, description: "אין מיקום" });
    const taskFloor30 = await createTask({
      projectId: project.id,
      inspectionId: inspection.id,
      description: "אין HDMI",
      floorId: floor30.id,
      roomId: room30.id,
      responsibleParties: ["סינמה"],
    });
    const taskGround = await createTask({
      projectId: project.id,
      inspectionId: inspection.id,
      description: "בעיה במסך קבלה",
      floorId: floorGround.id,
    });

    const data = await assembleReportData(inspection.id);

    expect(data.tasks.map((t) => t.id)).toEqual([taskGround.id, taskFloor30.id, taskNoFloor.id]);
    expect(data.tasks[0]?.floorName).toBe("קומת קרקע");
    expect(data.tasks[0]?.roomName).toBeNull();
    expect(data.tasks[1]?.floorName).toBe("קומה 30");
    expect(data.tasks[1]?.roomName).toBe("חדר ישיבות גדול");
    expect(data.tasks[1]?.responsibleParty).toBe("סינמה");
    expect(data.tasks[2]?.floorName).toBeNull();
  });

  it("resolves a task's photo blob to real, byte-identical bytes", async () => {
    const project = await createProject("Biocatch");
    const inspection = await startInspection(project.id, "דני");
    const task = await createTask({ projectId: project.id, inspectionId: inspection.id, description: "בדיקה" });

    const originalBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await capturePhoto(inspection.id, new Blob([originalBytes], { type: "image/jpeg" }), { taskId: task.id });

    const data = await assembleReportData(inspection.id);

    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]?.photos).toHaveLength(1);
    expect(data.tasks[0]?.photos[0]?.mimeType).toBe("image/jpeg");
    expect(Array.from(data.tasks[0]!.photos[0]!.bytes)).toEqual(Array.from(originalBytes));
  });

  it("reflects participants added mid-tour (addParticipant), not just the ones present at tour start", async () => {
    const project = await createProject("Biocatch");
    const inspection = await startInspection(project.id, "דני", ["דני"]);
    await addParticipant(inspection.id, "יוני");

    const data = await assembleReportData(inspection.id);

    expect(data.participants).toEqual(["דני", "יוני"]);
  });
});
