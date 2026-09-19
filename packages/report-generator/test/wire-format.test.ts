import { describe, expect, it } from "vitest";
import { serializeReportDataForWire, deserializeReportDataFromWire } from "../src/wire-format.js";
import type { InspectionReportData } from "../src/types.js";

function sampleData(): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mimeType: "image/png" },
    tourName: 'טופס פיקוח עליון "מולטימדיה" Biocatch 08/09/2026',
    reportSubtitle: "דו״ח פיקוח עליון – מערכות מולטימדיה",
    projectName: "Biocatch",
    projectAddress: null,
    inspectionNumber: 12,
    inspectionDate: "2026-09-08",
    participants: ["דני"],
    generalText: "",
    tasks: [
      {
        id: "task-1",
        friendlyNumber: 1,
        floorName: null,
        roomName: null,
        description: "בדיקה",
        responsibleParty: null,
        status: "פתוח",
        photos: [{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]), mimeType: "image/jpeg" }],
      },
    ],
    summaryText: "",
    inspectorName: "דני",
    inspectorStamp: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]), mimeType: "image/png" },
  };
}

describe("serializeReportDataForWire / deserializeReportDataFromWire", () => {
  it("reproduces the real bug: plain JSON.stringify on a Uint8Array silently zeroes it out", () => {
    const data = sampleData();
    const roundTripped = JSON.parse(JSON.stringify(data)) as InspectionReportData;
    // This is the exact production bug (2026-09-19): the logo/task photos survive as an object with
    // no `length`, so reconstructing a Uint8Array from it silently yields zero bytes.
    expect(new Uint8Array(roundTripped.logo as unknown as ArrayLike<number>)).toHaveLength(0);
  });

  it("round-trips the logo, inspector stamp, and every task photo byte-for-byte through JSON", () => {
    const data = sampleData();
    const wire = JSON.parse(JSON.stringify(serializeReportDataForWire(data)));
    const restored = deserializeReportDataFromWire(wire);

    expect(Array.from(restored.logo!.bytes)).toEqual(Array.from(data.logo!.bytes));
    expect(restored.logo!.mimeType).toBe("image/png");
    expect(Array.from(restored.inspectorStamp!.bytes)).toEqual(Array.from(data.inspectorStamp!.bytes));
    expect(Array.from(restored.tasks[0]!.photos[0]!.bytes)).toEqual(Array.from(data.tasks[0]!.photos[0]!.bytes));
    // Non-photo fields pass through untouched.
    expect(restored.projectName).toBe(data.projectName);
    expect(restored.tasks[0]!.description).toBe(data.tasks[0]!.description);
  });

  it("keeps a null logo/stamp null, and an empty photo list empty", () => {
    const data = sampleData();
    data.logo = null;
    data.inspectorStamp = null;
    data.tasks[0]!.photos = [];

    const wire = JSON.parse(JSON.stringify(serializeReportDataForWire(data)));
    const restored = deserializeReportDataFromWire(wire);

    expect(restored.logo).toBeNull();
    expect(restored.inspectorStamp).toBeNull();
    expect(restored.tasks[0]!.photos).toEqual([]);
  });

  it("round-trips a large photo (bigger than the base64 chunk size) byte-for-byte", () => {
    const data = sampleData();
    const big = new Uint8Array(20_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    data.tasks[0]!.photos = [{ bytes: big, mimeType: "image/jpeg" }];

    const wire = JSON.parse(JSON.stringify(serializeReportDataForWire(data)));
    const restored = deserializeReportDataFromWire(wire);

    expect(Array.from(restored.tasks[0]!.photos[0]!.bytes)).toEqual(Array.from(big));
  });
});
