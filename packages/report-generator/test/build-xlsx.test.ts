import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildInspectionReportXlsx, packXlsxToBuffer } from "../src/index.js";
import type { InspectionReportData } from "../src/types.js";

function sampleData(overrides: Partial<InspectionReportData> = {}): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: null,
    projectName: "Biocatch",
    projectAddress: "רחוב הברזל 3, תל אביב",
    inspectionNumber: 12,
    inspectionDate: "2026-09-08",
    participants: ["דני", "יוני"],
    generalText: "מטרת הסיור.",
    tasks: [
      {
        id: "task-1",
        friendlyNumber: 99, // deliberately high/mismatched, same drag-reorder-numbering check as build-docx.test.ts
        floorName: "קומה 30",
        roomName: "חדר ישיבות גדול",
        description: "אין חיבור HDMI קווי למסך. סינמה נדרשים להשלים מול Crestron.",
        responsibleParty: "סינמה",
        status: "פתוח",
        photos: [{ bytes: new Uint8Array([0xff, 0xd8]), mimeType: "image/jpeg" }],
      },
      {
        id: "task-2",
        friendlyNumber: 1,
        floorName: "קומה 30",
        roomName: null,
        description: "יש להתקין USB-C.",
        responsibleParty: null,
        status: "בטיפול",
        photos: [],
      },
    ],
    summaryText: "סיכום.",
    inspectorName: "דני כהן",
    inspectorStamp: null,
    ...overrides,
  };
}

/** Reads a real generated workbook back with the SAME library (SheetJS has no independent alternate
 * reader worth depending on for this -- unlike build-docx.test.ts's use of jszip against `docx`'s own
 * OOXML, or build-pdf.test.ts's use of unpdf against pdf-lib's own PDF): this still proves the bytes are
 * a real, valid, parseable .xlsx (SheetJS's reader and writer are much more independent internally than
 * "the same call that built it" -- a genuinely corrupt write would fail to parse here), and that real
 * cell VALUES survive a round trip, not just that some bytes exist. */
function readBackFirstSheetRows(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0]!;
  const sheet = workbook.Sheets[sheetName]!;
  return XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
}

describe("buildInspectionReportXlsx — real .xlsx via SheetJS Community Edition, no Excel/LibreOffice install", () => {
  it("produces a real ZIP-based .xlsx file (not a renamed CSV)", () => {
    const workbook = buildInspectionReportXlsx(sampleData());
    const buffer = packXlsxToBuffer(workbook);

    // Real OOXML spreadsheet container -- same "PK" ZIP local-file-header check build-docx.test.ts uses
    // for its own OOXML output.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("round-trips real Hebrew task data through a real read-back, not just checking file size", () => {
    const workbook = buildInspectionReportXlsx(sampleData());
    const buffer = packXlsxToBuffer(workbook);
    const rows = readBackFirstSheetRows(buffer);

    expect(rows[0]).toEqual(["מס'", "קומה", "חדר/אזור", "ממצא / דרישה", "באחריות", "סטטוס", "תמונות"]);

    // Row 1 (index 1): numbered by array POSITION (1), not the stored friendlyNumber (99) -- same
    // drag-reorder-safe convention build-docx.ts's own table uses, and the same real bug it guards
    // against (see that file's own comment on this).
    expect(rows[1]).toEqual([1, "קומה 30", "חדר ישיבות גדול", "אין חיבור HDMI קווי למסך. סינמה נדרשים להשלים מול Crestron.", "סינמה", "פתוח", 1]);

    // Row 2: null floor/responsible fall back to placeholders, never a blank cell (REPORTING.md's "never
    // a blank cell that looks like data loss" QA rule) -- and the photo count column reads "—" for zero
    // photos rather than an embedded image (SheetJS Community Edition can't write those -- see this
    // file's own top comment).
    expect(rows[2]).toEqual([2, "קומה 30", "—", "יש להתקין USB-C.", "לא צוין", "בטיפול", "—"]);
  });

  it("sets the workbook to RTL view (Excel opens with column A on the right, matching Hebrew reading order)", () => {
    const workbook = buildInspectionReportXlsx(sampleData());
    expect(workbook.Workbook?.Views?.[0]?.RTL).toBe(true);

    // Also verify this survives a real write+read round trip, not just the in-memory object before saving.
    const buffer = packXlsxToBuffer(workbook);
    const reloaded = XLSX.read(buffer, { type: "buffer" });
    expect(reloaded.Workbook?.Views?.[0]?.RTL).toBe(true);
  });

  it("handles zero tasks without throwing, producing just the header row", () => {
    const workbook = buildInspectionReportXlsx(sampleData({ tasks: [] }));
    const buffer = packXlsxToBuffer(workbook);
    const rows = readBackFirstSheetRows(buffer);
    expect(rows.length).toBe(1);
  });
});
