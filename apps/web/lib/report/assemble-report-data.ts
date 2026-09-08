import type { InspectionReportData, ReportPhoto, ReportTaskRow } from "@av-inspection/report-generator";
import { getLocalDb } from "../db/local-db";
import { listTasksForInspection } from "../db/tasks";
import { getPhotoBlob } from "../db/photos";

/** Fixed business fact, not per-project data — spec names this specific office. */
const OFFICE_NAME = "ל.שחר";

/**
 * Static asset path for the office logo (spec: "must include the ל.שחר logo"). No real logo file has
 * been supplied yet as of this build, so this fetch will 404 and `logo` will come back `null` — the
 * report still generates correctly without one (build-docx.ts's cover page just omits the image), per
 * the no-mock-success rule: an absent logo is shown honestly as absent, never faked. Once the real
 * file is supplied, drop it at apps/web/public/logo-lshachar.png (or .jpg — see mimeType guess below)
 * and no other code changes are needed.
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

  const [tasks, floors, rooms, logo] = await Promise.all([
    listTasksForInspection(inspectionId),
    db.floors.where("projectId").equals(project.id).toArray(),
    db.rooms.toArray(), // filtered down to the relevant ones via the floorId map below
    loadLogo(),
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
    projectName: project.name,
    projectAddress: project.address,
    inspectionNumber: inspection.inspectionNumber,
    inspectionDate: inspection.date,
    participants: inspection.participants,
    generalText: "",
    tasks: taskRows,
    summaryText: "",
  };
}
