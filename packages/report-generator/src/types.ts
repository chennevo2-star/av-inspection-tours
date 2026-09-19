/**
 * Everything the DOCX builder needs, already resolved to plain data (names instead of ids, photo bytes
 * already read out of storage) — see REPORTING.md for the structure this maps to (spec §36). The
 * assembling side (apps/web's report screen, reading from IndexedDB) is what turns raw entities into
 * this shape; this package only knows how to lay it out as a real OOXML document.
 */
export interface ReportPhoto {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ReportTaskRow {
  id: string;
  friendlyNumber: number | null;
  floorName: string | null;
  roomName: string | null;
  description: string;
  responsibleParty: string | null;
  status: string;
  photos: ReportPhoto[];
}

export interface InspectionReportData {
  officeName: string;
  logo: ReportPhoto | null;
  /** The tour's full display name, already formatted (e.g. `טופס פיקוח עליון "מולטימדיה" פרויקט א׳
   * 01/02/2026`) -- computed once by the assembling side (apps/web's format-tour-name.ts) so this
   * package never needs to know the category-list/quoting rules itself, only how to print a string. */
  tourName: string;
  /** The cover page's subtitle line, directly under `tourName` -- this is where the tour's category/ies
   * actually show up (the big title itself deliberately doesn't carry them, see apps/web's
   * formatReportTitle/formatReportSubtitle for why and how this is built). Already fully formatted
   * plain text, same as `tourName` -- this package only knows how to print a string. */
  reportSubtitle: string;
  projectName: string;
  projectAddress: string | null;
  inspectionNumber: number;
  inspectionDate: string; // ISO date (YYYY-MM-DD)
  participants: string[];
  generalText: string;
  tasks: ReportTaskRow[]; // already in the order the user wants them printed
  summaryText: string;
  /** The inspector's name as printed under the stamp -- separate from `inspectorStamp` so the closing
   * page still reads correctly (name only) when no stamp image has been embedded yet. */
  inspectorName: string | null;
  /** The inspector's embedded stamp image (session's user request), printed at the very end of the
   * report. Null when the tour's inspector wasn't picked from the bank, or has no stamp uploaded yet —
   * the closing section still prints correctly without one, never faked. */
  inspectorStamp: ReportPhoto | null;
}
