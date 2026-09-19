import type { InspectionReportData, ReportPhoto, ReportTaskRow } from "./types.js";

/**
 * `JSON.stringify` on a `Uint8Array` serializes it as a plain `{"0":137,"1":80,...}` object — the
 * `length` property does NOT survive the round trip, so `new Uint8Array(parsedObject)` on the receiving
 * end silently reconstructs a ZERO-BYTE array instead of throwing or preserving anything. This was a
 * real, fully silent production bug (found 2026-09-19): every `ReportPhoto` inside `InspectionReportData`
 * (the office logo, the inspector's stamp, every task photo) that crosses `report-screen.tsx`'s
 * `JSON.stringify(data)` on its way to `/api/report/docx-to-pdf` or `/api/report/xlsx` arrived
 * server-side with empty `bytes`, so `doc.embedPng`/`embedJpg` (build-pdf.ts) threw on the invalid
 * buffer — caught by `tryEmbedImage`'s own try/catch (correct behavior for a genuinely corrupt photo,
 * just not for this case) and silently turned into `null`. No image ever printed, in either the PDF or
 * XLSX export, and nothing surfaced an error — this is the real root cause behind the logo and task
 * photos both being reported missing/unclear across many rounds, not a network or rendering bug.
 *
 * Fix: never let a raw `ReportPhoto` cross `JSON.stringify`/`parse`. `serializeReportDataForWire`
 * base64-encodes every `bytes` field before the client's `JSON.stringify`; `deserializeReportDataFromWire`
 * reverses it server-side, before the bytes ever reach a PDF/XLSX/DOCX builder. `btoa`/`atob` (not
 * Node's `Buffer`) are used because this same code runs in the browser, the Next.js dev server, AND the
 * Cloudflare Workers edge runtime — all three have `btoa`/`atob` as real globals, only the browser has no
 * `Buffer`.
 */

export interface WirePhoto {
  bytes: string; // base64
  mimeType: string;
}

export type WireTaskRow = Omit<ReportTaskRow, "photos"> & { photos: WirePhoto[] };

export type WireInspectionReportData = Omit<InspectionReportData, "logo" | "inspectorStamp" | "tasks"> & {
  logo: WirePhoto | null;
  inspectorStamp: WirePhoto | null;
  tasks: WireTaskRow[];
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192; // avoids blowing the call stack on String.fromCharCode.apply for large photos
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function photoToWire(photo: ReportPhoto): WirePhoto {
  return { bytes: bytesToBase64(photo.bytes), mimeType: photo.mimeType };
}

function photoFromWire(photo: WirePhoto): ReportPhoto {
  return { bytes: base64ToBytes(photo.bytes), mimeType: photo.mimeType };
}

/** Client-side: call on the real `InspectionReportData` right before `JSON.stringify`. */
export function serializeReportDataForWire(data: InspectionReportData): WireInspectionReportData {
  return {
    ...data,
    logo: data.logo ? photoToWire(data.logo) : null,
    inspectorStamp: data.inspectorStamp ? photoToWire(data.inspectorStamp) : null,
    tasks: data.tasks.map((task) => ({ ...task, photos: task.photos.map(photoToWire) })),
  };
}

/** Server-side: call on the parsed JSON body before handing it to any builder. */
export function deserializeReportDataFromWire(data: WireInspectionReportData): InspectionReportData {
  return {
    ...data,
    logo: data.logo ? photoFromWire(data.logo) : null,
    inspectorStamp: data.inspectorStamp ? photoFromWire(data.inspectorStamp) : null,
    tasks: data.tasks.map((task) => ({ ...task, photos: task.photos.map(photoFromWire) })),
  };
}
