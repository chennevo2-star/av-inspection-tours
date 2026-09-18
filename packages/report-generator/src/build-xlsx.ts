import * as XLSX from "xlsx";
import type { InspectionReportData } from "./types.js";

/**
 * XLSX (task table) export — net new; REPORTING.md never specced an Excel output, this is a new
 * company requirement layered on top of the same free/open-source-library constraint that drove
 * build-pdf.ts's choices.
 *
 * Library: `xlsx` (SheetJS Community Edition). License verified directly (not assumed): SheetJS's own
 * published license page and the package's npm registry metadata both confirm Apache-2.0 for the `xlsx`
 * package specifically — genuinely free for commercial use, no per-seat/server licensing the way
 * SheetJS's Pro tier has. It's also the de facto standard pure-JS spreadsheet reader/writer (millions of
 * weekly downloads), actively maintained.
 *
 * Real, worth-naming-plainly limit of the Community Edition: it cannot write cell *styling*
 * (bold/fill/borders) or embed images — both require SheetJS's paid Pro add-ons. Since this export's job
 * is "the same task-table DATA as the DOCX/PDF table" (not a re-styled document), that ceiling doesn't
 * block the actual requirement -- it does mean the header row here is plain text, not bold/dark-filled
 * like the DOCX/PDF table headers, and task photos are represented by a count rather than embedded
 * images. Both are real, deliberate fidelity gaps, not oversights — see this file's final report note.
 */

const SHEET_NAME = "משימות";

const HEADERS = ["מס'", "קומה", "חדר/אזור", "ממצא / דרישה", "באחריות", "סטטוס", "תמונות"] as const;

/**
 * Builds the task table as a real `xlsx` `WorkBook`, rendered directly from the exact same
 * `InspectionReportData` build-docx.ts and build-pdf.ts both consume (same "no re-derived shape"
 * guarantee as build-pdf.ts — see its own top comment). Packing it into actual bytes is the caller's
 * job — see index.ts's `packXlsxToBuffer`/`packXlsxToBlob` — mirroring the build-vs-pack split used for
 * both other renderers.
 */
export function buildInspectionReportXlsx(data: InspectionReportData): XLSX.WorkBook {
  const rows: (string | number)[][] = [[...HEADERS]];

  data.tasks.forEach((task, index) => {
    rows.push([
      // Same numbering convention as build-docx.ts: position in the array (the order the reviewer
      // approved on screen), not the stored `friendlyNumber` -- see build-docx.ts's own comment on this
      // for the real drag-reorder bug this guards against.
      index + 1,
      task.floorName || "—",
      task.roomName || "—",
      task.description || "—",
      task.responsibleParty || "לא צוין",
      task.status || "—",
      // SheetJS Community Edition can't embed real images (Pro-only feature) -- recording the photo
      // COUNT instead of silently dropping the column, per REPORTING.md's "never a blank cell that
      // looks like data loss" QA rule.
      task.photos.length > 0 ? task.photos.length : "—",
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Column widths (character units, SheetJS's own `!cols`/`wch` convention) -- roughly mirrors
  // build-docx.ts's TASK_COLUMN_WIDTHS proportions so the sheet doesn't read as cramped.
  worksheet["!cols"] = [{ wch: 5 }, { wch: 10 }, { wch: 16 }, { wch: 50 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);

  // Workbook-level RTL view (`WBView.RTL`, confirmed against the `xlsx` package's own published
  // TypeScript definitions, not assumed). Without this, Excel opens the sheet with column A on the LEFT
  // and Hebrew text reading into a visually backwards column order; this makes column A appear on the
  // RIGHT instead, the way a Hebrew-authored spreadsheet actually reads.
  workbook.Workbook = { Views: [{ RTL: true }] };

  return workbook;
}
