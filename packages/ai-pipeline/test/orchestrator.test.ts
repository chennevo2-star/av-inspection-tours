import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InspectionExtraction } from "@av-inspection/shared-types";

const FLOOR_ID = "11111111-1111-1111-1111-111111111111";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";
const CONTRACTOR_ID = "33333333-3333-3333-3333-333333333333";
const PROJECT_ID = "44444444-4444-4444-4444-444444444444";
const OPEN_TASK_ID = "55555555-5555-5555-5555-555555555555";
const CLOSED_TASK_ID = "66666666-6666-6666-6666-666666666666";
const PHOTO_ID = "77777777-7777-7777-7777-777777777777";

class FakeTranscriptionProvider {
  calls: { mimeType: string; byteLength: number }[] = [];
  async transcribe(audio: Buffer, mimeType: string) {
    this.calls.push({ mimeType, byteLength: audio.length });
    return { text: `[קטע מתומלל, ${audio.length} בייטים]` };
  }
}

class FakeExtractionAgent {
  receivedTranscript: string | null = null;
  receivedReference: unknown = null;
  constructor(private readonly result: InspectionExtraction) {}
  async extract(transcript: string, reference: unknown): Promise<InspectionExtraction> {
    this.receivedTranscript = transcript;
    this.receivedReference = reference;
    return this.result;
  }
}

class FailingExtractionAgent {
  async extract(): Promise<InspectionExtraction> {
    throw new Error("simulated Claude API failure");
  }
}

function fakeExtractionResult(): InspectionExtraction {
  return {
    inspectionSummary: "סיכום שנוצר על ידי הסוכן המדומה",
    findings: [
      {
        floorId: FLOOR_ID,
        roomId: ROOM_ID,
        category: null,
        subject: "נושא לדוגמה",
        finding: "ממצא לדוגמה",
        requiredAction: null,
        responsibleContractorId: CONTRACTOR_ID,
        secondaryResponsibleContractorId: null,
        priority: null,
        confidence: 0.9,
        needsUserReview: false,
      },
    ],
    tasks: [],
    photoAssociations: [],
    contractorMentions: [],
    roomMentions: [],
    previousTaskUpdates: [],
  };
}

describe("runAiPipelineForInspection (real PGlite + real local-fs storage, fake AI providers)", () => {
  let pgliteDir: string;
  let uploadsDir: string;
  let inspectionId: string;

  beforeAll(() => {
    pgliteDir = mkdtempSync(path.join(tmpdir(), "av-inspection-ai-pglite-"));
    uploadsDir = mkdtempSync(path.join(tmpdir(), "av-inspection-ai-uploads-"));
    process.env.PGLITE_DATA_DIR = pgliteDir;
    process.env.LOCAL_UPLOADS_DIR = uploadsDir;
    delete process.env.DATABASE_URL;
    delete process.env.S3_ENDPOINT;
  });

  afterAll(() => {
    rmSync(pgliteDir, { recursive: true, force: true });
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const { runMigrations, getDb, projects, floors, rooms, contractors, contractorAliases, tasks, inspections, photos, audioChunks, audio } =
      await import("@av-inspection/db");
    const { getStorage } = await import("@av-inspection/storage");
    await runMigrations();
    const db = getDb();

    // Clean slate between tests (same PGlite instance persists across tests in this file).
    await db.delete(photos);
    await db.delete(audioChunks);
    await db.delete(audio);
    await db.delete(tasks);
    await db.delete(contractorAliases);
    await db.delete(contractors);
    await db.delete(rooms);
    await db.delete(floors);
    await db.delete(inspections);
    await db.delete(projects);

    await db.insert(projects).values({ id: PROJECT_ID, name: "פרויקט בדיקה", status: "פעיל" });
    await db.insert(floors).values({ id: FLOOR_ID, projectId: PROJECT_ID, name: "קומה 1", sortOrder: 0 });
    await db.insert(rooms).values({ id: ROOM_ID, floorId: FLOOR_ID, name: "חדר ישיבות" });
    await db.insert(contractors).values({ id: CONTRACTOR_ID, projectId: PROJECT_ID, companyName: "קבלן הבדיקה" });
    await db.insert(contractorAliases).values({ id: crypto.randomUUID(), contractorId: CONTRACTOR_ID, alias: "הקבלן" });

    inspectionId = crypto.randomUUID();
    const startTime = new Date("2026-09-08T10:00:00.000Z");
    await db.insert(inspections).values({
      id: inspectionId,
      projectId: PROJECT_ID,
      inspectionNumber: 1,
      date: "2026-09-08",
      startTime,
      inspector: "דני",
    });

    // Tasks reference a real inspection id (FK) — using this same inspection is fine for this test's
    // purposes, since what's under test is status-based filtering, not which inspection created them.
    await db.insert(tasks).values([
      { id: OPEN_TASK_ID, projectId: PROJECT_ID, description: "משימה פתוחה", status: "פתוח", createdInspectionId: inspectionId },
      { id: CLOSED_TASK_ID, projectId: PROJECT_ID, description: "משימה סגורה", status: "הושלם", createdInspectionId: inspectionId },
    ]);

    await db.insert(photos).values({
      id: PHOTO_ID,
      inspectionId,
      timestamp: new Date(startTime.getTime() + 5 * 60 * 1000), // 5 minutes in
      caption: "כיתוב לדוגמה",
    });

    // Two real audio chunk files on disk, referenced by cloudFileId — exactly the shape the real sync
    // route (apps/web/app/api/sync/[entityType]) produces.
    const storage = getStorage();
    const audioId = crypto.randomUUID();
    await db.insert(audio).values({ id: audioId, inspectionId, startTime });
    await storage.put("audio-chunks/chunk0.webm", Buffer.from("chunk-zero-bytes"), "audio/webm");
    await storage.put("audio-chunks/chunk1.webm", Buffer.from("chunk-one-bytes-longer"), "audio/webm");
    await db.insert(audioChunks).values([
      {
        id: crypto.randomUUID(),
        audioId,
        inspectionId,
        sequence: 1, // deliberately inserted out of order — orchestrator must still transcribe 0 before 1
        startTime,
        floorId: FLOOR_ID,
        roomId: ROOM_ID,
        cloudFileId: "audio-chunks/chunk1.webm",
      },
      {
        id: crypto.randomUUID(),
        audioId,
        inspectionId,
        sequence: 0,
        startTime,
        floorId: null,
        roomId: null,
        cloudFileId: "audio-chunks/chunk0.webm",
      },
    ]);
  });

  it("runs the full pipeline: transcribes chunks in order, builds correct reference data, persists a completed Draft", async () => {
    const { runAiPipelineForInspection } = await import("../src/orchestrator.js");
    const { getDb, aiExtractions, inspections } = await import("@av-inspection/db");
    const { eq } = await import("drizzle-orm");

    const transcription = new FakeTranscriptionProvider();
    const expectedResult = fakeExtractionResult();
    const extraction = new FakeExtractionAgent(expectedResult);

    const result = await runAiPipelineForInspection(inspectionId, {
      transcriptionProvider: transcription,
      extractionAgent: extraction,
    });

    expect(result.extraction).toEqual(expectedResult);

    // Transcribed in sequence order (0 then 1) even though chunk 1 was inserted first.
    expect(transcription.calls).toHaveLength(2);
    expect(transcription.calls[0]).toMatchObject({ mimeType: "audio/webm", byteLength: "chunk-zero-bytes".length });
    expect(transcription.calls[1]).toMatchObject({ mimeType: "audio/webm", byteLength: "chunk-one-bytes-longer".length });
    expect(result.transcript).toContain("קטע 1");
    expect(result.transcript).toContain("קטע 2 (קומה 1 — חדר ישיבות)");

    // Reference data assembled correctly from real DB rows.
    const reference = extraction.receivedReference as {
      floors: { id: string }[];
      rooms: { id: string }[];
      contractors: { id: string; aliases: string[] }[];
      openTasks: { id: string }[];
      photos: { id: string; approxTimestampSeconds: number }[];
    };
    expect(reference.floors.map((f) => f.id)).toEqual([FLOOR_ID]);
    expect(reference.rooms.map((r) => r.id)).toEqual([ROOM_ID]);
    expect(reference.contractors).toEqual([{ id: CONTRACTOR_ID, companyName: "קבלן הבדיקה", aliases: ["הקבלן"] }]);
    expect(reference.openTasks.map((t) => t.id)).toEqual([OPEN_TASK_ID]); // closed task correctly excluded
    expect(reference.photos[0]).toMatchObject({ id: PHOTO_ID, approxTimestampSeconds: 300 });

    // Persisted for real.
    const db = getDb();
    const [extractionRow] = await db.select().from(aiExtractions).where(eq(aiExtractions.inspectionId, inspectionId));
    expect(extractionRow?.status).toBe("completed");
    expect(extractionRow?.rawExtraction).toEqual(expectedResult);
    expect(extractionRow?.completedAt).not.toBeNull();

    const [inspectionRow] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
    expect(inspectionRow?.aiStatus).toBe("הושלם");
  });

  it("marks the Draft and the inspection as failed (not silently) when the Extraction Agent throws", async () => {
    const { runAiPipelineForInspection } = await import("../src/orchestrator.js");
    const { getDb, aiExtractions, inspections } = await import("@av-inspection/db");
    const { eq } = await import("drizzle-orm");

    await expect(
      runAiPipelineForInspection(inspectionId, {
        transcriptionProvider: new FakeTranscriptionProvider(),
        extractionAgent: new FailingExtractionAgent(),
      })
    ).rejects.toThrow("simulated Claude API failure");

    const db = getDb();
    const [extractionRow] = await db.select().from(aiExtractions).where(eq(aiExtractions.inspectionId, inspectionId));
    expect(extractionRow?.status).toBe("failed");
    expect(extractionRow?.errorMessage).toContain("simulated Claude API failure");

    const [inspectionRow] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
    expect(inspectionRow?.aiStatus).toBe("שגיאה");
  });
});
