import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { InspectionReportData, ReportTaskRow } from "./types.js";

const HEBREW_FONT = "Arial"; // real Hebrew-safe font, configurable later per REPORTING.md §34 — not yet exposed as a setting

/** Every paragraph in this document is authored RTL from the start (REPORTING.md — not a later fix). */
function rtlParagraph(options: ConstructorParameters<typeof Paragraph>[0]): Paragraph {
  const base = typeof options === "string" ? { text: options } : options;
  return new Paragraph({ ...base, bidirectional: true });
}

/**
 * A small local shape for the run styling this file actually uses, rather than deriving one from
 * `docx`'s own TextRun constructor type: that type is a union across several run kinds (plain text,
 * page-number field, tab, …), and TypeScript's `Omit` over a union keeps only properties common to every
 * member — which silently drops `size`/`color`/etc. and produces confusing errors far from the real
 * cause. Passing this concrete shape into `new TextRun({...})` still gets fully checked against the
 * library's real "plain text run" option type at that call site.
 */
interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  size?: number; // half-points (docx convention) — e.g. 24 = 12pt
  color?: string; // hex, no '#'
  break?: number; // real line breaks (<w:br/>) inserted before this run — see textCell's own comment
}

function rtlRun(text: string, style: RunStyle = {}): TextRun {
  return new TextRun({ text, rightToLeft: true, font: HEBREW_FONT, ...style });
}

function headerCell(text: string, widthPercent: number): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill: "1F2937" },
    children: [rtlParagraph({ alignment: AlignmentType.CENTER, children: [rtlRun(text, { bold: true, color: "FFFFFF", size: 20 })] })],
  });
}

function bodyCell(children: Paragraph[], widthPercent: number): TableCell {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    children,
  });
}

/**
 * A literal "\n" inside a plain TextRun's `text` does NOT render as a line break in OOXML -- Word only
 * breaks a line on an explicit `<w:br/>` (here, `TextRun`'s own `break` option, which the `docx` package
 * renders as one). Real bug found here (user request, 2026-09-19: each contractor should get its own
 * line in the "באחריות" cell when a task has several) -- assemble-report-data.ts newline-joins multiple
 * responsible parties into one string, and without this, that string rendered as one run of literal `\n`
 * characters Word just drops, collapsing every name onto a single line. Splits on "\n" into one run per
 * line, each subsequent run preceded by a real break -- general to any multi-line cell text, not just
 * this one column (a multi-line task description, typed with real newlines in the wizard's textarea, was
 * silently collapsing here too before this fix).
 */
function textCell(text: string, widthPercent: number): TableCell {
  const lines = (text || "—").split("\n");
  const runs = lines.map((line, index) => rtlRun(line, { size: 20, break: index > 0 ? 1 : undefined }));
  return bodyCell([rtlParagraph({ alignment: AlignmentType.START, children: runs })], widthPercent);
}

// Narrowed to just the two variants this file ever produces (never "svg") — IImageOptions is a
// discriminated union where the "svg" branch requires an extra `fallback` field; keeping this union tiny
// lets `new ImageRun({ type: ..., ... })` resolve to the plain raster-image branch everywhere it's used.
type RasterImageType = "jpg" | "png";

function imageTypeFromMime(mimeType: string): RasterImageType {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "png"; // docx has no native webp support — see note in buildTaskPhotosCell
  return "jpg";
}

function buildTaskPhotosCell(task: ReportTaskRow, widthPercent: number): TableCell {
  if (task.photos.length === 0) {
    return textCell("—", widthPercent);
  }
  const images = task.photos.slice(0, 2).map(
    (photo) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: photo.bytes,
            type: imageTypeFromMime(photo.mimeType),
            transformation: { width: 90, height: 90 },
          }),
        ],
      })
  );
  return bodyCell(images, widthPercent);
}

const TASK_COLUMN_WIDTHS = { number: 6, floor: 10, room: 12, description: 28, photo: 16, responsible: 16, status: 12 };

function buildTaskTable(tasks: ReportTaskRow[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("מס'", TASK_COLUMN_WIDTHS.number),
      headerCell("קומה", TASK_COLUMN_WIDTHS.floor),
      headerCell("חדר/אזור", TASK_COLUMN_WIDTHS.room),
      headerCell("ממצא / דרישה", TASK_COLUMN_WIDTHS.description),
      headerCell("תמונה", TASK_COLUMN_WIDTHS.photo),
      headerCell("באחריות", TASK_COLUMN_WIDTHS.responsible),
      headerCell("סטטוס", TASK_COLUMN_WIDTHS.status),
    ],
  });

  const rows = tasks.map(
    (task, index) =>
      // Numbered by position in `tasks` (the order the caller wants printed), not `friendlyNumber` --
      // that array order is exactly what the report-preview screen's drag-reorder produces, so the
      // printed number always matches what the reviewer saw on screen, even after reordering.
      new TableRow({
        children: [
          textCell(String(index + 1), TASK_COLUMN_WIDTHS.number),
          textCell(task.floorName ?? "—", TASK_COLUMN_WIDTHS.floor),
          textCell(task.roomName ?? "—", TASK_COLUMN_WIDTHS.room),
          textCell(task.description, TASK_COLUMN_WIDTHS.description),
          buildTaskPhotosCell(task, TASK_COLUMN_WIDTHS.photo),
          textCell(task.responsibleParty ?? "לא צוין", TASK_COLUMN_WIDTHS.responsible),
          textCell(task.status, TASK_COLUMN_WIDTHS.status),
        ],
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    // Real bug found and fixed here (user report, 2026-09-19: "the table needs to be RTL"): the columns
    // above are authored left-to-right ("number" first, "status" last) -- without this flag, Word renders
    // them in exactly that literal order, i.e. the row NUMBER column ends up on the visual LEFT and
    // STATUS on the visual RIGHT, backwards for a Hebrew reader (who expects the first/most-important
    // column on the right, where RTL reading starts). `w:bidiVisual` is OOXML's own table-level property
    // for exactly this: it tells Word to flip the DISPLAY order of an otherwise unchanged column
    // definition, the same way `AlignmentType.START` (used elsewhere in this file) resolves to the right
    // edge for RTL paragraphs without the author renumbering anything.
    visuallyRightToLeft: true,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "9CA3AF" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "9CA3AF" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "9CA3AF" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "9CA3AF" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" },
    },
    rows: [headerRow, ...rows],
  });
}

/**
 * Builds the report as a real `docx` Document object (OOXML — spec §32, ADR-004), authored RTL
 * throughout (spec §33). Packing it into actual bytes is the caller's job — see index.ts's
 * `packToBlob`/`packToBuffer` — so this same Document works whether it's about to be downloaded straight
 * from the browser or handed to a server-side LibreOffice conversion for the PDF path.
 */
export function buildInspectionReportDocument(data: InspectionReportData): Document {
  const dateLabel = new Date(data.inspectionDate).toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const coverChildren: Paragraph[] = [];

  if (data.logo) {
    coverChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: data.logo.bytes,
            type: imageTypeFromMime(data.logo.mimeType),
            transformation: { width: 140, height: 70 },
          }),
        ],
      })
    );
  }

  coverChildren.push(
    rtlParagraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [rtlRun(data.tourName, { bold: true, size: 32 })],
    }),
    rtlParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [rtlRun("דו״ח פיקוח עליון – מערכות מולטימדיה", { size: 24, color: "6B7280" })],
    })
  );

  const metaLines: [string, string][] = [
    ["פרויקט", data.projectName],
    ...(data.projectAddress ? ([["כתובת", data.projectAddress]] as [string, string][]) : []),
    ["מספר סיור", `#${data.inspectionNumber}`],
    ["תאריך", dateLabel],
    ["משתתפים", data.participants.length > 0 ? data.participants.join(", ") : "לא צוינו"],
    ["נערך על ידי", data.officeName],
  ];
  for (const [label, value] of metaLines) {
    coverChildren.push(
      rtlParagraph({
        alignment: AlignmentType.START,
        spacing: { after: 60 },
        children: [rtlRun(`${label}: `, { bold: true, size: 22 }), rtlRun(value, { size: 22 })],
      })
    );
  }

  const generalSection = [
    rtlParagraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.START,
      spacing: { before: 400, after: 150 },
      children: [rtlRun("כללי", { bold: true })],
    }),
    ...splitParagraphs(data.generalText || "לא הוזן תיאור כללי."),
  ];

  const tasksSection = [
    rtlParagraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.START,
      spacing: { before: 400, after: 150 },
      children: [rtlRun("משימות וליקויים", { bold: true })],
    }),
    data.tasks.length > 0
      ? buildTaskTable(data.tasks)
      : rtlParagraph({ alignment: AlignmentType.START, children: [rtlRun("לא נרשמו משימות בסיור זה.")] }),
  ];

  const summarySection = [
    rtlParagraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.START,
      spacing: { before: 400, after: 150 },
      children: [rtlRun("סיכום", { bold: true })],
    }),
    ...splitParagraphs(data.summaryText || "לא הוזן סיכום."),
    rtlParagraph({
      alignment: AlignmentType.START,
      spacing: { before: 300 },
      children: [
        rtlRun(
          "על כל בעל תפקיד למלא את המשימות המשויכות לו ולעדכן במייל חוזר על סיום הטיפול.",
          { italics: true, size: 20 }
        ),
      ],
    }),
  ];

  // Inspector's stamp (session's user request — "בנק חותמות של מפקחים"), at the very end of the report.
  // Prints correctly with just the name when no stamp has been embedded yet -- never fakes a stamp image
  // that doesn't exist.
  const signatureSection: Paragraph[] =
    data.inspectorName || data.inspectorStamp
      ? [
          rtlParagraph({ alignment: AlignmentType.START, spacing: { before: 500 } }), // spacer line
          ...(data.inspectorStamp
            ? [
                new Paragraph({
                  alignment: AlignmentType.START,
                  children: [
                    new ImageRun({
                      data: data.inspectorStamp.bytes,
                      type: imageTypeFromMime(data.inspectorStamp.mimeType),
                      transformation: { width: 130, height: 130 },
                    }),
                  ],
                }),
              ]
            : []),
          ...(data.inspectorName
            ? [
                rtlParagraph({
                  alignment: AlignmentType.START,
                  spacing: { before: 60 },
                  children: [rtlRun(data.inspectorName, { bold: true, size: 20 })],
                }),
              ]
            : []),
        ]
      : [];

  return new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [rtlParagraph({ alignment: AlignmentType.END, children: [rtlRun(data.officeName, { size: 16, color: "9CA3AF" })] })],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              rtlParagraph({
                alignment: AlignmentType.CENTER,
                children: [rtlRun(`${data.projectName} — סיור #${data.inspectionNumber}`, { size: 16, color: "9CA3AF" })],
              }),
            ],
          }),
        },
        children: [...coverChildren, ...generalSection, ...tasksSection, ...summarySection, ...signatureSection],
      },
    ],
  });
}

function splitParagraphs(text: string): Paragraph[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [rtlParagraph({ alignment: AlignmentType.START, children: [rtlRun("")] })];
  }
  return lines.map((line) => rtlParagraph({ alignment: AlignmentType.START, spacing: { after: 100 }, children: [rtlRun(line)] }));
}
