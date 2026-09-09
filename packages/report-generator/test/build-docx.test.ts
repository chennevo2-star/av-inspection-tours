import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildInspectionReportDocument, packToBuffer } from "../src/index.js";
import type { InspectionReportData } from "../src/types.js";

// Minimal but real JPEG magic bytes (SOI + APP0) — docx embeds raw bytes into the zip without decoding
// them, so this is enough to prove real image embedding without needing a fully valid photo.
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function sampleData(overrides: Partial<InspectionReportData> = {}): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: null,
    projectName: "Biocatch",
    projectAddress: "רחוב הברזל 3, תל אביב",
    inspectionNumber: 12,
    inspectionDate: "2026-09-08",
    participants: ["דני", "יוני"],
    generalText: "מטרת הסיור הייתה לבדוק את מערכות ה-AV בקומה 30 לקראת מסירה.",
    tasks: [
      {
        id: "task-1",
        friendlyNumber: 1,
        floorName: "קומה 30",
        roomName: "חדר ישיבות גדול",
        description: "אין חיבור HDMI קווי למסך למרות שהתשתית קיימת. סינמה נדרשים להשלים מול Crestron ו-Poly.",
        responsibleParty: "סינמה",
        status: "פתוח",
        photos: [{ bytes: FAKE_JPEG, mimeType: "image/jpeg" }],
      },
      {
        id: "task-2",
        friendlyNumber: 2,
        floorName: "קומה 30",
        roomName: "חדר מנהל",
        description: "יש להתקין USB-C להעברת תמונה מהמחשב הנייד.",
        responsibleParty: "יוני",
        status: "בטיפול",
        photos: [],
      },
    ],
    summaryText: "הסיור התנהל כשגרה. נותרו 2 משימות פתוחות מול סינמה.",
    ...overrides,
  };
}

describe("buildInspectionReportDocument — real OOXML output, not HTML-as-.docx (REPORTING.md)", () => {
  it("produces a real ZIP-based .docx file", async () => {
    const doc = buildInspectionReportDocument(sampleData());
    const buffer = await packToBuffer(doc);

    // The ZIP local-file-header magic bytes — a real OOXML container, not a renamed HTML file.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("contains a real word/document.xml with the Hebrew content, RTL markers, and mixed English terms intact", async () => {
    const doc = buildInspectionReportDocument(sampleData());
    const buffer = await packToBuffer(doc);

    const zip = await JSZip.loadAsync(buffer);
    const documentXmlFile = zip.file("word/document.xml");
    expect(documentXmlFile).not.toBeNull();
    const xml = await documentXmlFile!.async("string");

    // RTL authored from the start (spec §33), not a post-hoc fix — every paragraph carries a bidi marker.
    expect(xml).toContain("w:bidi");

    // Hebrew content survives real OOXML encoding.
    expect(xml).toContain("Biocatch");
    expect(xml).toContain("סינמה");
    expect(xml).toContain("חדר ישיבות גדול");
    expect(xml).toContain("מטרת הסיור");

    // Mixed Hebrew + English/model-number content (spec §33's explicit test list) isn't mangled.
    expect(xml).toContain("HDMI");
    expect(xml).toContain("Crestron");
    expect(xml).toContain("Poly");
    expect(xml).toContain("USB-C");

    // The closing role-holder note (this session's explicit requirement) is present.
    expect(xml).toContain("על כל בעל תפקיד למלא את המשימות המשויכות לו");
  });

  it("uses the LOGICAL start/end alignment values, not physical right/left (real bug found via a real LibreOffice PDF render)", async () => {
    // A `w:bidi` paragraph's physical "right"/"left" w:jc value is genuinely ambiguous across renderers
    // -- confirmed by actually converting a real generated report to PDF via LibreOffice and looking at
    // it: `AlignmentType.RIGHT` rendered every meta line and heading flush against the LEFT margin
    // instead of the right one, while the logical `AlignmentType.START`/`END` values (added to OOXML
    // specifically to resolve this ambiguity: "start"/"end" of reading order rather than a screen side)
    // rendered correctly. This locks that fix in place -- reintroducing a literal "right"/"left" value
    // anywhere in this file would silently break RTL alignment again in exactly the way that shipped once.
    const doc = buildInspectionReportDocument(sampleData());
    const buffer = await packToBuffer(doc);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    // The office-name line lives in the header, a separate OOXML part (word/header1.xml) -- headers/
    // footers are never inlined into word/document.xml itself.
    const headerXml = await zip.file("word/header1.xml")!.async("string");

    expect(xml).not.toContain('w:jc w:val="right"');
    expect(xml).not.toContain('w:jc w:val="left"');
    expect(xml).toContain('w:jc w:val="start"'); // meta lines, headings, task-table cells
    expect(headerXml).not.toContain('w:jc w:val="left"');
    expect(headerXml).toContain('w:jc w:val="end"'); // the office-name header line
  });

  it("embeds the task photo as a real image part in the zip", async () => {
    const doc = buildInspectionReportDocument(sampleData());
    const buffer = await packToBuffer(doc);

    const zip = await JSZip.loadAsync(buffer);
    // Excludes the "word/media/" directory entry itself (JSZip lists it alongside real files, but
    // `.file()` correctly returns null for it — it's not a file) — real files only.
    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name]!.dir);
    expect(mediaFiles.length).toBeGreaterThan(0);

    const firstImage = await zip.file(mediaFiles[0]!)!.async("uint8array");
    // Byte-identical to what was handed in — not re-encoded/corrupted along the way.
    expect(Array.from(firstImage.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("numbers task rows by their position in the array, not by the stored friendlyNumber (real bug: drag-reorder in the preview screen left the printed number stuck to the original task)", async () => {
    const data = sampleData({
      tasks: [
        { id: "t-a", friendlyNumber: 99, floorName: "קומה 1", roomName: null, description: "משימה ראשונה במערך, מספר מקורי גבוה", responsibleParty: null, status: "פתוח", photos: [] },
        { id: "t-b", friendlyNumber: 1, floorName: "קומה 1", roomName: null, description: "משימה שנייה במערך, מספר מקורי נמוך", responsibleParty: null, status: "פתוח", photos: [] },
      ],
    });
    const doc = buildInspectionReportDocument(data);
    const buffer = await packToBuffer(doc);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");

    const firstDescriptionIndex = xml.indexOf("משימה ראשונה במערך");
    const secondDescriptionIndex = xml.indexOf("משימה שנייה במערך");
    expect(firstDescriptionIndex).toBeGreaterThan(-1);
    expect(secondDescriptionIndex).toBeGreaterThan(-1);
    expect(firstDescriptionIndex).toBeLessThan(secondDescriptionIndex); // sanity: rows really are in array order

    // "1" (array position) appears before the first row's own description; "99" (its real friendlyNumber)
    // does not appear anywhere in the table at all.
    const numberedText = (n: number) => `<w:t xml:space="preserve">${n}</w:t>`;
    const numberOneIndex = xml.indexOf(numberedText(1));
    expect(numberOneIndex).toBeGreaterThan(-1);
    expect(numberOneIndex).toBeLessThan(firstDescriptionIndex);
    expect(xml).not.toContain(numberedText(99));

    const numberTwoIndex = xml.indexOf(numberedText(2));
    expect(numberTwoIndex).toBeGreaterThan(firstDescriptionIndex);
    expect(numberTwoIndex).toBeLessThan(secondDescriptionIndex);
  });

  it("handles zero tasks and empty text fields without throwing (spec §92 — never fake success, but also never crash on a thin draft)", async () => {
    const doc = buildInspectionReportDocument(sampleData({ tasks: [], generalText: "", summaryText: "", participants: [] }));
    const buffer = await packToBuffer(doc);

    expect(buffer.length).toBeGreaterThan(500);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("לא נרשמו משימות בסיור זה");
  });
});
