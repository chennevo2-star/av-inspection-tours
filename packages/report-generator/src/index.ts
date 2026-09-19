import { Packer, type Document } from "docx";
import type { PDFDocument } from "@cantoo/pdf-lib";
import type { WorkBook } from "xlsx";
import { write as writeXlsx } from "xlsx";

export type { InspectionReportData, ReportPhoto, ReportTaskRow } from "./types.js";
export { buildInspectionReportDocument } from "./build-docx.js";
export { buildInspectionReportPdf } from "./build-pdf.js";
export { buildInspectionReportXlsx } from "./build-xlsx.js";
export type { WireInspectionReportData, WirePhoto, WireTaskRow } from "./wire-format.js";
export { serializeReportDataForWire, deserializeReportDataFromWire } from "./wire-format.js";

/**
 * A plain `Uint8Array`'s `.buffer` is typed as `ArrayBuffer | SharedArrayBuffer` (it's a *view*, which
 * could in principle wrap either) -- but DOM's `Blob` constructor only accepts a concrete `ArrayBuffer`.
 * Copying into a freshly-allocated one sidesteps that union entirely (a `new ArrayBuffer(n)` is always
 * concretely an `ArrayBuffer`), which is what `packPdfToBlob`/`packXlsxToBlob` below both need.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

/** Node-side packing (server API routes — e.g. handing bytes to LibreOffice for DOCX→PDF). */
export async function packToBuffer(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc);
}

/** Browser-side packing — lets the client download a DOCX with no server round-trip at all. */
export async function packToBlob(doc: Document): Promise<Blob> {
  return Packer.toBlob(doc);
}

/**
 * Packing for the pure-JS PDF renderer (build-pdf.ts), mirroring the DOCX build-vs-pack split above
 * exactly: `buildInspectionReportPdf` hands back an unpacked `PDFDocument`, and packing to bytes is a
 * separate step here, usable from either a server route (`packPdfToBuffer`) or the browser
 * (`packPdfToBlob`), same as `packToBuffer`/`packToBlob` do for DOCX.
 */
export async function packPdfToBuffer(doc: PDFDocument): Promise<Buffer> {
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export async function packPdfToBlob(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save();
  return new Blob([toArrayBuffer(bytes)], { type: "application/pdf" });
}

/** Node-side packing for the XLSX workbook (build-xlsx.ts) — parallels packToBuffer/packPdfToBuffer. */
export function packXlsxToBuffer(workbook: WorkBook): Buffer {
  return writeXlsx(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Browser-side packing for the XLSX workbook — parallels packToBlob/packPdfToBlob for API completeness.
 * Not exercised by this task's own tests or the new `apps/web/app/api/report/xlsx/route.ts` (both use
 * the Node-side `packXlsxToBuffer` above) since wiring an actual client-side XLSX download button was
 * out of this change's scope — see the final report.
 */
export function packXlsxToBlob(workbook: WorkBook): Blob {
  const bytes = writeXlsx(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
  return new Blob([toArrayBuffer(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
