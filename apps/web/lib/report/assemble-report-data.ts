import type { InspectionReportData, ReportPhoto, ReportTaskRow } from "@av-inspection/report-generator";
import { getLocalDb } from "../db/local-db";
import { listTasksForInspection } from "../db/tasks";
import { getPhotoBlob } from "../db/photos";
import { getInspector, getInspectorStampBlob } from "../db/inspectors";
import { formatTourName } from "../format-tour-name";
import { LOGO_LSHACHAR_PNG_BASE64 } from "./logo-data";

/** Fixed business fact, not per-project data — spec names this specific office. */
const OFFICE_NAME = "ל.שחר";

/**
 * The office logo (spec: "must include the ל.שחר logo"), embedded as a base64 constant (logo-data.ts)
 * rather than fetched over the network at report-generation time -- a real bug found here (user report,
 * 2026-09-19): a genuinely generated report showed no logo despite the file existing and being
 * independently confirmed fetchable, most likely a transient network condition on a real mobile device at
 * the exact moment this ran, silently swallowed by the old fetch()'s own try/catch (by design -- an absent
 * logo must never fail report generation). Embedding removes the network dependency entirely, matching how
 * this app's report fonts are already embedded (packages/report-generator/src/hebrew-font-data.ts) for the
 * identical reason, and fits the offline-first mandate better than a network fetch ever did.
 */
function loadLogo(): ReportPhoto {
  const binary = atob(LOGO_LSHACHAR_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: "image/png" };
}

// Every report photo displays at a small fixed size regardless of format (build-docx.ts's own
// transformation widths top out at 130pt; build-pdf.ts's PHOTO_BOX is 55pt) -- a full camera-resolution
// photo (often several MB, 3000px+) carries no visible benefit there, only cost. That cost turned into a
// real production bug (user report, 2026-09-19): PDF generation runs server-side on Cloudflare Workers
// (unlike DOCX, which builds entirely client-side, see report-screen.tsx), and decoding/re-embedding
// several full-resolution JPEGs there was enough to exceed the Worker's CPU/memory limits and fail with a
// real HTTP 503 -- a genuinely reported failure with real inspection photos, not a synthetic one. Confirmed
// via apps/web/lib/db/photos.ts's own doc comment: no client-side compression exists yet at capture time.
const MAX_REPORT_PHOTO_DIMENSION = 1200;
const REPORT_PHOTO_JPEG_QUALITY = 0.8;

/** Downscales a photo before it ever reaches a report (see the comment above) -- always converts to JPEG
 * (report photos don't need lossless fidelity or PNG transparency at this size), and falls back to the
 * original blob untouched if resizing fails for any reason (an unsupported API, a decode error, ...) --
 * this must never be the reason a report fails to generate, only ever a size optimization. */
async function resizePhotoForReport(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, MAX_REPORT_PHOTO_DIMENSION / Math.max(bitmap.width, bitmap.height));
      if (scale === 1) return blob; // already small enough -- skip a pointless re-encode
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/jpeg", quality: REPORT_PHOTO_JPEG_QUALITY });
    } finally {
      bitmap.close();
    }
  } catch {
    return blob;
  }
}

async function blobToReportPhoto(blob: Blob): Promise<ReportPhoto> {
  const resized = await resizePhotoForReport(blob);
  const bytes = new Uint8Array(await resized.arrayBuffer());
  return { bytes, mimeType: resized.type || "image/jpeg" };
}

/**
 * The tour's inspector's stamp, if they were picked from the bank AND have one uploaded (session's user
 * request). Both are optional — an ad-hoc/free-text inspector name, or a bank inspector with no stamp
 * yet, both correctly fall through to `{ name, stamp: null }` rather than failing the whole report.
 */
async function loadInspectorSignature(
  inspectorId: string | null,
  fallbackName: string
): Promise<{ name: string | null; stamp: ReportPhoto | null }> {
  if (!inspectorId) return { name: fallbackName || null, stamp: null };
  const inspector = await getInspector(inspectorId);
  if (!inspector) return { name: fallbackName || null, stamp: null }; // e.g. later deleted from the bank
  if (!inspector.stampLocalFileId) return { name: inspector.name, stamp: null };
  const blob = await getInspectorStampBlob(inspector.stampLocalFileId);
  return { name: inspector.name, stamp: blob ? await blobToReportPhoto(blob) : null };
}

/**
 * Reads everything a report needs straight out of the local, offline-first IndexedDB (Inspection,
 * Project, Task, Floor, Room, Photo + blob bytes) and resolves it into the plain, already-denormalized
 * shape packages/report-generator expects. Runs entirely client-side — never depends on the sync
 * having completed, matching the app's offline-first mandate: a report can be produced the moment a
 * tour ends, with zero network dependency.
 */
export async function assembleReportData(inspectionId: string): Promise<InspectionReportData> {
  const db = getLocalDb();

  const inspection = await db.inspections.get(inspectionId);
  if (!inspection) throw new Error(`assembleReportData: inspection ${inspectionId} not found locally`);

  const project = await db.projects.get(inspection.projectId);
  if (!project) throw new Error(`assembleReportData: project ${inspection.projectId} not found locally`);

  const [tasks, floors, rooms, logo, signature] = await Promise.all([
    listTasksForInspection(inspectionId),
    db.floors.where("projectId").equals(project.id).toArray(),
    db.rooms.toArray(), // filtered down to the relevant ones via the floorId map below
    loadLogo(),
    loadInspectorSignature(inspection.inspectorId, inspection.inspector),
  ]);

  const floorById = new Map(floors.map((f) => [f.id, f]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // Report order (distinct from the tasks table's "most recent first"): grouped by floor in the
  // project's own floor order, then by the task's own friendly number within a floor — the spec's
  // "clear task table BY FLOORS", not a raw activity log. Tasks with no floor sort last.
  const sortedTasks = [...tasks].sort((a, b) => {
    const orderA = a.floorId ? (floorById.get(a.floorId)?.sortOrder ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const orderB = b.floorId ? (floorById.get(b.floorId)?.sortOrder ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.friendlyNumber ?? 0) - (b.friendlyNumber ?? 0);
  });

  const taskRows: ReportTaskRow[] = await Promise.all(
    sortedTasks.map(async (task): Promise<ReportTaskRow> => {
      const photos = await db.photos.where("taskId").equals(task.id).toArray();
      const resolvedPhotos = await Promise.all(
        photos.map(async (photo) => {
          const blob = await getPhotoBlob(photo.localFileId);
          return blob ? blobToReportPhoto(blob) : null;
        })
      );

      return {
        id: task.id,
        friendlyNumber: task.friendlyNumber,
        floorName: task.floorId ? (floorById.get(task.floorId)?.name ?? null) : null,
        roomName: task.roomId ? (roomById.get(task.roomId)?.name ?? null) : null,
        description: task.description,
        // Task.responsibleParties is an array (multiple contractors can share one task); the report
        // contract itself stays a single printable string -- joins here, at the presentation boundary,
        // so build-pdf.ts/build-docx.ts/build-xlsx.ts don't need to know about the underlying array.
        // Newline-joined (user request, 2026-09-19: each contractor gets its own line in the table cell),
        // not comma-joined -- both renderers already wrap on "\n" as a paragraph break within one cell.
        responsibleParty: task.responsibleParties.length > 0 ? task.responsibleParties.join("\n") : null,
        status: task.status,
        photos: resolvedPhotos.filter((p): p is ReportPhoto => p !== null),
      };
    })
  );

  return {
    officeName: OFFICE_NAME,
    logo,
    tourName: formatTourName(inspection.date, project.name, inspection.categories),
    projectName: project.name,
    projectAddress: project.address,
    inspectionNumber: inspection.inspectionNumber,
    inspectionDate: inspection.date,
    participants: inspection.participants,
    generalText: inspection.generalText ?? "",
    tasks: taskRows,
    summaryText: inspection.summaryText ?? "",
    inspectorName: signature.name,
    inspectorStamp: signature.stamp,
  };
}
