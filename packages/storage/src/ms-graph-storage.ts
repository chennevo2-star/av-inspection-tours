import type {
  Contractor,
  Floor,
  Inspection,
  Note,
  Project,
  Room,
  Task as InspectionTask,
} from "@av-inspection/shared-types";
import { GraphAuth } from "./graph-auth.js";
import { sanitizeFilename } from "./sanitize-filename.js";
import type { ObjectStorage } from "./types.js";

/**
 * Permanent storage backend (spec's M365 upgrade -- see ARCHITECTURE.md/§18 update): every permanent file
 * (photo, audio, report, attachment) and the project/visit JSON manifests below live in a SharePoint
 * Document Library, reached through Microsoft Graph. `S3Storage`/`LocalFsStorage` remain the dev/fallback
 * paths (ADR-007); this is now the intended path for anything that must actually survive and be visible to
 * the company outside this app (spec explicitly asked for SharePoint over OneDrive for that reason -- a
 * SharePoint site's document library is shared/company-owned, not tied to one person's personal OneDrive).
 *
 * Implements the plain `ObjectStorage` interface (put/get/getSignedGetUrl/delete) so existing callers keep
 * working unchanged, *plus* extra public methods below for the real deliverable: creating/reusing the
 * project and visit folder structure, and writing/reading the `ProjectInfo.json`/`Visit.json` manifests --
 * deliberately on this same class rather than a second storage abstraction, since all of it shares one
 * authenticated Graph client and one resolved drive.
 *
 * `getSignedGetUrl()` choice: this returns the drive item's own `webUrl` (a normal
 * `https://<tenant>.sharepoint.com/...` link), not a short-lived anonymous Graph download URL
 * (`@microsoft.graph.downloadUrl`). Rationale: this app's files are meant to stay inside the company's
 * M365 permission model -- `webUrl` requires the viewer's own M365 sign-in and is subject to the site's
 * real SharePoint permissions, while `@microsoft.graph.downloadUrl` is a pre-authenticated anonymous CDN
 * link that works for *anyone* who has it, for a short window, with no further auth check. The latter
 * would be the better choice only if this were serving untrusted/public consumers or a native player that
 * can't carry a session cookie; that's not this product's model, so `webUrl` is the safer default and
 * needs no extra Graph round-trip to obtain -- it comes back as an ordinary field on the very same
 * driveItem response every lookup/upload here already makes.
 */

// Graph's simple upload endpoint (`PUT .../content`) is documented to work up to 4 MiB; above that Graph
// itself will reject or truncate, so anything larger MUST go through the resumable upload-session API.
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

// Graph requires every non-final resumable-upload chunk's size to be a multiple of 320 KiB (327,680
// bytes) -- an arbitrary chunk size will make Graph reject the request outright. 10x that (~3.2 MiB) is a
// reasonable balance for audio/report files: few enough round-trips to not be slow, small enough that one
// retried chunk after a drop is cheap.
const UPLOAD_CHUNK_SIZE_BYTES = 327_680 * 10;

// Name of the small marker file stamped into a freshly-created visit-date folder, before anything else is
// written into it -- see `ensureVisitFolder`'s own comment for exactly why this exists and its known
// (narrow) race window.
const VISIT_OWNER_MARKER_FILENAME = "_visit_owner.json";

const PROJECTS_SEGMENT = "פרויקטים";
const VISITS_SEGMENT = "סיורים";
const REPORTS_SEGMENT = "דוחות";
const DOCS_SEGMENT = "מסמכים";
const PROJECT_DATA_SEGMENT = "נתוני פרויקט";
const VISIT_PHOTOS_SEGMENT = "תמונות";
const VISIT_AUDIO_SEGMENT = "הקלטות";
const VISIT_ATTACHMENTS_SEGMENT = "קבצים מצורפים";

export interface MsGraphStorageConfig {
  auth: GraphAuth;
  /** Resolved SharePoint site id (`{siteCollectionId},{webId}` form from Graph). Preferred when already
   * known -- skips a lookup call on every cold start. */
  siteId?: string;
  /** Alternative to `siteId`: resolve by hostname + server-relative path (e.g. "contoso.sharepoint.com" +
   * "/sites/AVInspectionTours"), matching how most admins actually have the URL in hand. Ignored if
   * `siteId` is set. */
  siteHostname?: string;
  sitePath?: string;
  /** Document library display name, e.g. "Documents" -- a site can have more than one drive, so this
   * disambiguates which one. */
  driveName: string;
  /** Configurable base folder name inside that drive (spec requirement -- not hardcoded), e.g.
   * "סיורי פיקוח". */
  rootFolder: string;
  /** Overridable for tests; defaults to the real Graph v1.0 endpoint. */
  graphBaseUrl?: string;
  /** Overridable for tests; defaults to `UPLOAD_CHUNK_SIZE_BYTES`. */
  chunkSizeBytes?: number;
}

/** A Microsoft Graph driveItem, trimmed to the fields this file actually reads. */
interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  folder?: Record<string, unknown>;
  file?: Record<string, unknown>;
  parentReference?: { driveId?: string };
}

interface GraphDriveItemList {
  value: GraphDriveItem[];
}

interface GraphSite {
  id: string;
}

/** The durable reference returned after any upload -- per spec, never rely on filename/path alone (a
 * rename in SharePoint must not break the link back to this record). `key` is this same file's address
 * relative to `rootFolder` -- i.e. exactly what `get()`/`getSignedGetUrl()`/`delete()` (the plain
 * `ObjectStorage` interface) expect as their own `key` argument. Wiring this into the real sync pipeline
 * (apps/web/lib/server/file-sync-entities.ts) stores THIS in a Photo/AudioChunk/Attachment row's
 * `cloudFileId` column -- not `itemId` and not the full drive-root-relative path -- specifically so every
 * existing `storage.get(cloudFileId)` call site (e.g. packages/ai-pipeline/src/orchestrator.ts, which
 * predates this whole Graph integration and must keep working unmodified) continues to resolve correctly
 * across all three storage backends without knowing which one is active. */
export interface GraphUploadResult {
  driveId: string;
  itemId: string;
  webUrl: string;
  name: string;
  size: number;
  key: string;
}

/** A slimmer version of `GraphUploadResult` for embedding in `Visit.json`'s reference arrays. */
export type GraphFileReference = GraphUploadResult;

export interface ProjectFolderSet {
  /** Path relative to the drive root, e.g. "סיורי פיקוח/פרויקטים/מלון דן תל אביב". */
  projectPath: string;
  root: GraphUploadResultLike;
  dataFolder: GraphUploadResultLike;
  visitsFolder: GraphUploadResultLike;
  reportsFolder: GraphUploadResultLike;
  docsFolder: GraphUploadResultLike;
}

export interface VisitFolderSet {
  /** Path relative to the drive root, e.g. "...סיורים/2026-09-18_01". */
  visitPath: string;
  root: GraphUploadResultLike;
  photos: GraphUploadResultLike;
  audio: GraphUploadResultLike;
  attachments: GraphUploadResultLike;
  reports: GraphUploadResultLike;
}

/** Folder items don't have a meaningful `size`/content, but callers benefit from the same driveId/itemId/
 * webUrl shape as an uploaded file (e.g. to store `oneDriveFolderId` in ProjectInfo.json). `path` (added
 * when wiring this into the real upload pipeline, apps/web/lib/server/file-sync-entities.ts) is the
 * folder's path relative to the drive root, exactly what `uploadFile(folderPath, ...)` expects as its
 * first argument -- without this, a caller holding e.g. a `VisitFolderSet.photos` result has no way to
 * actually upload INTO that folder except by re-deriving the path itself from private segment constants
 * (VISIT_PHOTOS_SEGMENT etc.), which aren't exported on purpose (they're an internal naming convention,
 * not a public contract). */
export interface GraphUploadResultLike {
  driveId: string;
  itemId: string;
  webUrl: string;
  name: string;
  path: string;
}

export interface ProjectInfoJson {
  projectId: string;
  projectName: string;
  client: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  oneDriveDriveId: string;
  oneDriveFolderId: string;
  /** SharePoint link to the project's own root folder -- lets a human jump straight to it from the JSON
   * alone, without re-deriving a path. */
  webUrl: string;
  folderPath: string;
}

export interface VisitJson {
  visitId: string;
  projectId: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  participants: string[];
  contractors: Contractor[];
  floors: Floor[];
  rooms: Room[];
  tasks: InspectionTask[];
  notes: Note[];
  photoReferences: GraphFileReference[];
  audioReferences: GraphFileReference[];
  attachmentReferences: GraphFileReference[];
  reportReferences: GraphFileReference[];
}

function toResultLike(item: GraphDriveItem, fallbackDriveId: string, path: string): GraphUploadResultLike {
  return {
    driveId: item.parentReference?.driveId ?? fallbackDriveId,
    itemId: item.id,
    webUrl: item.webUrl,
    name: item.name,
    path,
  };
}

/** Splits a flat `ObjectStorage` key ("photos/abc123.jpg") into its folder portion ("photos", "" if
 * top-level) and filename portion ("abc123.jpg"). */
function splitKey(key: string): { folder: string; filename: string } {
  const lastSlash = key.lastIndexOf("/");
  if (lastSlash === -1) return { folder: "", filename: key };
  return { folder: key.slice(0, lastSlash), filename: key.slice(lastSlash + 1) };
}

/** Node's real `fetch` (undici) accepts a `Buffer` as a request body fine at runtime (it's a `Uint8Array`
 * under the hood) -- this cast exists purely because lib.dom.d.ts's `BodyInit` type, combined with
 * @types/node's generic `Buffer<TArrayBuffer>`, doesn't structurally match without help. Centralized here
 * so the reason is explained once rather than re-justified at every call site. */
function bufferBody(buf: Buffer): BodyInit {
  return buf as unknown as BodyInit;
}

export class MsGraphStorage implements ObjectStorage {
  private readonly baseUrl: string;
  private readonly chunkSizeBytes: number;
  private driveId: string | null = null;
  /** De-dupes concurrent drive-resolution calls the same way GraphAuth de-dupes token refreshes. */
  private driveIdResolution: Promise<string> | null = null;

  constructor(private readonly config: MsGraphStorageConfig) {
    this.baseUrl = config.graphBaseUrl ?? "https://graph.microsoft.com/v1.0";
    this.chunkSizeBytes = config.chunkSizeBytes ?? UPLOAD_CHUNK_SIZE_BYTES;
  }

  /* ----------------------------------------------------------------------------------------------
   * Low-level Graph HTTP helpers
   * -------------------------------------------------------------------------------------------- */

  private async rawFetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.config.auth.getAccessToken();
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }

  private async graphError(response: Response): Promise<Error> {
    const text = await response.text().catch(() => "");
    return new Error(`Microsoft Graph request failed: ${response.status} ${response.statusText} -- ${text}`);
  }

  private async graphJson<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const response = await this.rawFetch(pathOrUrl, init);
    if (!response.ok) throw await this.graphError(response);
    return (await response.json()) as T;
  }

  /** Graph's path-addressing (`/root:/{path}:/...`) needs the path itself percent-encoded, but the "/"
   * separators between segments must stay literal -- encoding each segment individually (not the whole
   * string at once) is what keeps that correct for Hebrew/space-containing folder and file names. */
  private encodePath(relativePath: string): string {
    return relativePath
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(encodeURIComponent)
      .join("/");
  }

  /* ----------------------------------------------------------------------------------------------
   * Site / drive resolution (once per process, then cached)
   * -------------------------------------------------------------------------------------------- */

  private async resolveSiteId(): Promise<string> {
    if (this.config.siteId) return this.config.siteId;
    if (this.config.siteHostname && this.config.sitePath) {
      const path = this.config.sitePath.startsWith("/") ? this.config.sitePath : `/${this.config.sitePath}`;
      const site = await this.graphJson<GraphSite>(`/sites/${this.config.siteHostname}:${path}`);
      return site.id;
    }
    throw new Error(
      "MsGraphStorage requires either MS_GRAPH_SITE_ID or both MS_GRAPH_SITE_HOSTNAME and MS_GRAPH_SITE_PATH"
    );
  }

  private async resolveDriveId(): Promise<string> {
    if (this.driveId) return this.driveId;
    if (!this.driveIdResolution) {
      this.driveIdResolution = (async () => {
        const siteId = await this.resolveSiteId();
        const drives = await this.graphJson<GraphDriveItemList>(`/sites/${siteId}/drives`);
        const match = drives.value.find((d) => d.name === this.config.driveName);
        if (!match) {
          const available = drives.value.map((d) => d.name).join(", ");
          throw new Error(
            `No document library named "${this.config.driveName}" on this site (found: ${available || "none"})`
          );
        }
        this.driveId = match.id;
        return match.id;
      })();
    }
    try {
      return await this.driveIdResolution;
    } finally {
      this.driveIdResolution = null;
    }
  }

  /* ----------------------------------------------------------------------------------------------
   * Folder creation (idempotent -- lookup-first, never blindly POST a create)
   * -------------------------------------------------------------------------------------------- */

  /** Looks up an item (file or folder) by its path relative to the drive root. Returns null on a real
   * 404 (does not exist); throws on any other failure. `relativePath === ""` addresses the drive root
   * itself. */
  private async tryGetItemByPath(driveId: string, relativePath: string): Promise<GraphDriveItem | null> {
    const url = relativePath
      ? `/drives/${driveId}/root:/${this.encodePath(relativePath)}`
      : `/drives/${driveId}/root`;
    const response = await this.rawFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw await this.graphError(response);
    return (await response.json()) as GraphDriveItem;
  }

  /** POSTs a real create for a folder already confirmed (by the caller) not to exist yet -- no lookup of
   * its own. Split out from `ensureFolder` below so a caller that already did its own existence check
   * (`ensureVisitFolder`'s suffix loop) doesn't pay for a second, redundant lookup. `relativePath`'s
   * parent is assumed to already exist. */
  private async createFolder(relativePath: string): Promise<GraphDriveItem> {
    const driveId = await this.resolveDriveId();
    const lastSlash = relativePath.lastIndexOf("/");
    const parentPath = lastSlash === -1 ? "" : relativePath.slice(0, lastSlash);
    const folderName = lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1);

    // Graph supports addressing a path-resolved item's own children collection directly
    // (`root:/{parentPath}:/children`), so creating a folder never requires first fetching the parent's
    // raw item id -- one request either way.
    const childrenUrl = parentPath
      ? `/drives/${driveId}/root:/${this.encodePath(parentPath)}:/children`
      : `/drives/${driveId}/root/children`;

    return this.graphJson<GraphDriveItem>(childrenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        // "fail" (not "replace"/"rename"): if a real race means someone else created this exact folder
        // between our lookup and this POST, we want a loud error, not silent divergence from what we
        // just looked up.
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
  }

  /** Ensures exactly one folder exists at `relativePath`, whose *parent* is assumed to already exist
   * (callers walk a path root-to-leaf via `ensureFolderPath` so this always holds). Looks up first and
   * only creates on a real miss -- this is what makes calling it twice safe (no duplicate folder, no
   * error), which is the idempotency the spec asks for. */
  private async ensureFolder(relativePath: string): Promise<GraphDriveItem> {
    const driveId = await this.resolveDriveId();
    const existing = await this.tryGetItemByPath(driveId, relativePath);
    if (existing) return existing;
    return this.createFolder(relativePath);
  }

  /** Ensures every ancestor of `fullPath` exists, root-to-leaf, creating only the segments that are
   * actually missing. Safe to call repeatedly. */
  private async ensureFolderPath(fullPath: string): Promise<GraphDriveItem> {
    const segments = fullPath.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) throw new Error("ensureFolderPath called with an empty path");
    let current = "";
    let item: GraphDriveItem | null = null;
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      item = await this.ensureFolder(current);
    }
    // Non-null by construction (segments.length > 0 guarantees at least one loop iteration).
    return item as GraphDriveItem;
  }

  /* ----------------------------------------------------------------------------------------------
   * Project / visit folder structure
   * -------------------------------------------------------------------------------------------- */

  private projectRootPath(projectName: string): string {
    return `${this.config.rootFolder}/${PROJECTS_SEGMENT}/${sanitizeFilename(projectName)}`;
  }

  /**
   * Ensures the root folder, `פרויקטים/<project name>`, and its four fixed subfolders
   * (`נתוני פרויקט/`, `סיורים/`, `דוחות/`, `מסמכים/`) all exist. Idempotent: calling this twice for the
   * same project name does not error or create duplicates, because every step is lookup-first
   * (`ensureFolder`/`ensureFolderPath` above).
   */
  async ensureProjectFolders(project: Pick<Project, "name">): Promise<ProjectFolderSet> {
    const driveId = await this.resolveDriveId();
    const projectPath = this.projectRootPath(project.name);
    const root = await this.ensureFolderPath(projectPath);
    const dataFolder = await this.ensureFolder(`${projectPath}/${PROJECT_DATA_SEGMENT}`);
    const visitsFolder = await this.ensureFolder(`${projectPath}/${VISITS_SEGMENT}`);
    const reportsFolder = await this.ensureFolder(`${projectPath}/${REPORTS_SEGMENT}`);
    const docsFolder = await this.ensureFolder(`${projectPath}/${DOCS_SEGMENT}`);
    return {
      projectPath,
      root: toResultLike(root, driveId, projectPath),
      dataFolder: toResultLike(dataFolder, driveId, `${projectPath}/${PROJECT_DATA_SEGMENT}`),
      visitsFolder: toResultLike(visitsFolder, driveId, `${projectPath}/${VISITS_SEGMENT}`),
      reportsFolder: toResultLike(reportsFolder, driveId, `${projectPath}/${REPORTS_SEGMENT}`),
      docsFolder: toResultLike(docsFolder, driveId, `${projectPath}/${DOCS_SEGMENT}`),
    };
  }

  private async readVisitOwnerMarker(folderPath: string): Promise<string | null> {
    const driveId = await this.resolveDriveId();
    const markerPath = `${folderPath}/${VISIT_OWNER_MARKER_FILENAME}`;
    const item = await this.tryGetItemByPath(driveId, markerPath);
    if (!item) return null;
    const url = `/drives/${driveId}/root:/${this.encodePath(markerPath)}:/content`;
    const response = await this.rawFetch(url);
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { visitId?: string } | null;
    return body?.visitId ?? null;
  }

  private async writeVisitOwnerMarker(folderPath: string, visitId: string): Promise<void> {
    await this.uploadSimple(
      folderPath,
      VISIT_OWNER_MARKER_FILENAME,
      Buffer.from(JSON.stringify({ visitId }), "utf-8"),
      "application/json"
    );
  }

  private async ensureVisitSubfolders(basePath: string, baseItem: GraphDriveItem): Promise<VisitFolderSet> {
    const driveId = await this.resolveDriveId();
    const photos = await this.ensureFolder(`${basePath}/${VISIT_PHOTOS_SEGMENT}`);
    const audio = await this.ensureFolder(`${basePath}/${VISIT_AUDIO_SEGMENT}`);
    const attachments = await this.ensureFolder(`${basePath}/${VISIT_ATTACHMENTS_SEGMENT}`);
    const reports = await this.ensureFolder(`${basePath}/${REPORTS_SEGMENT}`);
    return {
      visitPath: basePath,
      root: toResultLike(baseItem, driveId, basePath),
      photos: toResultLike(photos, driveId, `${basePath}/${VISIT_PHOTOS_SEGMENT}`),
      audio: toResultLike(audio, driveId, `${basePath}/${VISIT_AUDIO_SEGMENT}`),
      attachments: toResultLike(attachments, driveId, `${basePath}/${VISIT_ATTACHMENTS_SEGMENT}`),
      reports: toResultLike(reports, driveId, `${basePath}/${REPORTS_SEGMENT}`),
    };
  }

  /**
   * Ensures `סיורים/<YYYY-MM-DD>/` exists for this visit (with its four subfolders), appending a `_01`,
   * `_02`, ... suffix if that exact date folder is already taken by a *different* visit -- an existing
   * folder for the same visit (re-ensuring an already-created visit, e.g. after a resumed sync) is reused
   * as-is rather than bumping the suffix.
   *
   * How "same visit vs. different visit" is decided: immediately after creating a new date folder (before
   * anything else is written into it), a tiny `_visit_owner.json` marker is stamped with `{ visitId }`.
   * Re-checking that marker on a later call is what makes the idempotent-reuse and the collision-suffix
   * behavior both correct with one mechanism. Known gap: if the process crashes/loses network in the
   * narrow window between creating the folder and writing that marker, a later retry cannot tell "this is
   * my own half-finished folder" from "a different visit already took this slot" and will (safely, but
   * not ideally) bump to the next suffix instead of reusing the orphaned folder. There is no atomic
   * "create folder + stamp owner" primitive in the Graph API to close that window entirely; this is an
   * accepted, documented gap rather than a silent one.
   */
  async ensureVisitFolder(
    project: Pick<Project, "name">,
    visit: Pick<Inspection, "id" | "date">
  ): Promise<VisitFolderSet> {
    const projectPath = this.projectRootPath(project.name);
    const visitsRoot = `${projectPath}/${VISITS_SEGMENT}`;
    await this.ensureFolderPath(visitsRoot);

    const driveId = await this.resolveDriveId();
    const MAX_SUFFIX = 99;
    for (let suffix = 0; suffix <= MAX_SUFFIX; suffix++) {
      const candidateName = suffix === 0 ? visit.date : `${visit.date}_${String(suffix).padStart(2, "0")}`;
      const candidatePath = `${visitsRoot}/${candidateName}`;
      const existing = await this.tryGetItemByPath(driveId, candidatePath);

      if (!existing) {
        // Already confirmed absent by the `tryGetItemByPath` call just above -- create directly rather
        // than through `ensureFolder` (which would redundantly re-check existence first).
        const folder = await this.createFolder(candidatePath);
        await this.writeVisitOwnerMarker(candidatePath, visit.id);
        return this.ensureVisitSubfolders(candidatePath, folder);
      }

      const owner = await this.readVisitOwnerMarker(candidatePath);
      if (owner === visit.id) {
        return this.ensureVisitSubfolders(candidatePath, existing);
      }
      // Occupied by a different visit (or an unrecognized/legacy folder with no marker) -- try the next
      // suffix rather than ever overwriting it.
    }
    throw new Error(`Could not find a free visit folder slot for ${visit.date} after ${MAX_SUFFIX} suffixes`);
  }

  /* ----------------------------------------------------------------------------------------------
   * JSON manifests (ProjectInfo.json / Visit.json) -- simple upload-by-path always overwrites the
   * existing content at that exact path rather than creating a sibling, which is exactly "replace, don't
   * duplicate" with no extra conflict-behavior handling needed.
   * -------------------------------------------------------------------------------------------- */

  /** Writes/replaces `ProjectInfo.json` inside `נתוני פרויקט/`. Takes the `ProjectFolderSet` returned by
   * `ensureProjectFolders()` (its `projectPath` is what locates the right folder) rather than a bare
   * string, so callers can't accidentally point this at a project folder that was never actually ensured
   * to exist. */
  async writeProjectInfoJson(folders: Pick<ProjectFolderSet, "projectPath">, data: ProjectInfoJson): Promise<GraphUploadResult> {
    const folderPath = `${folders.projectPath}/${PROJECT_DATA_SEGMENT}`;
    return this.uploadSimple(folderPath, "ProjectInfo.json", Buffer.from(JSON.stringify(data, null, 2), "utf-8"), "application/json");
  }

  /** Writes/replaces `Visit.json` at the root of the visit's own date folder. Takes the `VisitFolderSet`
   * returned by `ensureVisitFolder()` for the same reason as `writeProjectInfoJson` above. */
  async writeVisitJson(folder: Pick<VisitFolderSet, "visitPath">, data: VisitJson): Promise<GraphUploadResult> {
    return this.uploadSimple(folder.visitPath, "Visit.json", Buffer.from(JSON.stringify(data, null, 2), "utf-8"), "application/json");
  }

  /* ----------------------------------------------------------------------------------------------
   * File uploads -- simple PUT under ~4MB, real resumable upload-session above it (spec requirement:
   * audio recordings routinely exceed 4MB).
   * -------------------------------------------------------------------------------------------- */

  private async uploadSimple(
    folderPath: string,
    filename: string,
    body: Buffer,
    contentType: string
  ): Promise<GraphUploadResult> {
    const driveId = await this.resolveDriveId();
    const safeName = sanitizeFilename(filename);
    const path = `${folderPath}/${safeName}`;
    const url = `/drives/${driveId}/root:/${this.encodePath(path)}:/content`;
    const item = await this.graphJson<GraphDriveItem>(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bufferBody(body),
    });
    return this.toUploadResult(item, driveId, path);
  }

  /** Strips this instance's `rootFolder` prefix off a drive-root-relative path, producing exactly what
   * `get()`/`getSignedGetUrl()`/`delete()` (the plain `ObjectStorage` interface, keyed relative to
   * `rootFolder` — see those methods' own `${this.config.rootFolder}/${key}` construction) expect back as
   * `key`. Falls back to the untouched path if it somehow doesn't start with `rootFolder` (defensive only
   * — every call site here always builds paths under `rootFolder`, so this should never actually trigger). */
  private toRelativeKey(path: string): string {
    const prefix = `${this.config.rootFolder}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  private toUploadResult(item: GraphDriveItem, fallbackDriveId: string, path: string): GraphUploadResult {
    return {
      driveId: item.parentReference?.driveId ?? fallbackDriveId,
      itemId: item.id,
      webUrl: item.webUrl,
      name: item.name,
      size: item.size ?? 0,
      key: this.toRelativeKey(path),
    };
  }

  /** Given a network failure mid-chunk, asks the upload session itself what it actually received
   * (`nextExpectedRanges`) rather than trusting our own start/end bookkeeping -- Graph may have buffered
   * bytes from a PUT whose response never reached us. Returns null if the session itself is gone/expired
   * (nothing left to resume). */
  private async queryResumeOffset(uploadUrl: string): Promise<number | null> {
    const response = await fetch(uploadUrl, { method: "GET" });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { nextExpectedRanges?: string[] } | null;
    const firstRange = body?.nextExpectedRanges?.[0];
    if (!firstRange) return null;
    const start = Number.parseInt(firstRange.split("-")[0] ?? "", 10);
    return Number.isFinite(start) ? start : null;
  }

  /** PUTs one chunk. Per Graph's resumable-upload contract, the `uploadUrl` from `createUploadSession` is
   * itself pre-authenticated -- these chunk PUTs deliberately do NOT carry an Authorization header (Graph
   * docs are explicit that adding one is not required and the URL already encodes short-lived access). */
  private async putChunk(
    uploadUrl: string,
    chunk: Buffer,
    start: number,
    end: number,
    total: number
  ): Promise<{ kind: "complete"; item: GraphDriveItem } | { kind: "partial"; nextOffset: number }> {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${total}`,
      },
      body: bufferBody(chunk),
    });

    if (response.status === 202) {
      const body = (await response.json()) as { nextExpectedRanges: string[] };
      const nextRange = body.nextExpectedRanges[0];
      const nextOffset = nextRange ? Number.parseInt(nextRange.split("-")[0] ?? "", 10) : end + 1;
      return { kind: "partial", nextOffset };
    }
    if (response.status === 200 || response.status === 201) {
      const item = (await response.json()) as GraphDriveItem;
      return { kind: "complete", item };
    }
    throw await this.graphError(response);
  }

  /** Wraps `putChunk` with one resume attempt: on any failure (thrown network error, or a non-202/200/201
   * status), asks the session for its real `nextExpectedRanges` and retries from there instead of blindly
   * repeating the same range -- this is what makes a retried upload resume/complete rather than
   * duplicating bytes or creating a second file (the final filename is deterministic -- see
   * `sanitizeFilename` + `@microsoft.graph.conflictBehavior: replace` on session creation below -- so even
   * a full from-scratch retry converges on the same item, never a duplicate). */
  private async putChunkWithRetry(
    uploadUrl: string,
    chunk: Buffer,
    start: number,
    end: number,
    total: number
  ): Promise<{ kind: "complete"; item: GraphDriveItem } | { kind: "partial"; nextOffset: number }> {
    try {
      return await this.putChunk(uploadUrl, chunk, start, end, total);
    } catch (err) {
      const resumeOffset = await this.queryResumeOffset(uploadUrl);
      if (resumeOffset === null) throw err; // session itself is gone -- nothing left to resume from
      if (resumeOffset > end) {
        // Graph already has this whole chunk (our PUT likely succeeded server-side but the response
        // never reached us) -- nothing to resend.
        return { kind: "partial", nextOffset: resumeOffset };
      }
      const alreadyReceived = resumeOffset - start;
      const remaining = chunk.subarray(Math.max(alreadyReceived, 0));
      return this.putChunk(uploadUrl, remaining, resumeOffset, end, total);
    }
  }

  private async uploadResumable(
    folderPath: string,
    filename: string,
    body: Buffer,
    _contentType: string
  ): Promise<GraphUploadResult> {
    const driveId = await this.resolveDriveId();
    const safeName = sanitizeFilename(filename);
    const path = `${folderPath}/${safeName}`;
    const sessionUrl = `/drives/${driveId}/root:/${this.encodePath(path)}:/createUploadSession`;

    const session = await this.graphJson<{ uploadUrl: string }>(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: {
          // "replace" (not "fail"/"rename"): keyed by the same deterministic sanitized filename every
          // time, so a retried upload of the same logical file overwrites/completes the prior attempt
          // instead of piling up "audio (1).webm", "audio (2).webm", ... siblings.
          "@microsoft.graph.conflictBehavior": "replace",
          name: safeName,
        },
      }),
    });

    const total = body.length;
    let offset = 0;
    let finalItem: GraphDriveItem | null = null;

    while (offset < total) {
      const chunkEnd = Math.min(offset + this.chunkSizeBytes, total);
      const chunk = body.subarray(offset, chunkEnd);
      const result = await this.putChunkWithRetry(session.uploadUrl, chunk, offset, chunkEnd - 1, total);
      if (result.kind === "complete") {
        finalItem = result.item;
        break;
      }
      offset = result.nextOffset;
    }

    if (!finalItem) throw new Error("Resumable upload finished without a final driveItem response from Graph");
    return this.toUploadResult(finalItem, driveId, path);
  }

  /**
   * Uploads a photo/audio/report/attachment file into `folderPath` (a path relative to the drive root --
   * typically one of `VisitFolderSet`'s `photos`/`audio`/`attachments`/`reports` paths, or
   * `ProjectFolderSet`'s `reportsFolder`/`docsFolder`). Picks simple vs. resumable upload automatically
   * based on size. The returned `GraphUploadResult` is the durable reference to store on the corresponding
   * `Photo`/`AudioChunk`/report record -- never re-derive identity from the filename/path later, since a
   * SharePoint rename or folder move would silently break that.
   */
  async uploadFile(folderPath: string, filename: string, body: Buffer, contentType: string): Promise<GraphUploadResult> {
    if (body.length <= SIMPLE_UPLOAD_MAX_BYTES) {
      return this.uploadSimple(folderPath, filename, body, contentType);
    }
    return this.uploadResumable(folderPath, filename, body, contentType);
  }

  /* ----------------------------------------------------------------------------------------------
   * `ObjectStorage` interface -- flat key/value access for generic callers (e.g. packages/ai-pipeline's
   * `storage.get()` for transcription) that don't need the rich folder structure above. A key maps
   * directly to `<rootFolder>/<key>`.
   * -------------------------------------------------------------------------------------------- */

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const { folder, filename } = splitKey(key);
    const folderPath = folder ? `${this.config.rootFolder}/${folder}` : this.config.rootFolder;
    if (folder) await this.ensureFolderPath(folderPath);
    else await this.ensureFolderPath(this.config.rootFolder);
    await this.uploadFile(folderPath, filename, buffer, contentType);
  }

  async get(key: string): Promise<Buffer> {
    const driveId = await this.resolveDriveId();
    const path = `${this.config.rootFolder}/${key}`;
    const url = `/drives/${driveId}/root:/${this.encodePath(path)}:/content`;
    const response = await this.rawFetch(url);
    if (!response.ok) throw await this.graphError(response);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /** See this file's own top-of-class comment for why `webUrl` (not a short-lived anonymous download
   * link) was chosen here. `expiresInSeconds` is accepted only to match `ObjectStorage`'s shared
   * signature with `S3Storage`; a SharePoint `webUrl` doesn't expire, so it's unused. */
  async getSignedGetUrl(key: string, _expiresInSeconds?: number): Promise<string> {
    const driveId = await this.resolveDriveId();
    const path = `${this.config.rootFolder}/${key}`;
    const item = await this.graphJson<GraphDriveItem>(`/drives/${driveId}/root:/${this.encodePath(path)}`);
    return item.webUrl;
  }

  async delete(key: string): Promise<void> {
    const driveId = await this.resolveDriveId();
    const path = `${this.config.rootFolder}/${key}`;
    const response = await this.rawFetch(`/drives/${driveId}/root:/${this.encodePath(path)}`, {
      method: "DELETE",
    });
    // Tolerate "already gone" the same way LocalFsStorage's `{ force: true }` does -- delete is meant to
    // be idempotent, not to fail a second call.
    if (!response.ok && response.status !== 404) throw await this.graphError(response);
  }
}
