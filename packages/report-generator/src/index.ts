import { Packer, type Document } from "docx";

export type { InspectionReportData, ReportPhoto, ReportTaskRow } from "./types.js";
export { buildInspectionReportDocument } from "./build-docx.js";

/** Node-side packing (server API routes — e.g. handing bytes to LibreOffice for DOCX→PDF). */
export async function packToBuffer(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc);
}

/** Browser-side packing — lets the client download a DOCX with no server round-trip at all. */
export async function packToBlob(doc: Document): Promise<Blob> {
  return Packer.toBlob(doc);
}
