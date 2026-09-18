import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAuth } from "../src/graph-auth.js";
import { MsGraphStorage, type MsGraphStorageConfig } from "../src/ms-graph-storage.js";
import {
  fakeDriveItem,
  GraphFetchMock,
  emptyResponse,
  jsonResponse,
  notFoundResponse,
  tokenResponse,
} from "./support/graph-fetch-mock.js";

const DRIVE_ID = "drive-abc-123";
const SITE_ID = "site-abc-123";
const ROOT_FOLDER = "סיורי פיקוח";

function drivesListResponse(): Response {
  return jsonResponse(200, { value: [{ id: DRIVE_ID, name: "Documents" }] });
}

/** Primes the two calls every MsGraphStorage operation triggers on a cold instance: the Entra token, then
 * the site's drives list (to resolve MS_GRAPH_DRIVE_NAME -> a real driveId). Real GraphAuth is used
 * (not a hand-rolled fake) so the auth header assertions below exercise the real end-to-end flow. */
function primeAuthAndDrive(fetchMock: GraphFetchMock): void {
  fetchMock.enqueueResponse(tokenResponse());
  fetchMock.enqueueResponse(drivesListResponse());
}

function makeStorage(fetchMock: GraphFetchMock, overrides: Partial<MsGraphStorageConfig> = {}): MsGraphStorage {
  const auth = new GraphAuth({ tenantId: "tenant-1", clientId: "client-1", clientSecret: "secret-1" });
  return new MsGraphStorage({
    auth,
    siteId: SITE_ID,
    driveName: "Documents",
    rootFolder: ROOT_FOLDER,
    ...overrides,
  });
}

function encodedPath(segments: string[]): string {
  return segments.map(encodeURIComponent).join("/");
}

function graphUrl(path: string): string {
  return `https://graph.microsoft.com/v1.0${path}`;
}

/** Excludes the Entra token POST (login.microsoftonline.com) and the drive-resolution GET
 * (/sites/.../drives) -- both fire once per cold `MsGraphStorage` instance and aren't part of whatever
 * folder/file operation a given test is actually asserting on. */
function graphItemCalls(fetchMock: GraphFetchMock) {
  return fetchMock.calls.filter((c) => c.url.startsWith("https://graph.microsoft.com") && !c.url.endsWith("/drives"));
}

describe("MsGraphStorage", () => {
  let fetchMock: GraphFetchMock;

  beforeEach(() => {
    fetchMock = new GraphFetchMock();
    vi.stubGlobal("fetch", fetchMock.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("auth + drive resolution", () => {
    it("attaches a Bearer token from GraphAuth to every Graph request, and resolves the drive by name", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(emptyResponse(204));
      const storage = makeStorage(fetchMock);

      await storage.delete("photos/abc.jpg");

      expect(fetchMock.calls).toHaveLength(3);
      const [, drivesCall, deleteCall] = fetchMock.calls;
      expect(drivesCall!.url).toBe(graphUrl(`/sites/${SITE_ID}/drives`));
      expect(drivesCall!.headers.authorization).toBe("Bearer test-access-token");

      expect(deleteCall!.method).toBe("DELETE");
      expect(deleteCall!.headers.authorization).toBe("Bearer test-access-token");
      expect(deleteCall!.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "photos", "abc.jpg"])}`)
      );
    });

    it("resolves the site by hostname+path when no siteId is configured", async () => {
      fetchMock.enqueueResponse(tokenResponse());
      fetchMock.enqueueResponse(jsonResponse(200, { id: SITE_ID }));
      fetchMock.enqueueResponse(drivesListResponse());
      fetchMock.enqueueResponse(emptyResponse(204));
      const storage = makeStorage(fetchMock, {
        siteId: undefined,
        siteHostname: "contoso.sharepoint.com",
        sitePath: "/sites/AVInspectionTours",
      });

      await storage.delete("x.txt");

      expect(fetchMock.calls[1]!.url).toBe(
        graphUrl(`/sites/contoso.sharepoint.com:/sites/AVInspectionTours`)
      );
    });

    it("throws a descriptive error when the configured drive name isn't found on the site", async () => {
      fetchMock.enqueueResponse(tokenResponse());
      fetchMock.enqueueResponse(jsonResponse(200, { value: [{ id: "d1", name: "Some Other Library" }] }));
      const storage = makeStorage(fetchMock);

      await expect(storage.delete("x.txt")).rejects.toThrow(/No document library named "Documents"/);
    });
  });

  describe("idempotent folder creation", () => {
    it("ensureProjectFolders creates the root/פרויקטים/<name> chain and its 4 subfolders when none exist", async () => {
      primeAuthAndDrive(fetchMock);
      const segments = [ROOT_FOLDER, "פרויקטים", "מלון דן תל אביב"];
      // ensureFolderPath walks 3 ancestor segments; each does a GET-miss then a POST-create.
      for (const name of segments) {
        fetchMock.enqueueResponse(notFoundResponse());
        fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: `id-${name}`, name, driveId: DRIVE_ID })));
      }
      for (const name of ["נתוני פרויקט", "סיורים", "דוחות", "מסמכים"]) {
        fetchMock.enqueueResponse(notFoundResponse());
        fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: `id-${name}`, name, driveId: DRIVE_ID })));
      }
      const storage = makeStorage(fetchMock);

      const result = await storage.ensureProjectFolders({ name: "מלון דן תל אביב" });

      expect(result.projectPath).toBe(`${ROOT_FOLDER}/פרויקטים/מלון דן תל אביב`);
      expect(result.dataFolder.itemId).toBe("id-נתוני פרויקט");
      expect(result.visitsFolder.itemId).toBe("id-סיורים");
      expect(result.reportsFolder.itemId).toBe("id-דוחות");
      expect(result.docsFolder.itemId).toBe("id-מסמכים");
      // `path` must be immediately usable as `uploadFile`'s folderPath argument -- callers (the real sync
      // pipeline) have no other way to get from a folder-set entry to a place they can actually upload into.
      expect(result.dataFolder.path).toBe(`${ROOT_FOLDER}/פרויקטים/מלון דן תל אביב/נתוני פרויקט`);
      expect(result.visitsFolder.path).toBe(`${ROOT_FOLDER}/פרויקטים/מלון דן תל אביב/סיורים`);

      const postCalls = graphItemCalls(fetchMock).filter((c) => c.method === "POST");
      expect(postCalls).toHaveLength(7);

      // The very first segment's parent is the drive root itself -- no path-addressed parent colon.
      expect(postCalls[0]!.url).toBe(graphUrl(`/drives/${DRIVE_ID}/root/children`));
      const firstBody = JSON.parse(postCalls[0]!.body as string);
      expect(firstBody).toEqual({
        name: ROOT_FOLDER,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      });

      // A deeper segment addresses its parent by path.
      const dataFolderPost = postCalls.find((c) => JSON.parse(c.body as string).name === "נתוני פרויקט")!;
      expect(dataFolderPost.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "פרויקטים", "מלון דן תל אביב"])}:/children`)
      );
    });

    it("calling ensureProjectFolders again when every folder already exists makes zero POST calls", async () => {
      primeAuthAndDrive(fetchMock);
      const names = [ROOT_FOLDER, "פרויקטים", "מלון דן תל אביב", "נתוני פרויקט", "סיורים", "דוחות", "מסמכים"];
      for (const name of names) {
        fetchMock.enqueueResponse(jsonResponse(200, fakeDriveItem({ id: `id-${name}`, name, driveId: DRIVE_ID })));
      }
      const storage = makeStorage(fetchMock);

      const result = await storage.ensureProjectFolders({ name: "מלון דן תל אביב" });

      expect(result.dataFolder.itemId).toBe("id-נתוני פרויקט");
      const itemCalls = graphItemCalls(fetchMock);
      expect(itemCalls.filter((c) => c.method === "POST")).toHaveLength(0);
      expect(itemCalls.filter((c) => c.method === "GET")).toHaveLength(names.length);
    });
  });

  describe("date-folder collision suffix logic", () => {
    const PROJECT_NAME = "מלון דן תל אביב";
    const VISITS_ROOT = `${ROOT_FOLDER}/פרויקטים/${PROJECT_NAME}/סיורים`;

    function enqueueExistingAncestors(): void {
      // ensureFolderPath(visitsRoot) walks 4 segments; all already exist for this describe block.
      for (const name of [ROOT_FOLDER, "פרויקטים", PROJECT_NAME, "סיורים"]) {
        fetchMock.enqueueResponse(jsonResponse(200, fakeDriveItem({ id: `id-${name}`, name, driveId: DRIVE_ID })));
      }
    }

    function enqueueExistingSubfolders(basePath: string): void {
      for (const name of ["תמונות", "הקלטות", "קבצים מצורפים", "דוחות"]) {
        fetchMock.enqueueResponse(jsonResponse(200, fakeDriveItem({ id: `id-${basePath}-${name}`, name, driveId: DRIVE_ID })));
      }
    }

    it("appends _01 when the plain date folder already belongs to a different visit", async () => {
      primeAuthAndDrive(fetchMock);
      enqueueExistingAncestors();

      // Candidate "2026-09-18" exists...
      fetchMock.enqueueResponse(
        jsonResponse(200, fakeDriveItem({ id: "existing-date-folder", name: "2026-09-18", driveId: DRIVE_ID }))
      );
      // ...owned by a different visit (marker lookup + content read).
      fetchMock.enqueueResponse(
        jsonResponse(200, fakeDriveItem({ id: "marker-1", name: "_visit_owner.json", driveId: DRIVE_ID }))
      );
      fetchMock.enqueueResponse(jsonResponse(200, { visitId: "other-visit-id" }));

      // Candidate "2026-09-18_01" is free -- create it, then stamp the marker, then subfolders.
      fetchMock.enqueueResponse(notFoundResponse());
      fetchMock.enqueueResponse(
        jsonResponse(201, fakeDriveItem({ id: "new-date-folder", name: "2026-09-18_01", driveId: DRIVE_ID }))
      );
      fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: "marker-2", name: "_visit_owner.json", driveId: DRIVE_ID })));
      enqueueExistingSubfolders("2026-09-18_01");

      const storage = makeStorage(fetchMock);
      const result = await storage.ensureVisitFolder({ name: PROJECT_NAME }, { id: "my-visit-id", date: "2026-09-18" });

      expect(result.visitPath).toBe(`${VISITS_ROOT}/2026-09-18_01`);
      expect(result.photos.path).toBe(`${VISITS_ROOT}/2026-09-18_01/תמונות`);
      expect(result.audio.path).toBe(`${VISITS_ROOT}/2026-09-18_01/הקלטות`);

      const postCalls = fetchMock.calls.filter((c) => c.method === "POST");
      // Exactly one folder-create POST (the _01 folder) + one file PUT... wait, marker write is a PUT, not POST.
      const folderCreatePosts = postCalls.filter((c) => {
        try {
          return JSON.parse(c.body as string).folder !== undefined;
        } catch {
          return false;
        }
      });
      expect(folderCreatePosts).toHaveLength(1);
      expect(JSON.parse(folderCreatePosts[0]!.body as string).name).toBe("2026-09-18_01");

      // Never attempted to create/touch the plain (already-taken) date folder itself.
      expect(fetchMock.calls.some((c) => c.method !== "GET" && c.url.endsWith(encodeURIComponent("2026-09-18")))).toBe(false);

      const markerPut = fetchMock.calls.find((c) => c.method === "PUT" && c.url.includes("_visit_owner.json"));
      expect(markerPut).toBeDefined();
      expect(JSON.parse(markerPut!.body as string)).toEqual({ visitId: "my-visit-id" });
    });

    it("reuses the same date folder (no suffix) when re-ensuring the same visit's own folder", async () => {
      primeAuthAndDrive(fetchMock);
      enqueueExistingAncestors();
      fetchMock.enqueueResponse(
        jsonResponse(200, fakeDriveItem({ id: "existing-date-folder", name: "2026-09-18", driveId: DRIVE_ID }))
      );
      fetchMock.enqueueResponse(
        jsonResponse(200, fakeDriveItem({ id: "marker-1", name: "_visit_owner.json", driveId: DRIVE_ID }))
      );
      fetchMock.enqueueResponse(jsonResponse(200, { visitId: "my-visit-id" }));
      enqueueExistingSubfolders("2026-09-18");

      const storage = makeStorage(fetchMock);
      const result = await storage.ensureVisitFolder({ name: PROJECT_NAME }, { id: "my-visit-id", date: "2026-09-18" });

      expect(result.visitPath).toBe(`${VISITS_ROOT}/2026-09-18`);
      const postCalls = graphItemCalls(fetchMock).filter((c) => c.method === "POST");
      expect(postCalls).toHaveLength(0);
    });
  });

  describe("JSON manifests", () => {
    it("writeProjectInfoJson PUTs ProjectInfo.json under נתוני פרויקט/, replacing any previous version", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(
        jsonResponse(201, fakeDriveItem({ id: "info-item", name: "ProjectInfo.json", driveId: DRIVE_ID }))
      );
      const storage = makeStorage(fetchMock);
      const projectPath = `${ROOT_FOLDER}/פרויקטים/מלון דן`;

      const data = {
        projectId: "p1",
        projectName: "מלון דן",
        client: null,
        status: "פעיל",
        createdAt: "2026-09-18T08:00:00.000Z",
        updatedAt: "2026-09-18T08:00:00.000Z",
        oneDriveDriveId: DRIVE_ID,
        oneDriveFolderId: "root-item",
        webUrl: "https://contoso.sharepoint.com/x",
        folderPath: projectPath,
      };
      const result = await storage.writeProjectInfoJson({ projectPath }, data);

      expect(result.itemId).toBe("info-item");
      const putCall = fetchMock.calls.at(-1)!;
      expect(putCall.method).toBe("PUT");
      expect(putCall.headers["content-type"]).toBe("application/json");
      expect(putCall.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "פרויקטים", "מלון דן", "נתוני פרויקט", "ProjectInfo.json"])}:/content`)
      );
      expect(JSON.parse(putCall.body as string)).toEqual(data);
    });

    it("writeVisitJson PUTs Visit.json at the visit folder's own root", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: "visit-json-item", name: "Visit.json", driveId: DRIVE_ID })));
      const storage = makeStorage(fetchMock);
      const visitPath = `${ROOT_FOLDER}/פרויקטים/מלון דן/סיורים/2026-09-18`;

      const data = {
        visitId: "v1",
        projectId: "p1",
        date: "2026-09-18",
        createdAt: "2026-09-18T08:00:00.000Z",
        updatedAt: "2026-09-18T08:00:00.000Z",
        participants: ["דנה"],
        contractors: [],
        floors: [],
        rooms: [],
        tasks: [],
        notes: [],
        photoReferences: [],
        audioReferences: [],
        attachmentReferences: [],
        reportReferences: [],
      };
      await storage.writeVisitJson({ visitPath }, data);

      const putCall = fetchMock.calls.at(-1)!;
      expect(putCall.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "פרויקטים", "מלון דן", "סיורים", "2026-09-18", "Visit.json"])}:/content`)
      );
      expect(JSON.parse(putCall.body as string)).toEqual(data);
    });
  });

  describe("simple upload (<= 4MB)", () => {
    it("PUTs bytes directly to .../content and returns driveId/itemId/webUrl/name/size", async () => {
      primeAuthAndDrive(fetchMock);
      // No parentReference on this one -- exercises the fallback-to-resolved-driveId path.
      fetchMock.enqueueResponse(
        jsonResponse(201, { id: "photo-item-1", name: "תמונה.jpg", webUrl: "https://contoso.sharepoint.com/x/תמונה.jpg", size: 4 })
      );
      const storage = makeStorage(fetchMock);
      const body = Buffer.from("fake-jpeg-bytes-1234");

      const result = await storage.uploadFile(`${ROOT_FOLDER}/פרויקטים/מלון דן/סיורים/2026-09-18/תמונות`, "תמונה.jpg", body, "image/jpeg");

      expect(result).toEqual({
        driveId: DRIVE_ID, // fell back to the resolved drive id
        itemId: "photo-item-1",
        webUrl: "https://contoso.sharepoint.com/x/תמונה.jpg",
        name: "תמונה.jpg",
        size: 4,
        // Relative to ROOT_FOLDER, exactly what get()/getSignedGetUrl()/delete() expect back as `key` --
        // this is what actually gets stored in a Photo/AudioChunk/Attachment row's cloudFileId.
        key: "פרויקטים/מלון דן/סיורים/2026-09-18/תמונות/תמונה.jpg",
      });

      const putCall = fetchMock.calls.at(-1)!;
      expect(putCall.method).toBe("PUT");
      expect(putCall.headers["content-type"]).toBe("image/jpeg");
      expect(Buffer.isBuffer(putCall.body)).toBe(true);
      expect(Buffer.compare(putCall.body as Buffer, body)).toBe(0);
    });

    it("round-trips: get(uploadResult.key) resolves back to the exact same drive item", async () => {
      // Locks in the invariant apps/web/lib/server/file-sync-entities.ts's wiring depends on: a caller
      // that only ever sees the plain `ObjectStorage` interface (get/getSignedGetUrl/delete) must be able
      // to pass `key` straight back in, with zero knowledge of the rich folder structure it came from.
      primeAuthAndDrive(fetchMock);
      const uploadPath = `${ROOT_FOLDER}/פרויקטים/מלון דן/סיורים/2026-09-18/תמונות`;
      fetchMock.enqueueResponse(
        jsonResponse(201, { id: "photo-item-2", name: "b.jpg", webUrl: "https://contoso.sharepoint.com/x/b.jpg", size: 3 })
      );
      const storage = makeStorage(fetchMock);
      const uploaded = await storage.uploadFile(uploadPath, "b.jpg", Buffer.from("abc"), "image/jpeg");

      fetchMock.enqueueResponse(jsonResponse(200, { id: "photo-item-2", name: "b.jpg", webUrl: "https://contoso.sharepoint.com/x/b.jpg" }));
      const getCall = fetchMock.calls.length;
      await storage.getSignedGetUrl(uploaded.key);

      expect(fetchMock.calls[getCall]!.url).toBe(graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "פרויקטים", "מלון דן", "סיורים", "2026-09-18", "תמונות", "b.jpg"])}`));
    });

    it("sanitizes the filename before uploading", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: "i1", name: "a_b.jpg", driveId: DRIVE_ID })));
      const storage = makeStorage(fetchMock);

      await storage.uploadFile(`${ROOT_FOLDER}/x`, 'a"b.jpg', Buffer.from("x"), "image/jpeg");

      const putCall = fetchMock.calls.at(-1)!;
      expect(putCall.url).toContain(encodeURIComponent("a_b.jpg"));
    });
  });

  describe("resumable upload (> 4MB)", () => {
    const FOLDER_PATH = `${ROOT_FOLDER}/פרויקטים/מלון דן/סיורים/2026-09-18/הקלטות`;
    const CHUNK_SIZE = 2_000_000;
    const BODY_SIZE = 5_000_010; // 2 full chunks + a smaller final chunk

    it("creates a resumable session and PUTs sequential chunks, parsing the final driveItem", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(200, { uploadUrl: "https://upload.example.com/session-1" }));
      fetchMock.enqueueResponse(jsonResponse(202, { nextExpectedRanges: ["2000000-5000010"] }));
      fetchMock.enqueueResponse(jsonResponse(202, { nextExpectedRanges: ["4000000-5000010"] }));
      fetchMock.enqueueResponse(
        jsonResponse(201, fakeDriveItem({ id: "audio-item-1", name: "audio.webm", size: BODY_SIZE, driveId: DRIVE_ID }))
      );
      const storage = makeStorage(fetchMock, { chunkSizeBytes: CHUNK_SIZE });
      const body = Buffer.alloc(BODY_SIZE, 7);

      const result = await storage.uploadFile(FOLDER_PATH, "audio.webm", body, "audio/webm");

      expect(result.itemId).toBe("audio-item-1");
      expect(result.size).toBe(BODY_SIZE);

      const sessionCall = fetchMock.calls[2]!;
      expect(sessionCall.method).toBe("POST");
      expect(sessionCall.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "פרויקטים", "מלון דן", "סיורים", "2026-09-18", "הקלטות", "audio.webm"])}:/createUploadSession`)
      );
      expect(JSON.parse(sessionCall.body as string)).toEqual({
        item: { "@microsoft.graph.conflictBehavior": "replace", name: "audio.webm" },
      });
      // Session creation goes through the authenticated Graph client.
      expect(sessionCall.headers.authorization).toBe("Bearer test-access-token");

      const chunkCalls = fetchMock.calls.slice(3);
      expect(chunkCalls).toHaveLength(3);
      expect(chunkCalls.every((c) => c.url === "https://upload.example.com/session-1")).toBe(true);
      // Per Graph's documented contract, the pre-authenticated uploadUrl must NOT carry our Bearer token.
      expect(chunkCalls.every((c) => c.headers.authorization === undefined)).toBe(true);

      expect(chunkCalls[0]!.headers["content-range"]).toBe(`bytes 0-1999999/${BODY_SIZE}`);
      expect(chunkCalls[0]!.headers["content-length"]).toBe("2000000");
      expect(chunkCalls[1]!.headers["content-range"]).toBe(`bytes 2000000-3999999/${BODY_SIZE}`);
      expect(chunkCalls[2]!.headers["content-range"]).toBe(`bytes 4000000-5000009/${BODY_SIZE}`);
      expect(chunkCalls[2]!.headers["content-length"]).toBe("1000010");
    });

    it("resumes from the session's own nextExpectedRanges after a dropped chunk, without creating a second session", async () => {
      // Deliberately > SIMPLE_UPLOAD_MAX_BYTES (4 MiB) -- a body this size must take the resumable path,
      // not simple upload, regardless of the (unrelated) chunk-size override below.
      const RETRY_BODY_SIZE = 4_200_000;
      const RETRY_CHUNK_SIZE = 2_100_000;

      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(200, { uploadUrl: "https://upload.example.com/session-2" }));
      // First attempt at chunk 1 is dropped mid-flight (simulated network failure).
      fetchMock.enqueueError(new Error("simulated network drop"));
      // Recovery queries the session -- Graph says it received nothing yet, resume from 0.
      fetchMock.enqueueResponse(jsonResponse(200, { nextExpectedRanges: ["0-4199999"] }));
      // Retried chunk 1 succeeds.
      fetchMock.enqueueResponse(jsonResponse(202, { nextExpectedRanges: ["2100000-4199999"] }));
      // Final chunk completes the upload.
      fetchMock.enqueueResponse(
        jsonResponse(201, fakeDriveItem({ id: "audio-item-2", name: "audio.webm", size: RETRY_BODY_SIZE, driveId: DRIVE_ID }))
      );

      const storage = makeStorage(fetchMock, { chunkSizeBytes: RETRY_CHUNK_SIZE });
      const body = Buffer.alloc(RETRY_BODY_SIZE, 9);

      const result = await storage.uploadFile(FOLDER_PATH, "audio.webm", body, "audio/webm");

      expect(result.itemId).toBe("audio-item-2");
      const sessionPosts = fetchMock.calls.filter((c) => c.url.endsWith(":/createUploadSession"));
      expect(sessionPosts).toHaveLength(1); // never opened a second session on retry

      const uploadUrlCalls = fetchMock.calls.filter((c) => c.url === "https://upload.example.com/session-2");
      // 1 failed PUT attempt + 1 GET status query + 1 retried PUT + 1 final PUT = 4
      expect(uploadUrlCalls).toHaveLength(4);
      expect(uploadUrlCalls[1]!.method).toBe("GET");
      expect(uploadUrlCalls[2]!.headers["content-range"]).toBe(`bytes 0-2099999/${RETRY_BODY_SIZE}`);
      expect(uploadUrlCalls[3]!.headers["content-range"]).toBe(`bytes 2100000-4199999/${RETRY_BODY_SIZE}`);
    });

    it("does not resend a chunk the session already fully received, when only the response was lost", async () => {
      const RETRY_BODY_SIZE = 4_200_000;
      const RETRY_CHUNK_SIZE = 2_100_000;

      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(200, { uploadUrl: "https://upload.example.com/session-3" }));
      // Chunk 1's PUT throws locally (response never arrived)...
      fetchMock.enqueueError(new Error("response lost"));
      // ...but the session confirms it actually has all of chunk 1 already.
      fetchMock.enqueueResponse(jsonResponse(200, { nextExpectedRanges: ["2100000-4199999"] }));
      // So we go straight to the final chunk -- no resend of chunk 1's bytes.
      fetchMock.enqueueResponse(
        jsonResponse(201, fakeDriveItem({ id: "audio-item-3", name: "audio.webm", size: RETRY_BODY_SIZE, driveId: DRIVE_ID }))
      );

      const storage = makeStorage(fetchMock, { chunkSizeBytes: RETRY_CHUNK_SIZE });
      const body = Buffer.alloc(RETRY_BODY_SIZE, 3);

      const result = await storage.uploadFile(FOLDER_PATH, "audio.webm", body, "audio/webm");

      expect(result.itemId).toBe("audio-item-3");
      const uploadUrlCalls = fetchMock.calls.filter((c) => c.url === "https://upload.example.com/session-3");
      // 1 failed PUT + 1 GET status query + 1 final PUT = 3 -- no retried PUT of chunk 1's range.
      expect(uploadUrlCalls).toHaveLength(3);
      expect(uploadUrlCalls[2]!.headers["content-range"]).toBe(`bytes 2100000-4199999/${RETRY_BODY_SIZE}`);
    });
  });

  describe("ObjectStorage interface (put/get/getSignedGetUrl/delete)", () => {
    it("put() ensures the parent folder then uploads under rootFolder/<key>", async () => {
      primeAuthAndDrive(fetchMock);
      // ensureFolderPath walks both ancestor segments: the configured root folder, then "photos" under it.
      fetchMock.enqueueResponse(jsonResponse(200, fakeDriveItem({ id: "folder-root", name: ROOT_FOLDER, driveId: DRIVE_ID })));
      fetchMock.enqueueResponse(jsonResponse(200, fakeDriveItem({ id: "folder-photos", name: "photos", driveId: DRIVE_ID })));
      fetchMock.enqueueResponse(jsonResponse(201, fakeDriveItem({ id: "photo-1", name: "abc.jpg", driveId: DRIVE_ID })));
      const storage = makeStorage(fetchMock);

      await storage.put("photos/abc.jpg", Buffer.from("bytes"), "image/jpeg");

      const putCall = fetchMock.calls.at(-1)!;
      expect(putCall.url).toBe(graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "photos", "abc.jpg"])}:/content`));
    });

    it("get() downloads bytes from rootFolder/<key>", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueue(() => {
        const bytes = Buffer.from("hello-bytes");
        return {
          ok: true,
          status: 200,
          statusText: "",
          json: async () => ({}),
          text: async () => "",
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        } as unknown as Response;
      });
      const storage = makeStorage(fetchMock);

      const result = await storage.get("audio/seg1.webm");

      expect(result.toString()).toBe("hello-bytes");
      expect(fetchMock.calls.at(-1)!.url).toBe(
        graphUrl(`/drives/${DRIVE_ID}/root:/${encodedPath([ROOT_FOLDER, "audio", "seg1.webm"])}:/content`)
      );
    });

    it("getSignedGetUrl() returns the item's webUrl", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(
        jsonResponse(200, fakeDriveItem({ id: "i1", name: "abc.jpg", webUrl: "https://contoso.sharepoint.com/x/abc.jpg", driveId: DRIVE_ID }))
      );
      const storage = makeStorage(fetchMock);

      const url = await storage.getSignedGetUrl("photos/abc.jpg");

      expect(url).toBe("https://contoso.sharepoint.com/x/abc.jpg");
    });

    it("delete() tolerates an already-missing item (404) instead of throwing", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(notFoundResponse());
      const storage = makeStorage(fetchMock);

      await expect(storage.delete("photos/gone.jpg")).resolves.toBeUndefined();
    });

    it("delete() throws on a real failure (not a 404)", async () => {
      primeAuthAndDrive(fetchMock);
      fetchMock.enqueueResponse(jsonResponse(500, { error: "boom" }, "Internal Server Error"));
      const storage = makeStorage(fetchMock);

      await expect(storage.delete("photos/x.jpg")).rejects.toThrow(/Microsoft Graph request failed: 500/);
    });
  });
});
