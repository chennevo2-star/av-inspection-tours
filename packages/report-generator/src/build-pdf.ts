import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  type RGB,
} from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { NOTO_SANS_HEBREW_BOLD_BASE64, NOTO_SANS_HEBREW_REGULAR_BASE64 } from "./hebrew-font-data.js";
import type { InspectionReportData, ReportPhoto, ReportTaskRow } from "./types.js";

/**
 * PDF report generator — pure-JS/Node, no external binary (no LibreOffice/Adobe Acrobat/MS Office
 * install required on the server). This replaces the old "PDF is a LibreOffice rendering of the DOCX"
 * pipeline (ADR-004) per the company's hard requirement: PDF/Excel generation must run entirely on
 * free/open-source *libraries* inside our own backend.
 *
 * ## Why this library combination (researched 2026-09-18 — real tradeoffs, not generic praise)
 *
 * - **pdfmake** was the obvious first candidate (it has automatic table layout and text wrapping built
 *   in, which we have to hand-roll below). Rejected: real, right-to-left Hebrew support is a
 *   long-standing, still-open gap in the project itself (bpampuch/pdfmake issues #184, #758, #1463 span
 *   years) — the only "fixes" are unofficial third-party forks (pdfmake-rtl / @digicole/pdfmake-rtl).
 *   Betting this app's core requirement (correct Hebrew RTL) on a low-adoption fork of a library whose
 *   own maintainers never solved RTL is the wrong trade, even though it costs us more code here.
 * - A **pure-JS DOCX→PDF converter** (keeping ADR-004's "PDF is derived from the DOCX" guarantee, just
 *   swapping the converter) does not exist in a free, maintained form: `docx-pdf`/`docx2pdf*` on npm are
 *   thin wrappers that still shell out to LibreOffice/MS Word under the hood, or are unmaintained
 *   (years since last release); `docx-wasm` is a paid commercial SDK, not a free library. So this file
 *   generates the PDF directly from data instead (candidate (b) from the research brief), which is also
 *   why `InspectionReportData` (not DOCX bytes) is its input — see the cross-format regression test in
 *   build-pdf.test.ts for why that's the safety net that replaces ADR-004's old guarantee.
 * - **pdf-lib** gives exact, low-level control over text/image placement. The original `Hopding/pdf-lib`
 *   package is unmaintained (no npm release in over a year); this file depends on `@cantoo/pdf-lib`
 *   instead, an actively maintained fork that keeps the identical API/types (confirmed against its own
 *   npm metadata: MIT, versions actively published).
 * - **RTL text**: `page.drawText` always lays glyphs out left-to-right in the order it's given, and
 *   `@pdf-lib/fontkit`'s shaping layer only fixes glyph FORMS (correct Hebrew letterforms), not paragraph
 *   flow direction — it does no bidi reordering of its own. `toVisualOrder` (below) is what supplies that:
 *   it reorders whole same-script RUNS (Hebrew vs. everything else) into visual order while leaving each
 *   run's own internal character order untouched, since Hebrew letters within one word are already stored
 *   correctly and need no per-character reversal. See `toVisualOrder`'s own comment for the real bug this
 *   fixes and how it was verified.
 * - **Fonts**: pdf-lib can only embed real glyph outlines it's handed — it can't resolve a font "by name"
 *   the way Word/LibreOffice do against the OS's installed fonts, so build-docx.ts's plain `"Arial"`
 *   string isn't an option here. `@embedpdf/fonts-hebrew` (OFL-1.1 — the standard font-embedding license,
 *   explicitly permits this) ships real Noto Sans Hebrew Regular/Bold `.ttf` bytes. Real, empirical check
 *   (not an assumption) of that specific font file's own `cmap` table found it covers ONLY the Hebrew
 *   block (+ space/gershayim/geresh) — no Latin letters, digits, or ASCII punctuation at all (its name,
 *   "fonts for EmbedPDF", turns out to mean exactly that: a *fallback* font meant to sit alongside a
 *   separate Latin font, not a do-everything font the way system Arial is). So this file embeds it
 *   *alongside* pdf-lib's built-in Standard-14 Helvetica (zero extra asset, present in effectively every
 *   PDF viewer) and splits every line into per-script runs at draw time — see `splitScriptRuns` below.
 */

// ---------------------------------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------------------------------

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4 in points (pdf-lib's own PageSizes.A4 value)
const MARGIN = 40;
const HEADER_RESERVE = 22; // vertical space reserved at the top of every page for the running header
const FOOTER_RESERVE = 34; // vertical space reserved at the bottom for the footer + page number

// Exported alongside computeColumnBoxes() purely for build-pdf.test.ts's own use (asserting the RTL
// table's rightmost/leftmost column boundaries against real numbers, not hardcoded magic ones).
export const CONTENT_LEFT = MARGIN;
export const CONTENT_RIGHT = PAGE_SIZE[0] - MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
const CONTENT_TOP = PAGE_SIZE[1] - MARGIN - HEADER_RESERVE;
const CONTENT_BOTTOM = MARGIN + FOOTER_RESERVE;

// Colors reused from build-docx.ts's own palette, so the two renderers at least agree on a color story
// even though their layouts are independent (see the file-level comment in this module).
const DARK_TEXT = hexColor("111827");
const BODY_TEXT = hexColor("1F2937");
const MUTED_TEXT = hexColor("6B7280");
const HEADER_FILL = hexColor("1F2937");
const HEADER_TEXT = rgb(1, 1, 1);
const BORDER_COLOR = hexColor("9CA3AF");
const BORDER_LIGHT = hexColor("D1D5DB");

function hexColor(hex: string): RGB {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// ---------------------------------------------------------------------------------------------------
// Fonts: embed real Hebrew glyph outlines + pdf-lib's built-in Helvetica for everything else
// ---------------------------------------------------------------------------------------------------

interface FontSet {
  hebrewRegular: PDFFont;
  hebrewBold: PDFFont;
  latinRegular: PDFFont;
  latinBold: PDFFont;
}

/**
 * Real bytes, embedded as base64 in ./hebrew-font-data.ts (generated once from the actual
 * @embedpdf/fonts-hebrew package -- see that file's own comment) -- NOT read from disk at runtime.
 *
 * The original approach (`createRequire(import.meta.url)` + `require.resolve("@embedpdf/fonts-hebrew")`
 * to find the sibling package's real folder, then `readFileSync` a `.ttf` next to it -- needed because
 * that package's own "exports" map doesn't expose the raw font-file subpaths at all) works fine under
 * plain Node/Vitest, but was found -- via a real HTTP request against the real running dev server, not
 * just build-pdf.test.ts's direct function calls, which never go through webpack at all -- to break in
 * TWO different, reproducible ways once this file gets bundled by Next.js: `import.meta.url` no longer
 * points at a real on-disk location once webpack wraps the module, so the derived path resolves to
 * nonsense (a genuine ENOENT hit twice, at two different wrong paths, even after trying the
 * `serverComponentsExternalPackages` fix that resolves the equivalent problem for PGlite elsewhere in
 * this app -- see next.config.mjs's own comment on the ground it does and doesn't cover). Embedding the
 * font bytes directly sidesteps the entire class of problem instead of chasing a bundler-specific
 * workaround: there is no runtime path to resolve, so there is nothing for a bundler to get wrong.
 */
function loadHebrewFontBytes(): { regular: Buffer; bold: Buffer } {
  return {
    regular: Buffer.from(NOTO_SANS_HEBREW_REGULAR_BASE64, "base64"),
    bold: Buffer.from(NOTO_SANS_HEBREW_BOLD_BASE64, "base64"),
  };
}

async function embedFonts(doc: PDFDocument): Promise<FontSet> {
  doc.registerFontkit(fontkit);
  const hebrewBytes = loadHebrewFontBytes();
  return {
    // `subset: false` is deliberate, not the default oversight it looks like: `{ subset: true }` crashes
    // 100% of the time these specific NotoSansHebrew .ttf files reach `doc.save()` -- a real, reproducible
    // bug in @pdf-lib/fontkit's TTF subset encoder (`Struct.encode`: "Cannot read properties of undefined
    // (reading 'pos')"), confirmed in isolation outside this whole app (a standalone embed+drawText+save
    // repro, independent of anything else in this file) before concluding it wasn't something to work
    // around here instead. Embedding the full ~25KB font uncut is a perfectly acceptable cost for a
    // Hebrew-only glyph set this small -- correctness over a few KB of file size.
    hebrewRegular: await doc.embedFont(hebrewBytes.regular, { subset: false }),
    hebrewBold: await doc.embedFont(hebrewBytes.bold, { subset: false }),
    latinRegular: await doc.embedFont(StandardFonts.Helvetica),
    latinBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

function fontFor(fonts: FontSet, hebrew: boolean, bold: boolean): PDFFont {
  if (hebrew) return bold ? fonts.hebrewBold : fonts.hebrewRegular;
  return bold ? fonts.latinBold : fonts.latinRegular;
}

// ---------------------------------------------------------------------------------------------------
// Bidi: converts logical-order text (however it was typed/stored) into the visual order `drawVisualLine`
// needs, since `page.drawText` always lays out characters left-to-right starting from wherever it's told
// to start.
//
// REAL BUG FOUND AND FIXED HERE (2026-09-19, real production report screenshot: "the text itself is
// reversed and comes out LTR instead of RTL"). An EARLIER round this same session had already replaced
// this function with a bare passthrough (`return text`), on the theory that pdf-lib/fontkit needed no
// bidi help at all -- that "fix" was itself wrong, and this is the correction. Concrete evidence: a real
// PDF generated by this exact endpoint, read back with pdfjs-dist's `getTextContent()` (exact x
// coordinates, not eyeballing a rendered image -- eyeballing is what caused the earlier wrong conclusion
// in the first place), showed "לשנאל" drawn at x=360 and "מימין" at x=388 for the logical string "לשנאל
// מימין" -- i.e. the SECOND word ended up to the RIGHT of the first, meaning `drawVisualLine` drew the
// two words in plain left-to-right TYPING order. `@pdf-lib/fontkit`'s shaping layer fixes individual
// GLYPH forms (why single Hebrew words always looked fine on their own, which is what the earlier,
// wrong verification round happened to check) -- it does nothing about paragraph/run FLOW DIRECTION,
// which was never pdf-lib's job to begin with; a bidi-UNAWARE renderer needs the caller to hand it
// visual-order text, full stop.
//
// The fix does NOT reinstate the old per-character reversal (that earlier bug was real too: reversing
// every character, including inside a single Hebrew word or an embedded "B2tech"/date run, corrupts
// THOSE independently). Since `splitScriptRuns` below already segments a line into Hebrew-vs-other runs
// at exactly the granularity bidi resolution needs here (this report only ever mixes a base RTL
// paragraph with embedded LTR runs -- numbers, dates, English company names -- never nested bidi
// levels), reversing the ORDER of those runs while leaving each run's own internal character order
// intact is both correct and simfpler than pulling in a full Unicode Bidi Algorithm library again.
// Verified the same rigorous way (pdfjs-dist coordinates, not visual inspection) against multiple real
// cases before redeploying: multi-word Hebrew, Hebrew+English, Hebrew+date, and the task table itself —
// see build-pdf.test.ts's own positional (not just presence) assertions.
// ---------------------------------------------------------------------------------------------------

function toVisualOrder(text: string): string {
  return splitScriptRuns(text)
    .reverse()
    .map((run) => run.text)
    .join("");
}

const HEBREW_BLOCK_START = 0x0590;
const HEBREW_BLOCK_END = 0x05ff;

function isHebrewCodePoint(codePoint: number): boolean {
  return codePoint >= HEBREW_BLOCK_START && codePoint <= HEBREW_BLOCK_END;
}

interface ScriptRun {
  text: string;
  hebrew: boolean;
}

/**
 * Splits a string into consecutive runs of "Hebrew-block characters" vs. everything else. Needed
 * because the one embedded Hebrew font here has no Latin/digit/punctuation glyphs at all (see the
 * file-level comment) -- every mixed line has to be drawn (and measured) as an alternating sequence of
 * runs, each in its own matching font, the same way real font-fallback works in any text engine.
 */
function splitScriptRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let current = "";
  let currentHebrew: boolean | null = null;
  for (const ch of text) {
    const hebrew = isHebrewCodePoint(ch.codePointAt(0) ?? 0);
    if (currentHebrew === null || hebrew === currentHebrew) {
      current += ch;
      currentHebrew = hebrew;
    } else {
      runs.push({ text: current, hebrew: currentHebrew });
      current = ch;
      currentHebrew = hebrew;
    }
  }
  if (current) runs.push({ text: current, hebrew: currentHebrew ?? false });
  return runs;
}

/**
 * Total width of `text` at `size`, correctly accounting for the per-script font switch above. Reordering
 * (bidi) and mirroring never change *which* characters are present, only their order/glyph-shape, so
 * measuring on the original logical string gives the same total as measuring the reordered visual
 * string -- this lets word-wrap decisions (below) work on the simpler logical string.
 */
function measureWidth(text: string, size: number, fonts: FontSet, bold: boolean): number {
  return splitScriptRuns(text).reduce(
    (sum, run) => sum + fontFor(fonts, run.hebrew, bold).widthOfTextAtSize(run.text || " ", size),
    0
  );
}

/** Draws one already-visual-order line, run by run, left-to-right starting at `startX`. */
function drawVisualLine(
  page: PDFPage,
  visualText: string,
  startX: number,
  y: number,
  size: number,
  fonts: FontSet,
  bold: boolean,
  color: RGB
): void {
  let x = startX;
  for (const run of splitScriptRuns(visualText)) {
    const font = fontFor(fonts, run.hebrew, bold);
    page.drawText(run.text, { x, y, size, font, color });
    x += font.widthOfTextAtSize(run.text, size);
  }
}

type Align = "start" | "center" | "end";

/**
 * Draws one logical-order line inside `box`, right-aligned by default ("start" -- the reading-start
 * edge for our right-to-left content, i.e. the box's RIGHT edge). This mirrors, in spirit, build-docx.ts's
 * hard-won `AlignmentType.START`/`END` lesson (its own test explicitly locks in that a literal
 * "right"/"left" value renders wrong under real RTL rendering) -- except here there is no logical
 * "start"/"end" primitive to hand a renderer at all, so this function *is* that primitive: "start" always
 * resolves to the box's right edge and "end" to its left edge, regardless of what the text itself
 * contains, because every real paragraph in this report is authored as right-to-left content.
 */
function drawAlignedLine(
  page: PDFPage,
  logicalText: string,
  box: { left: number; right: number },
  y: number,
  size: number,
  fonts: FontSet,
  options: { bold?: boolean; color?: RGB; align?: Align } = {}
): void {
  const bold = options.bold ?? false;
  const color = options.color ?? BODY_TEXT;
  const align = options.align ?? "start";
  const width = measureWidth(logicalText, size, fonts, bold);
  const startX =
    align === "center" ? box.left + (box.right - box.left - width) / 2 : align === "end" ? box.left : box.right - width;
  drawVisualLine(page, toVisualOrder(logicalText), startX, y, size, fonts, bold, color);
}

// ---------------------------------------------------------------------------------------------------
// Word wrap (operates on logical order; only the final drawing step needs visual order)
// ---------------------------------------------------------------------------------------------------

function hardSplitWord(word: string, maxWidth: number, size: number, fonts: FontSet, bold: boolean): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const ch of word) {
    const candidate = current + ch;
    if (current && measureWidth(candidate, size, fonts, bold) > maxWidth) {
      pieces.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrapText(text: string, maxWidth: number, size: number, fonts: FontSet, bold = false): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureWidth(candidate, size, fonts, bold) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      if (measureWidth(word, size, fonts, bold) <= maxWidth) {
        current = word;
      } else {
        // A single token wider than the whole column (e.g. a long model number) -- hard-split by
        // character rather than overflow the cell (REPORTING.md's "no table overflow" QA rule).
        const pieces = hardSplitWord(word, maxWidth, size, fonts, bold);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? "";
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

// ---------------------------------------------------------------------------------------------------
// Images: pdf-lib genuinely decodes/validates image bytes (unlike `docx`, which just tags a
// relationship type and lets Word's own sniffing take its chances -- see build-docx.ts's
// `imageTypeFromMime` comment). A format pdf-lib can't decode (e.g. WebP -- it has no decoder for it at
// all) must not crash the whole report: per this codebase's no-mock-success rule, an image we truly
// can't embed is shown as honestly absent (a placeholder), never faked or silently skipped without a
// trace.
// ---------------------------------------------------------------------------------------------------

async function tryEmbedImage(doc: PDFDocument, photo: ReportPhoto): Promise<PDFImage | null> {
  try {
    if (photo.mimeType.includes("png")) return await doc.embedPng(photo.bytes);
    return await doc.embedJpg(photo.bytes);
  } catch {
    return null;
  }
}

async function embedTaskPhotos(doc: PDFDocument, task: ReportTaskRow): Promise<PDFImage[]> {
  const images: PDFImage[] = [];
  for (const photo of task.photos.slice(0, 2)) {
    const image = await tryEmbedImage(doc, photo);
    if (image) images.push(image);
  }
  return images;
}

// ---------------------------------------------------------------------------------------------------
// Page cursor: a mutable "where do we draw next" pointer, with page-break handling
// ---------------------------------------------------------------------------------------------------

interface Cursor {
  page: PDFPage;
  y: number;
}

function startNewPage(doc: PDFDocument): Cursor {
  const page = doc.addPage(PAGE_SIZE);
  return { page, y: CONTENT_TOP };
}

function ensureRoom(cursor: Cursor, neededHeight: number): void {
  if (cursor.y - neededHeight < CONTENT_BOTTOM) {
    const next = startNewPage(cursor.page.doc); // `page.doc` is a real, public pdf-lib property -- no
    // need to thread a separate `doc` reference through every layout function just for this.
    cursor.page = next.page;
    cursor.y = next.y;
  }
}

// ---------------------------------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------------------------------

function formatDateLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });
}

// Matches the trailing " DD.MM.YYYY" apps/web's formatTourName() always appends (its own toLocaleDateString
// with { year: "numeric", month: "2-digit", day: "2-digit" }).
const TOUR_NAME_DATE_SUFFIX = /\s(\d{2}\.\d{2}\.\d{4})$/;

/**
 * Draws the cover title as ONE bidi-reordered run when it's all-Hebrew, but splits the trailing date off
 * and positions it separately when it isn't (real bug found here, user report, 2026-09-19: "the date
 * should always come last regardless of whether the project name is English or Hebrew"). Root cause:
 * `toVisualOrder`'s run-reversal (see its own comment) is correct bidi behavior for ADJACENT same-
 * direction content, which is exactly the problem -- an English project name immediately followed by the
 * date (also non-Hebrew: digits + dots) merges into ONE combined LTR run, and only the run as a WHOLE gets
 * repositioned; nothing reorders the project name and date RELATIVE to each other within it, so the date
 * ends up sandwiched next to the project name instead of at the line's true left/last edge. A Hebrew
 * project name never hits this: it stays part of the preceding Hebrew run, so the trailing date is
 * already its own isolated non-Hebrew run and lands correctly. This function makes both cases behave the
 * same way explicitly, rather than relying on where a script boundary happens to fall.
 */
function drawCoverTitle(page: PDFPage, tourName: string, box: { left: number; right: number }, y: number, size: number, fonts: FontSet): void {
  const match = tourName.match(TOUR_NAME_DATE_SUFFIX);
  if (!match || match.index === undefined) {
    // Defensive fallback (e.g. a tourName shape this regex doesn't recognize) -- never crash, just fall
    // back to plain single-run bidi reordering, same as before this fix existed.
    drawAlignedLine(page, tourName, box, y, size, fonts, { bold: true, color: DARK_TEXT, align: "center" });
    return;
  }

  const datePart = match[1]!;
  const titlePart = tourName.slice(0, match.index);
  // A visibly wider gap than a plain space -- besides reading better (the date is meant to stand apart,
  // not just barely clear of the last word), a single-space gap here was found to make pdfjs-dist's own
  // getTextContent() merge the date and the next run into one reported text item (a real, reproducible
  // extraction-layer quirk, not a rendering bug: the glyphs themselves draw at the correct, distinct
  // positions either way) -- see build-pdf.test.ts's own regression test for this exact case.
  const gapWidth = fontFor(fonts, false, true).widthOfTextAtSize(" ", size) * 2.5;
  const titleWidth = measureWidth(titlePart, size, fonts, true);
  const dateWidth = measureWidth(datePart, size, fonts, true);
  const totalWidth = titleWidth + gapWidth + dateWidth;
  const startX = box.left + (box.right - box.left - totalWidth) / 2;

  // The date is drawn first (leftmost -- the line's true "last" position for RTL reading), the rest of
  // the title immediately to its right, ending at the block's right edge -- always, regardless of script.
  drawVisualLine(page, datePart, startX, y, size, fonts, true, DARK_TEXT);
  drawVisualLine(page, toVisualOrder(titlePart), startX + dateWidth + gapWidth, y, size, fonts, true, DARK_TEXT);
}

function drawCover(cursor: Cursor, fonts: FontSet, data: InspectionReportData, logoImage: PDFImage | null): void {
  if (logoImage) {
    const dims = logoImage.scaleToFit(140, 70);
    ensureRoom(cursor, dims.height + 16);
    cursor.page.drawImage(logoImage, {
      x: (PAGE_SIZE[0] - dims.width) / 2,
      y: cursor.y - dims.height,
      width: dims.width,
      height: dims.height,
    });
    cursor.y -= dims.height + 16;
  }

  const dateLabel = formatDateLabel(data.inspectionDate);
  drawCoverTitle(cursor.page, data.tourName, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 18, fonts);
  cursor.y -= 26;

  drawAlignedLine(cursor.page, "דו״ח פיקוח עליון – מערכות מולטימדיה", { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 12, fonts, {
    color: MUTED_TEXT,
    align: "center",
  });
  cursor.y -= 30;

  const metaLines: [string, string][] = [
    ["פרויקט", data.projectName],
    ...(data.projectAddress ? ([["כתובת", data.projectAddress]] as [string, string][]) : []),
    ["מספר סיור", `#${data.inspectionNumber}`],
    ["תאריך", dateLabel],
    ["משתתפים", data.participants.length > 0 ? data.participants.join(", ") : "לא צוינו"],
    ["נערך על ידי", data.officeName],
  ];
  // NOTE (fidelity gap vs. build-docx.ts, deliberately not chased further): the DOCX cover page bolds
  // just the "label:" prefix of each meta line as a separate run; drawing a per-line two-weight mix here
  // would mean extending drawAlignedLine to accept multiple runs of different *weights* (script-run
  // splitting already handles multiple *fonts* per line, but weight is a third, separate axis) for a
  // purely cosmetic gain. Kept as one plain-weight line instead -- see this file's final report note.
  for (const [label, value] of metaLines) {
    ensureRoom(cursor, 16);
    drawAlignedLine(cursor.page, `${label}: ${value}`, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 11, fonts, {
      color: DARK_TEXT,
    });
    cursor.y -= 16;
  }
  cursor.y -= 14;
}

// ---------------------------------------------------------------------------------------------------
// Heading + paragraph sections (general / summary)
// ---------------------------------------------------------------------------------------------------

function drawHeading(cursor: Cursor, fonts: FontSet, text: string): void {
  ensureRoom(cursor, 34);
  cursor.y -= 6;
  drawAlignedLine(cursor.page, text, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 13, fonts, { bold: true, color: DARK_TEXT });
  cursor.y -= 20;
}

function drawParagraph(cursor: Cursor, fonts: FontSet, text: string): void {
  const lines = wrapText(text, CONTENT_WIDTH, 11, fonts);
  for (const line of lines) {
    ensureRoom(cursor, 15);
    drawAlignedLine(cursor.page, line, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 11, fonts, { color: BODY_TEXT });
    cursor.y -= 15;
  }
}

// ---------------------------------------------------------------------------------------------------
// Task table
// ---------------------------------------------------------------------------------------------------

// Same proportions and the SAME authoring order as build-docx.ts's TASK_COLUMN_WIDTHS ("number" first,
// "status" last) -- but see computeColumnBoxes() below for why the two renderers don't place them at the
// same physical X despite sharing this order.
const TASK_COLUMN_WIDTHS = { number: 6, floor: 10, room: 12, description: 28, photo: 16, responsible: 16, status: 12 };
const TASK_COLUMN_ORDER = ["number", "floor", "room", "description", "photo", "responsible", "status"] as const;
type TaskColumnKey = (typeof TASK_COLUMN_ORDER)[number];
const TASK_COLUMN_HEADERS: Record<TaskColumnKey, string> = {
  number: "מס'",
  floor: "קומה",
  room: "חדר/אזור",
  description: "ממצא / דרישה",
  photo: "תמונה",
  responsible: "באחריות",
  status: "סטטוס",
};

const TABLE_FONT_SIZE = 9;
const TABLE_LINE_HEIGHT = 11;
const TABLE_CELL_PADDING = 4;
const TABLE_HEADER_HEIGHT = 22;
const PHOTO_BOX = 55;
const PHOTO_GAP = 4;

interface ColumnBox {
  left: number;
  right: number;
}

/**
 * Real bug found and fixed here (user report, 2026-09-19: "the table needs to be RTL"): TASK_COLUMN_ORDER
 * is authored left-to-right ("number" first, "status" last) to match build-docx.ts's own column
 * definitions -- but unlike Word (which flips DISPLAY order for a `visuallyRightToLeft` table while
 * leaving the column definitions themselves untouched, see build-docx.ts's own comment on that flag),
 * pdf-lib has no such table-level RTL concept; box positions here are the ONLY thing that decides where
 * a column actually appears. Walking the column list from the page's RIGHT edge (instead of its left)
 * is what makes the visual result match: the first-authored column ("number") lands at the RIGHT, where
 * a Hebrew reader's eye starts, and the last-authored one ("status") at the left -- exactly mirroring
 * what `visuallyRightToLeft: true` achieves in the DOCX path, achieved here by geometry instead of a flag.
 */
// Exported (not re-exported via index.ts -- this stays an internal detail of the package's public API)
// purely so build-pdf.test.ts can assert the column geometry directly, white-box, instead of only via a
// full rendered PDF's text positions -- this is the exact function whose LTR-vs-RTL box placement was the
// real bug (see its own comment above computeColumnBoxes' definition).
export function computeColumnBoxes(): Record<TaskColumnKey, ColumnBox> {
  const boxes = {} as Record<TaskColumnKey, ColumnBox>;
  let x = CONTENT_RIGHT;
  for (const key of TASK_COLUMN_ORDER) {
    const width = (TASK_COLUMN_WIDTHS[key] / 100) * CONTENT_WIDTH;
    boxes[key] = { left: x - width, right: x };
    x -= width;
  }
  return boxes;
}

function drawTableHeaderRow(page: PDFPage, boxes: Record<TaskColumnKey, ColumnBox>, top: number, fonts: FontSet): void {
  page.drawRectangle({ x: CONTENT_LEFT, y: top - TABLE_HEADER_HEIGHT, width: CONTENT_WIDTH, height: TABLE_HEADER_HEIGHT, color: HEADER_FILL });
  const textY = top - TABLE_HEADER_HEIGHT / 2 - 3.5;
  for (const key of TASK_COLUMN_ORDER) {
    const box = boxes[key];
    drawAlignedLine(page, TASK_COLUMN_HEADERS[key], { left: box.left + 2, right: box.right - 2 }, textY, TABLE_FONT_SIZE, fonts, {
      bold: true,
      color: HEADER_TEXT,
      align: "center",
    });
  }
}

type TaskCellLines = Record<Exclude<TaskColumnKey, "photo">, string[]>;

/**
 * Never lets a cell go visually blank -- mirrors build-docx.ts's `textCell` helper, which applies this
 * exact same `|| "—"` fallback to *every* table cell it builds (REPORTING.md's QA rule: "never a blank
 * cell that looks like data loss"). Applied here even to fields that already got a `??` fallback at the
 * call site, to also catch an empty *string* (not just null/undefined), same as textCell does.
 */
function cellText(text: string | null | undefined, fallback = "—"): string {
  return text && text.trim().length > 0 ? text : fallback;
}

function computeTaskRowLines(task: ReportTaskRow, index: number, boxes: Record<TaskColumnKey, ColumnBox>, fonts: FontSet): TaskCellLines {
  const widthOf = (key: TaskColumnKey) => boxes[key].right - boxes[key].left - TABLE_CELL_PADDING * 2;
  return {
    number: wrapText(String(index + 1), widthOf("number"), TABLE_FONT_SIZE, fonts),
    floor: wrapText(cellText(task.floorName), widthOf("floor"), TABLE_FONT_SIZE, fonts),
    room: wrapText(cellText(task.roomName), widthOf("room"), TABLE_FONT_SIZE, fonts),
    description: wrapText(cellText(task.description), widthOf("description"), TABLE_FONT_SIZE, fonts),
    responsible: wrapText(cellText(task.responsibleParty, "לא צוין"), widthOf("responsible"), TABLE_FONT_SIZE, fonts),
    status: wrapText(cellText(task.status), widthOf("status"), TABLE_FONT_SIZE, fonts),
  };
}

function computeRowHeight(cellLines: TaskCellLines, photoCount: number): number {
  const maxLines = Math.max(1, ...Object.values(cellLines).map((lines) => lines.length));
  let height = maxLines * TABLE_LINE_HEIGHT + TABLE_CELL_PADDING * 2;
  if (photoCount > 0) height = Math.max(height, PHOTO_BOX + TABLE_CELL_PADDING * 2);
  return height;
}

function drawWrappedColumn(
  page: PDFPage,
  lines: string[],
  box: ColumnBox,
  rowTop: number,
  rowHeight: number,
  fonts: FontSet
): void {
  const blockHeight = lines.length * TABLE_LINE_HEIGHT;
  let y = rowTop - (rowHeight - blockHeight) / 2 - TABLE_LINE_HEIGHT * 0.8;
  for (const line of lines) {
    drawAlignedLine(page, line, { left: box.left + TABLE_CELL_PADDING, right: box.right - TABLE_CELL_PADDING }, y, TABLE_FONT_SIZE, fonts, {
      color: BODY_TEXT,
    });
    y -= TABLE_LINE_HEIGHT;
  }
}

function drawTaskRow(
  page: PDFPage,
  boxes: Record<TaskColumnKey, ColumnBox>,
  rowTop: number,
  rowHeight: number,
  cellLines: TaskCellLines,
  photos: PDFImage[],
  fonts: FontSet
): void {
  page.drawRectangle({
    x: CONTENT_LEFT,
    y: rowTop - rowHeight,
    width: CONTENT_WIDTH,
    height: rowHeight,
    borderColor: BORDER_LIGHT,
    borderWidth: 0.5,
  });
  for (const key of TASK_COLUMN_ORDER) {
    const box = boxes[key];
    page.drawLine({ start: { x: box.left, y: rowTop }, end: { x: box.left, y: rowTop - rowHeight }, thickness: 0.5, color: BORDER_COLOR });
  }

  (Object.keys(cellLines) as (keyof TaskCellLines)[]).forEach((key) => {
    drawWrappedColumn(page, cellLines[key], boxes[key], rowTop, rowHeight, fonts);
  });

  const photoBox = boxes.photo;
  if (photos.length === 0) {
    drawAlignedLine(page, "—", { left: photoBox.left, right: photoBox.right }, rowTop - rowHeight / 2 - 3.5, TABLE_FONT_SIZE, fonts, {
      align: "center",
      color: MUTED_TEXT,
    });
  } else {
    const slotWidth = (photoBox.right - photoBox.left - PHOTO_GAP) / Math.min(photos.length, 2) - PHOTO_GAP;
    let x = photoBox.left + PHOTO_GAP;
    for (const photo of photos.slice(0, 2)) {
      const dims = photo.scaleToFit(slotWidth, PHOTO_BOX - PHOTO_GAP * 2);
      const y = rowTop - rowHeight / 2 - dims.height / 2;
      page.drawImage(photo, { x, y, width: dims.width, height: dims.height });
      x += slotWidth + PHOTO_GAP;
    }
  }
}

function drawTaskTable(cursor: Cursor, fonts: FontSet, tasks: ReportTaskRow[], taskPhotoImages: PDFImage[][]): void {
  const boxes = computeColumnBoxes();
  ensureRoom(cursor, TABLE_HEADER_HEIGHT + TABLE_LINE_HEIGHT + TABLE_CELL_PADDING * 2);
  drawTableHeaderRow(cursor.page, boxes, cursor.y, fonts);
  cursor.y -= TABLE_HEADER_HEIGHT;

  tasks.forEach((task, index) => {
    const cellLines = computeTaskRowLines(task, index, boxes, fonts);
    const photos = taskPhotoImages[index] ?? [];
    const rowHeight = computeRowHeight(cellLines, photos.length);

    if (cursor.y - rowHeight < CONTENT_BOTTOM) {
      const next = startNewPage(cursor.page.doc);
      cursor.page = next.page;
      cursor.y = next.y;
      drawTableHeaderRow(cursor.page, boxes, cursor.y, fonts); // repeat header row, like docx's tableHeader
      cursor.y -= TABLE_HEADER_HEIGHT;
    }

    drawTaskRow(cursor.page, boxes, cursor.y, rowHeight, cellLines, photos, fonts);
    cursor.y -= rowHeight;
  });
}

// ---------------------------------------------------------------------------------------------------
// Signature section (inspector stamp bank — mirrors build-docx.ts's own signatureSection)
// ---------------------------------------------------------------------------------------------------

function drawSignature(cursor: Cursor, fonts: FontSet, data: InspectionReportData, stampImage: PDFImage | null): void {
  if (!data.inspectorName && !data.inspectorStamp) return;
  ensureRoom(cursor, 130);
  cursor.y -= 20;

  if (stampImage) {
    const dims = stampImage.scaleToFit(90, 90);
    ensureRoom(cursor, dims.height + 16);
    cursor.page.drawImage(stampImage, { x: CONTENT_RIGHT - dims.width, y: cursor.y - dims.height, width: dims.width, height: dims.height });
    cursor.y -= dims.height + 6;
  }
  if (data.inspectorName) {
    drawAlignedLine(cursor.page, data.inspectorName, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 11, fonts, {
      bold: true,
      color: DARK_TEXT,
    });
    cursor.y -= 16;
  }
}

// ---------------------------------------------------------------------------------------------------
// Header / footer + page numbers (finalization pass -- run once after all content/pages exist, since
// "page X of N" needs the final page count)
// ---------------------------------------------------------------------------------------------------

function drawHeadersAndFooters(doc: PDFDocument, fonts: FontSet, data: InspectionReportData): void {
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page: PDFPage, index: number) => {
    // Office name, "end"-aligned -- mirrors build-docx.ts's header line, which uses
    // `AlignmentType.END` (its own test locks in `w:jc w:val="end"` there specifically), i.e. the LEFT
    // side for our right-to-left content.
    drawAlignedLine(page, data.officeName, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, PAGE_SIZE[1] - MARGIN - 4, 8, fonts, {
      color: MUTED_TEXT,
      align: "end",
    });

    drawAlignedLine(
      page,
      `${data.projectName} — סיור #${data.inspectionNumber}`,
      { left: CONTENT_LEFT, right: CONTENT_RIGHT },
      MARGIN + 16,
      8,
      fonts,
      { color: MUTED_TEXT, align: "center" }
    );
    drawAlignedLine(page, `עמוד ${index + 1} מתוך ${total}`, { left: CONTENT_LEFT, right: CONTENT_RIGHT }, MARGIN + 4, 7, fonts, {
      color: MUTED_TEXT,
      align: "center",
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------

/**
 * Builds the report as a real `@cantoo/pdf-lib` `PDFDocument`, rendered directly from the exact same
 * `InspectionReportData` build-docx.ts consumes (no re-derived/different shape -- see this file's
 * top comment and build-pdf.test.ts's cross-format regression test). Packing it into actual bytes is the
 * caller's job -- see index.ts's `packPdfToBuffer`/`packPdfToBlob` -- mirroring build-docx.ts's own
 * build-vs-pack split exactly.
 */
export async function buildInspectionReportPdf(data: InspectionReportData): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  const logoImage = data.logo ? await tryEmbedImage(doc, data.logo) : null;
  const stampImage = data.inspectorStamp ? await tryEmbedImage(doc, data.inspectorStamp) : null;
  const taskPhotoImages = await Promise.all(data.tasks.map((task) => embedTaskPhotos(doc, task)));

  const first = startNewPage(doc);
  const cursor: Cursor = { page: first.page, y: first.y };

  drawCover(cursor, fonts, data, logoImage);

  drawHeading(cursor, fonts, "כללי");
  drawParagraph(cursor, fonts, data.generalText || "לא הוזן תיאור כללי.");

  drawHeading(cursor, fonts, "משימות וליקויים");
  if (data.tasks.length > 0) {
    drawTaskTable(cursor, fonts, data.tasks, taskPhotoImages);
  } else {
    ensureRoom(cursor, 15);
    drawAlignedLine(cursor.page, "לא נרשמו משימות בסיור זה.", { left: CONTENT_LEFT, right: CONTENT_RIGHT }, cursor.y, 11, fonts, {
      color: BODY_TEXT,
    });
    cursor.y -= 15;
  }

  // Extra breathing room specifically here (user request, 2026-09-19: the table's own bottom border sat
  // too close to the "סיכום" heading right above it, reading as if they touched/overlapped) -- on top of
  // drawHeading's own small pre-gap, not a replacement for it (that gap is shared by every heading, this
  // one is deliberately just for the table -> summary transition).
  cursor.y -= 18;
  drawHeading(cursor, fonts, "סיכום");
  drawParagraph(cursor, fonts, data.summaryText || "לא הוזן סיכום.");
  ensureRoom(cursor, 20);
  cursor.y -= 6;
  // No italic font variant is embedded (the OFL Hebrew font here ships only Regular/Bold -- see the
  // file-level comment), so this closing note, italicized in the DOCX, is rendered muted+smaller
  // instead of slanted. A real, minor, deliberate fidelity gap -- see this file's final report note.
  drawAlignedLine(
    cursor.page,
    "על כל בעל תפקיד למלא את המשימות המשויכות לו ולעדכן במייל חוזר על סיום הטיפול.",
    { left: CONTENT_LEFT, right: CONTENT_RIGHT },
    cursor.y,
    9,
    fonts,
    { color: MUTED_TEXT }
  );
  cursor.y -= 15;

  drawSignature(cursor, fonts, data, stampImage);

  drawHeadersAndFooters(doc, fonts, data);

  return doc;
}
