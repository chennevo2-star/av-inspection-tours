import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildInspectionReportPdf, packPdfToBuffer, buildInspectionReportDocument, packToBuffer } from "../src/index.js";
import { computeColumnBoxes, CONTENT_LEFT, CONTENT_RIGHT } from "../src/build-pdf.js";
import type { InspectionReportData } from "../src/types.js";

const execFileAsync = promisify(execFile);
const EXTRACT_SCRIPT = fileURLToPath(new URL("./extract-pdf-text-items.mjs", import.meta.url));

interface TextItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Real x/y-coordinate extraction via pdfjs-dist, NOT `unpdf`'s `extractText` (used elsewhere in this
 * file) -- deliberately a second, independent reader. `extractText`-style presence checks
 * (`.toContain(word)`) can't catch a word-ORDER bug at all, since reordering never changes which
 * characters exist, only where they're drawn -- this is exactly the gap that let the real 2026-09-19
 * RTL-order regression ship undetected by this same test file's earlier assertions. Visual/rendered-image
 * inspection was tried and repeatedly gave wrong answers during that investigation (see build-pdf.ts's own
 * `toVisualOrder` comment) -- exact coordinates are the only method that held up. Runs pdfjs-dist in a
 * real child `node` process (extract-pdf-text-items.mjs), not in-process -- see that script's own comment
 * for why (a Vitest/Worker interaction, not a real bug).
 */
async function extractTextItems(buffer: Buffer): Promise<TextItem[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "av-inspection-pdf-verify-"));
  const pdfPath = path.join(dir, "report.pdf");
  try {
    await writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync(process.execPath, [EXTRACT_SCRIPT, pdfPath]);
    return JSON.parse(stdout) as TextItem[];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether `needle` appears in ANY single extracted text item — a presence check that doesn't care about
 * order. Deliberately does NOT use `extractPdfText`'s `unpdf`-based whole-string concatenation for this:
 * once `toVisualOrder` correctly reorders same-script runs for real RTL rendering, unpdf's own
 * content-stream-order extraction shows those same runs BACK in reversed/visual order too (it has no
 * bidi-aware reassembly of its own) -- so a multi-word LOGICAL-order phrase like "אבי לוי" or "קומת קרקע"
 * legitimately stops being one contiguous substring in unpdf's output, even though the PDF renders
 * correctly. A single word/run, checked per-item here, is unaffected by that. */
function hasText(items: TextItem[], needle: string): boolean {
  return items.some((it) => it.str.includes(needle));
}

/** The x position of the FIRST occurrence of `needle` among extracted text items (throws if absent —
 * a missing word is a distinct failure from a misordered one, and should fail loudly, not as `undefined`
 * comparisons that could accidentally pass). */
function xOf(items: TextItem[], needle: string): number {
  const found = items.find((it) => it.str.includes(needle));
  if (!found) throw new Error(`"${needle}" not found in extracted text items`);
  return found.x;
}

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

  it("renders Hebrew text extractable via a real ToUnicode CMap", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ inspectorName: "אבי לוי" }));
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    expect(hasText(items, "אבי")).toBe(true);
    expect(hasText(items, "לוי")).toBe(true);
  });

  it("lays out multi-word Hebrew text in real RTL visual order, not left-to-right typing order (real production bug, 2026-09-19: a screenshot of an actual exported report showed word order reversed/LTR -- root-caused via these exact x-coordinates, see build-pdf.ts's own toVisualOrder comment)", async () => {
    const doc = await buildInspectionReportPdf(
      sampleData({ tasks: [], generalText: "לשנאל מימין ולמסך משמאל", summaryText: "", participants: [] })
    );
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    // Reading order for Hebrew is right-to-left, i.e. DEscending x as you read forward -- so each later
    // word in the logical string must sit at a LOWER x (further left on the page) than the one before it.
    const xLashanal = xOf(items, "לשנאל");
    const xMimin = xOf(items, "מימין");
    const xMask = xOf(items, "ולמסך");
    const xMismol = xOf(items, "משמאל");
    expect(xLashanal).toBeGreaterThan(xMimin);
    expect(xMimin).toBeGreaterThan(xMask);
    expect(xMask).toBeGreaterThan(xMismol);
  });

  it("keeps a Hebrew+English label:value line in correct RTL order (metadata line, real production shape: \"פרויקט: B2tech\")", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ projectName: "B2tech" }));
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    // "פרויקט" (label) must render to the RIGHT of "B2tech" (its value) -- reading right-to-left, the
    // label comes first. A word-order bug would put B2tech on the right instead. Matches ": B2tech"
    // specifically (not the bare project name, which also appears later in the page footer).
    const xLabel = xOf(items, "פרויקט");
    const xValue = xOf(items, ": B2tech");
    expect(xLabel).toBeGreaterThan(xValue);
  });

  it("puts the cover title's date at the true leftmost position even when the project name is in English (user report, 2026-09-19: date wasn't consistently 'last' depending on the project name's script)", async () => {
    const doc = await buildInspectionReportPdf(
      sampleData({ tourName: "טופס פיקוח עליון מולטימדיה B2tech 19.09.2026" })
    );
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    const xDate = xOf(items, "19.09.2026");
    // Every other word on the title's own line (same y) must sit to the date's right -- the date is the
    // line's true leftmost/last element, not sandwiched between the English project name and the rest.
    const titleWords = ["טופס", "פיקוח", "עליון", "מולטימדיה", "B2tech"];
    for (const word of titleWords) {
      expect(xOf(items, word)).toBeGreaterThan(xDate);
    }
  });

  it("puts the cover title's date at the true leftmost position with an all-Hebrew project name too (same guarantee, opposite script)", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ tourName: "טופס פיקוח עליון מולטימדיה פרויקט א 19.09.2026" }));
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    const xDate = xOf(items, "19.09.2026");
    const titleWords = ["טופס", "פיקוח", "עליון", "מולטימדיה", "פרויקט"];
    for (const word of titleWords) {
      expect(xOf(items, word)).toBeGreaterThan(xDate);
    }
  });

  it("keeps mixed Hebrew+English tokens (Crestron, Poly) intact and un-reversed (REPORTING.md's mixed-content requirement)", async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);
    const text = await extractPdfText(buffer);

    // Latin tokens inside Hebrew text render in their own normal left-to-right order -- if anything
    // upstream mangled character order, they'd show up backwards ("nortserC", "yloP").
    expect(text).toContain("Crestron");
    expect(text).toContain("Poly");
    expect(text).toContain("Biocatch"); // the project name, also pure-Latin
  });

  it("lays out a task table cell's mixed Hebrew+English description in real RTL visual order", async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    // sampleData's first task description is "בעיית Crestron בחיבור." -- reading right-to-left: בעיית
    // (word 1, rightmost) then Crestron then בחיבור (word 3, leftmost).
    const xWord1 = xOf(items, "בעיית");
    const xCrestron = xOf(items, "Crestron");
    const xWord3 = xOf(items, "בחיבור");
    expect(xWord1).toBeGreaterThan(xCrestron);
    expect(xCrestron).toBeGreaterThan(xWord3);
  });

  it("puts each contractor in the responsible column on its own line (user request, 2026-09-19: newline-joined responsibleParty renders as separate lines, not one run of text)", async () => {
    const doc = await buildInspectionReportPdf(
      sampleData({
        tasks: [
          {
            id: "task-multi",
            friendlyNumber: 1,
            floorName: null,
            roomName: null,
            description: "בדיקה",
            // Deliberately two single-word names, not e.g. "קבלן א"/"קבלן ב" -- a name with an embedded
            // space is itself split into separate visual-order runs by toVisualOrder/splitScriptRuns (the
            // exact same mechanism this file's own RTL-order tests rely on), so it would never appear as
            // one contiguous extracted string regardless of this fix; that's a property of multi-word
            // text, not a symptom of the newline bug this test targets.
            responsibleParty: "סינמה\nממטל",
            status: "פתוח",
            photos: [],
          },
        ],
      })
    );
    const buffer = await packPdfToBuffer(doc);
    const items = await extractTextItems(buffer);

    const nameA = items.find((it) => it.str.includes("סינמה"));
    const nameB = items.find((it) => it.str.includes("ממטל"));
    if (!nameA || !nameB) throw new Error("expected both contractor names in the extracted text");
    // Both names sit in the same column (same x) but on different lines (different y) -- if the newline
    // had silently collapsed (the exact bug this guards), both names would merge into one text item/line.
    expect(Math.abs(nameA.x - nameB.x)).toBeLessThan(1);
    expect(nameA.y).not.toBeCloseTo(nameB.y, 1);
  });

  it("lays out the task table RTL: the first-authored column (number) sits at the right edge, the last (status) at the left (user report, 2026-09-19: 'the table needs to be RTL')", () => {
    const boxes = computeColumnBoxes();

    // "number" is authored first in TASK_COLUMN_ORDER -- for a Hebrew reader (who starts at the right),
    // it must be the RIGHTMOST column, i.e. its own right edge is the page's content boundary.
    expect(boxes.number.right).toBeCloseTo(CONTENT_RIGHT, 5);
    // "status" is authored last -- it must be the LEFTMOST column.
    expect(boxes.status.left).toBeCloseTo(CONTENT_LEFT, 5);
    // And every column strictly to the right of the next one in authoring order (no gaps, no overlaps,
    // monotonically decreasing X as you walk the array) -- catches a partial/off-by-one fix, not just a
    // fully-inverted or fully-untouched one.
    const order = ["number", "floor", "room", "description", "photo", "responsible", "status"] as const;
    for (let i = 0; i < order.length - 1; i++) {
      // Non-null: `i` and `i + 1` are both in-bounds by the loop condition above.
      expect(boxes[order[i]!].left).toBeCloseTo(boxes[order[i + 1]!].right, 5);
    }
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

    const itemsWithStamp = await extractTextItems(withStamp);
    expect(hasText(itemsWithStamp, "אבי")).toBe(true);
    expect(hasText(itemsWithStamp, "לוי")).toBe(true);
  });

  it("prints neither a name nor an image when the tour had no bank-picked inspector at all (no-mock-success: never fakes one)", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ inspectorName: null, inspectorStamp: null }));
    const buffer = await packPdfToBuffer(doc); // must not throw
    expect(buffer.length).toBeGreaterThan(500);

    const text = await extractPdfText(buffer);
    expect(text).not.toContain("אבי לוי");
  });

  it('includes real page numbering ("עמוד X מתוך Y")', async () => {
    const doc = await buildInspectionReportPdf(sampleData());
    const buffer = await packPdfToBuffer(doc);
    const text = await extractPdfText(buffer);

    expect(text).toContain("עמוד");
    expect(text).toContain("מתוך");
    expect(text).toContain("1");
  });

  it("handles zero tasks and empty text fields without throwing (spec §92 -- never fake success, but never crash on a thin draft either)", async () => {
    const doc = await buildInspectionReportPdf(sampleData({ tasks: [], generalText: "", summaryText: "", participants: [] }));
    const buffer = await packPdfToBuffer(doc);
    expect(buffer.length).toBeGreaterThan(500);

    const items = await extractTextItems(buffer);
    expect(hasText(items, "נרשמו")).toBe(true);
    expect(hasText(items, "משימות")).toBe(true);
  });
});

describe("DOCX and PDF stay factually in sync from the same InspectionReportData (replaces ADR-004's old byte-derivation guarantee)", () => {
  // A separate, deliberately compact fixture (not build-docx.test.ts's richer one): short enough that
  // every field is guaranteed to render on one line in the PDF's narrower columns, so this test can make
  // strong, exact assertions on both outputs without word-wrap uncertainty.
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
    const pdfItems = await extractTextItems(pdfBuffer);

    // DOCX: verified the same way build-docx.test.ts already does (raw OOXML string containment).
    const JSZip = (await import("jszip")).default;
    const docxXml = await (await JSZip.loadAsync(docxBuffer)).file("word/document.xml")!.async("string");

    // Task count: exactly 2 distinctive keywords, one per task, in BOTH outputs.
    for (const keyword of ["HDMI", "Poly"]) {
      expect(docxXml).toContain(keyword);
      expect(hasText(pdfItems, keyword)).toBe(true);
    }

    // Room/floor names present in both -- checked per-word on the PDF side ("קומת קרקע" is two Hebrew
    // words; correct RTL rendering draws them as separate visually-reordered runs, see hasText's own
    // comment, so it's the WORDS that must be present, not that exact two-word substring).
    for (const label of ["קומת קרקע", "עליונה", "לובי", "מטבח"]) {
      expect(docxXml).toContain(label);
    }
    for (const word of ["קומת", "קרקע", "עליונה", "לובי", "מטבח"]) {
      expect(hasText(pdfItems, word)).toBe(true);
    }

    // Inspector name present in both.
    expect(docxXml).toContain("אבי לוי");
    expect(hasText(pdfItems, "אבי")).toBe(true);
    expect(hasText(pdfItems, "לוי")).toBe(true);
  });
});
