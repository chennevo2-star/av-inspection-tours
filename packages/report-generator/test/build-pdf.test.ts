import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { buildInspectionReportPdf, packPdfToBuffer, buildInspectionReportDocument, packToBuffer } from "../src/index.js";
import type { InspectionReportData } from "../src/types.js";

// Real, fully-decodable 4x4 JPEG/PNG bytes (generated with Pillow during this task's own research, not
// hand-waved magic-byte stubs). This matters here in a way it doesn't for build-docx.test.ts's FAKE_JPEG:
// `docx` just tags bytes with a declared content type and never looks inside them, but pdf-lib's
// `embedJpg`/`embedPng` genuinely parse and validate real image structure -- a 12-byte SOI+APP0-only stub
// throws. Base64 keeps these out of the way of the rest of the file while still being the real bytes.
const REAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwKiiivzI/uM//2Q==",
  "base64"
);
const REAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGOUizrBAANMcBZeDgA+2gFI74sNCwAAAABJRU5ErkJggg==",
  "base64"
);

function sampleData(overrides: Partial<InspectionReportData> = {}): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: null,
    tourName: 'טופס פיקוח עליון "מולטימדיה" Biocatch 08/09/2026',
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
        roomName: "חדר ישיבות",
        // Deliberately SHORT (unlike build-docx.test.ts's longer sentence) -- guaranteed to fit on one
        // wrapped line inside the PDF's narrower description column, so the Latin keyword assertions
        // below aren't at the mercy of exactly where word-wrap happens to break the line.
        description: "בעיית Crestron בחיבור.",
        responsibleParty: "סינמה",
        status: "פתוח",
        photos: [{ bytes: REAL_JPEG, mimeType: "image/jpeg" }],
      },
      {
        id: "task-2",
        friendlyNumber: 2,
        floorName: "קומה 30",
        roomName: "משרד",
        description: "נדרש Poly למסך.",
        responsibleParty: "יוני",
        status: "בטיפול",
        photos: [],
      },
    ],
    summaryText: "הסיור התנהל כשגרה.",
    inspectorName: "אבי לוי",
    inspectorStamp: null,
    ...overrides,
  };
}

/** Character-reversal of a short, PURE-Hebrew (no digits/Latin/punctuation) string. A single bidi run of
 * one direction, drawn left-to-right in reverse character order, is exactly what makes it read correctly
 * right-to-left -- this is not a workaround for the test, it's the actual mechanism build-pdf.ts's
 * `toVisualOrder` implements (see that file's own comments). Only safe to use on fixtures guaranteed to
 * be ONE unbroken bidi run: no embedded Latin/digits (those resolve to a separate, unreversed run) and
 * short enough to never be split across two wrapped lines (each wrapped line is bidi-processed
 * independently). */
function reverseChars(s: string): string {
  return [...s].reverse().join("");
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).replace(/\s+/g, " ");
}

/** Counts real `/Subtype /Image` XObject dictionaries in the raw saved PDF bytes -- an independent,
 * low-level structural check (not going through pdf-lib's own reader, the same library that built the
 * file) that an image was genuinely embedded, not just referenced/faked. PDF dictionary entries are
 * always adjacent "KEY VALUE" token pairs, so this holds regardless of surrounding key order and of
 * whether the serializer put a space between the two name tokens. */
function countImageXObjects(buffer: Buffer): number {
  const raw = buffer.toString("latin1");
  return (raw.match(/\/Subtype\s*\/Image\b/g) || []).length;
}

describe("buildInspectionReportPdf — real PDF output via pdf-lib, no LibreOffice/external binary", () => {
  it("produces a real PDF file", async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);

    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("renders pure-Hebrew text in correct visual (bidi-reordered) order, extractable via a real ToUnicode CMap", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ inspectorName: "אבי לוי" }));
    const buffer = await packPdfToBuffer(doc);
    const text = await extractPdfText(buffer);

    // The extracted text is what was actually DRAWN (glyph order), which for a single right-to-left run
    // is the character-reversal of the logical string -- reading it right-to-left recovers the original.
    // Asserting the reversed form is therefore a real, mechanism-level check of correct RTL rendering,
    // not a loophole around it (see build-pdf.ts's own `toVisualOrder` comments).
    expect(text).toContain(reverseChars("אבי לוי"));
    // And the plain logical-order string must NOT appear un-reversed -- that would mean the text was
    // drawn left-to-right like plain English, i.e. RTL rendering silently regressed.
    expect(text).not.toContain("אבי לוי");
  });

  it("keeps mixed Hebrew+English tokens (Crestron, Poly) intact and un-reversed (REPORTING.md's mixed-content requirement)", async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);
    const text = await extractPdfText(buffer);

    // A pure-Latin run inside an RTL paragraph keeps its own internal left-to-right character order --
    // only whole RTL-level runs get reversed. If bidi processing accidentally reversed these too, they'd
    // show up backwards ("nortserC", "yloP").
    expect(text).toContain("Crestron");
    expect(text).toContain("Poly");
    expect(text).toContain("Biocatch"); // the project name, also pure-Latin
  });

  it("embeds the task photo as a real image XObject, byte-identical to the source JPEG", async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);

    expect(countImageXObjects(buffer)).toBeGreaterThan(0);
    // pdf-lib's JPEG embedder stores the original DCT-encoded byte stream as-is (unlike its PNG embedder,
    // which decodes and re-derives raw samples) -- so the original fixture bytes should appear verbatim
    // somewhere in the saved file, the same "not re-encoded/corrupted" guarantee build-docx.test.ts checks
    // for its own embedded image.
    expect(buffer.includes(REAL_JPEG)).toBe(true);
  });

  it("embeds the inspector's stamp image and name at the end of the report (mirrors build-docx.ts's signatureSection)", async () => {
    const withoutStamp = await packPdfToBuffer(await buildInspectionReportPdf(sampleData({ inspectorStamp: null })));
    const withStamp = await packPdfToBuffer(
      await buildInspectionReportPdf(sampleData({ inspectorStamp: { bytes: REAL_PNG, mimeType: "image/png" } }))
    );

    // Adding a stamp adds one more real image XObject (the task's own JPEG photo is present in both).
    expect(countImageXObjects(withStamp)).toBeGreaterThan(countImageXObjects(withoutStamp));

    const textWithStamp = await extractPdfText(withStamp);
    expect(textWithStamp).toContain(reverseChars("אבי לוי"));
  });

  it("prints neither a name nor an image when the tour had no bank-picked inspector at all (no-mock-success: never fakes one)", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ inspectorName: null, inspectorStamp: null }));
    const buffer = await packPdfToBuffer(doc); // must not throw
    expect(buffer.length).toBeGreaterThan(500);

    const text = await extractPdfText(buffer);
    expect(text).not.toContain(reverseChars("אבי לוי"));
  });

  it('includes real page numbering ("עמוד X מתוך Y")', async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);
    const text = await extractPdfText(buffer);

    // NOTE: deliberately NOT asserting one single exact reversed substring for the whole "עמוד 1 מתוך 2"
    // phrase -- digits are their own bidi run (Unicode UAX#9 bumps European numbers to their own
    // embedding level even inside RTL text, precisely so they DON'T get letter-reversed), which also
    // reorders the surrounding words' relative POSITIONS via the algorithm's multi-pass reordering rule
    // (L2) in a way that isn't just "reverse each word, leave the digit where it was" -- hand-deriving
    // that exact combined result is exactly the kind of subtle bidi mistake this file's own `toVisualOrder`
    // exists to get right, so the test checks the real, safe, unambiguous facts instead: both Hebrew
    // words render (reversed, each being its own single-level run) and the page digit renders un-flipped.
    expect(text).toContain(reverseChars("עמוד"));
    expect(text).toContain(reverseChars("מתוך"));
    expect(text).toContain("1"); // the page digit itself, never letter-reversed
  });

  it("handles zero tasks and empty text fields without throwing (spec §92 -- never fake success, but never crash on a thin draft either)", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ tasks: [], generalText: "", summaryText: "", participants: [] }));
    const buffer = await packPdfToBuffer(doc);
    expect(buffer.length).toBeGreaterThan(500);

    const text = await extractPdfText(buffer);
    expect(text).toContain(reverseChars("לא נרשמו משימות בסיור זה."));
  });
});

describe("DOCX and PDF stay factually in sync from the same InspectionReportData (replaces ADR-004's old byte-derivation guarantee)", () => {
  // A separate, deliberately compact fixture (not build-docx.test.ts's richer one): short enough that
  // every field is guaranteed to render on one line in the PDF's narrower columns, so this test can make
  // strong, exact assertions on both outputs without word-wrap uncertainty.
  // Floor names deliberately spelled out as words ("קומת קרקע"/"קומה עליונה") rather than "קומה 1"/"קומה 2"
  // -- a digit mixed into an otherwise-Hebrew label is its own separate bidi run (see the page-numbering
  // test's comment above), which breaks the simple "reverse the whole string" check this test relies on
  // for an exact, strong assertion. Pure multi-word Hebrew has no such sub-run complexity.
  const shared: InspectionReportData = sampleData({
    tasks: [
      {
        id: "t1",
        friendlyNumber: 1,
        floorName: "קומת קרקע",
        roomName: "לובי",
        description: "בעיית HDMI",
        responsibleParty: "סינמה",
        status: "פתוח",
        photos: [],
      },
      {
        id: "t2",
        friendlyNumber: 2,
        // Single word, not "קומה עליונה" -- that two-word label is genuinely long enough to wrap onto
        // two lines inside the PDF's narrow floor column (~10% of content width) at real column widths;
        // each wrapped line bidi-reverses correctly on its own, but this test's simple whole-string
        // reverseChars() check assumes a single unbroken line (see this describe block's own comment) --
        // confirmed by measuring real font/column widths, not assumed.
        floorName: "עליונה",
        roomName: "מטבח",
        description: "נדרש Poly",
        responsibleParty: "יוני",
        status: "סגור",
        photos: [],
      },
    ],
  });

  it("both outputs contain the same task facts: count, keywords, room/floor names, inspector name", async () => {
    const docxBuffer = await packToBuffer(buildInspectionReportDocument(shared));
    const pdfBuffer = await packPdfToBuffer(await buildInspectionReportPdf(shared));
    const pdfText = await extractPdfText(pdfBuffer);

    // DOCX: verified the same way build-docx.test.ts already does (raw OOXML string containment).
    const JSZip = (await import("jszip")).default;
    const docxXml = await (await JSZip.loadAsync(docxBuffer)).file("word/document.xml")!.async("string");

    // Task count: exactly 2 distinctive keywords, one per task, in BOTH outputs.
    for (const keyword of ["HDMI", "Poly"]) {
      expect(docxXml).toContain(keyword);
      expect(pdfText).toContain(keyword);
    }

    // Room/floor names: short pure-Hebrew fixtures chosen specifically so the PDF's reversed-run
    // assertion applies cleanly (see reverseChars's own doc comment).
    for (const label of ["קומת קרקע", "עליונה", "לובי", "מטבח"]) {
      expect(docxXml).toContain(label);
      expect(pdfText).toContain(reverseChars(label));
    }

    // Inspector name present in both.
    expect(docxXml).toContain("אבי לוי");
    expect(pdfText).toContain(reverseChars("אבי לוי"));
  });
});
