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
  projectName: string;
  projectAddress: string | null;
  inspectionNumber: number;
  inspectionDate: string; // ISO date (YYYY-MM-DD)
  participants: string[];
  generalText: string;
  tasks: ReportTaskRow[]; // already in the order the user wants them printed
  summaryText: string;
}
