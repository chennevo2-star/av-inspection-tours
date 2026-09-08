import { beforeEach, describe, expect, it } from "vitest";
import { getLocalDb } from "../../lib/db/local-db";
import {
  endInspection,
  getActiveInspectionForProject,
  getAnyActiveInspection,
  startInspection,
} from "../../lib/db/inspections";
import { getCurrentPosition, listContextEvents, logContextEvent } from "../../lib/db/context-events";
import { resetLocalDb } from "./helpers";

const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";
const FLOOR_1 = "33333333-3333-3333-3333-333333333333";
const FLOOR_2 = "44444444-4444-4444-4444-444444444444";
const ROOM_1 = "55555555-5555-5555-5555-555555555555";
const ROOM_2 = "66666666-6666-6666-6666-666666666666";

beforeEach(resetLocalDb);

describe("startInspection / endInspection", () => {
  it("starts an inspection LOCAL_ONLY, open (endTime null), and enqueues it for sync", async () => {
    const inspection = await startInspection(PROJECT_A, "דני");

    expect(inspection.endTime).toBeNull();
    expect(inspection.status).toBe("בתהליך");
    expect(inspection.syncStatus).toBe("LOCAL_ONLY");
    expect(inspection.inspector).toBe("דני");

    const queued = await getLocalDb().syncQueue.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entityType: "Inspection", entityId: inspection.id, op: "create" });
  });

  it("gives each project its own independent, incrementing inspection number", async () => {
    const a1 = await startInspection(PROJECT_A, "דני");
    const b1 = await startInspection(PROJECT_B, "דני");
    const a2 = await startInspection(PROJECT_A, "דני");

    expect(a1.inspectionNumber).toBe(1);
    expect(b1.inspectionNumber).toBe(1); // a different project — starts its own count at 1
    expect(a2.inspectionNumber).toBe(2);
  });

  it("endInspection sets endTime/status and the inspection stops being 'active'", async () => {
    const inspection = await startInspection(PROJECT_A, "דני");
    expect(await getActiveInspectionForProject(PROJECT_A)).toMatchObject({ id: inspection.id });

    const ended = await endInspection(inspection.id);

    expect(ended.endTime).not.toBeNull();
    expect(ended.status).toBe("הסתיים_מקומית");
    expect(await getActiveInspectionForProject(PROJECT_A)).toBeUndefined();
  });

  it("getAnyActiveInspection finds an open tour regardless of which project it belongs to", async () => {
    expect(await getAnyActiveInspection()).toBeUndefined();

    const inspection = await startInspection(PROJECT_B, "רותם");
    expect(await getAnyActiveInspection()).toMatchObject({ id: inspection.id });

    await endInspection(inspection.id);
    expect(await getAnyActiveInspection()).toBeUndefined();
  });
});

describe("context events / current position (spec §12, §44 recovery)", () => {
  it("has no position before any event is logged", async () => {
    const inspection = await startInspection(PROJECT_A, "דני");
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: null, roomId: null });
  });

  it("tracks floor -> room -> a different floor (which clears the room) in order", async () => {
    const inspection = await startInspection(PROJECT_A, "דני");

    await logContextEvent(inspection.id, "enter_floor", { floorId: FLOOR_1 });
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: FLOOR_1, roomId: null });

    await logContextEvent(inspection.id, "enter_room", { floorId: FLOOR_1, roomId: ROOM_1 });
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: FLOOR_1, roomId: ROOM_1 });

    // Moving to a second room on the same floor.
    await logContextEvent(inspection.id, "enter_room", { floorId: FLOOR_1, roomId: ROOM_2 });
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: FLOOR_1, roomId: ROOM_2 });

    // Changing floor clears the current room until a new one is entered.
    await logContextEvent(inspection.id, "enter_floor", { floorId: FLOOR_2 });
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: FLOOR_2, roomId: null });
  });

  it("this IS how recovery (spec §44) reconstructs position — replaying the same events gives the same answer", async () => {
    const inspection = await startInspection(PROJECT_A, "דני");
    await logContextEvent(inspection.id, "enter_floor", { floorId: FLOOR_1 });
    await logContextEvent(inspection.id, "enter_room", { floorId: FLOOR_1, roomId: ROOM_1 });

    // Nothing about "current position" is cached anywhere else — re-deriving from the persisted event
    // log (as if the app had just restarted) yields the same result.
    const events = await listContextEvents(inspection.id);
    expect(events).toHaveLength(2);
    expect(await getCurrentPosition(inspection.id)).toEqual({ floorId: FLOOR_1, roomId: ROOM_1 });
  });
});
