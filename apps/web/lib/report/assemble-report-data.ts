import type { InspectionReportData, ReportPhoto, ReportTaskRow } from "@av-inspection/report-generator";
import { getLocalDb } from "../db/local-db";
import { listTasksForInspection } from "../db/tasks";
import { getPhotoBlob } from "../db/photos";
import { getInspector, getInspectorStampBlob } from "../db/inspectors";
import { formatTourName } from "../format-tour-name";

/** Fixed business fact, not per-project data — spec names this specific office. */
const OFFICE_NAME = "ל.שחר";

/**
 * Static asset path for the office logo (spec: "must include the ל.שחר logo"). The real file lives at
 * apps/web/public/logo-lshachar.png. If it's ever missing (a fresh checkout without that asset, or the
 * file gets moved/renamed), this fetch 404s and `logo` comes back `null` -- the report still generates
 * correctly without one (build-docx.ts's/build-pdf.ts's cover pages just omit the image), per the
 * no-mock-success rule: an absent logo is shown honestly as absent, never faked.
 */
const LOGO_PATH = "/logo-lshachar.png";

async function loadLogo(): Promise<ReportPhoto | null> {
  try {
    const res = await fetch(LOGO_PATH);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    return { bytes, mimeType: res.headers.get("content-type") || "image/png" };
  } catch {
    return null;
  }
}

async function blobToReportPhoto(blob: Blob): Promise<ReportPhoto> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, mimeType: blob.type || "image/jpeg" };
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
        responsibleParty: task.responsibleParty,
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
