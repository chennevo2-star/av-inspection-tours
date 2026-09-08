import { and, eq, inArray } from "drizzle-orm";
import {
  aiExtractions,
  audioChunks,
  contractorAliases,
  contractors,
  floors,
  getDb,
  inspections,
  photos,
  projects,
  rooms,
  tasks,
} from "@av-inspection/db";
import { getStorage } from "@av-inspection/storage";
import type { InspectionExtraction } from "@av-inspection/shared-types";
import type { TranscriptionProvider } from "./transcription/types.js";
import type { ExtractionAgent } from "./extraction/extraction-agent.js";
import type { ExtractionReferenceData } from "./extraction/reference-data.js";

export interface AiPipelineDeps {
  transcriptionProvider: TranscriptionProvider;
  extractionAgent: ExtractionAgent;
}

export interface AiPipelineResult {
  extractionRowId: string;
  transcript: string;
  extraction: InspectionExtraction;
}

/**
 * Runs the full pipeline for one already-synced inspection (spec §22, AI_PIPELINE.md): transcribe every
 * audio chunk → assemble the project's own reference data → run the Extraction Agent → persist a Draft
 * (ai_extractions row) → update Inspection.aiStatus. Never writes to Issue/Task/Note/Photo directly —
 * that only happens once a human approves the draft (Phase 6, not built yet); this function's whole
 * output is the Draft itself.
 */
export async function runAiPipelineForInspection(
  inspectionId: string,
  deps: AiPipelineDeps
): Promise<AiPipelineResult> {
  const db = getDb();

  const [inspectionRow] = await db.select().from(inspections).where(eq(inspections.id, inspectionId));
  if (!inspectionRow) throw new Error(`Inspection ${inspectionId} not found`);

  const [projectRow] = await db.select().from(projects).where(eq(projects.id, inspectionRow.projectId));
  if (!projectRow) throw new Error(`Project ${inspectionRow.projectId} not found`);

  const [extractionRow] = await db
    .insert(aiExtractions)
    .values({ id: crypto.randomUUID(), inspectionId, status: "processing" })
    .returning();
  if (!extractionRow) throw new Error("Failed to create ai_extractions row");

  try {
    await db.update(inspections).set({ aiStatus: "מתמלל" }).where(eq(inspections.id, inspectionId));
    const transcript = await transcribeInspection(inspectionId, deps.transcriptionProvider);

    await db.update(inspections).set({ aiStatus: "מחלץ_ממצאים" }).where(eq(inspections.id, inspectionId));
    const reference = await buildReferenceData(inspectionRow.projectId, inspectionId, inspectionRow, projectRow.name);
    const extraction = await deps.extractionAgent.extract(transcript, reference);

    await db
      .update(aiExtractions)
      .set({
        status: "completed",
        transcript,
        rawExtraction: extraction,
        completedAt: new Date(),
      })
      .where(eq(aiExtractions.id, extractionRow.id));
    await db.update(inspections).set({ aiStatus: "הושלם" }).where(eq(inspections.id, inspectionId));

    return { extractionRowId: extractionRow.id, transcript, extraction };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(aiExtractions)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(aiExtractions.id, extractionRow.id));
    await db.update(inspections).set({ aiStatus: "שגיאה" }).where(eq(inspections.id, inspectionId));
    throw err;
  }
}

/**
 * Transcribes every audio chunk in sequence order and joins them into one transcript, each block labeled
 * with its own floor/room context (resolved from the chunk's own floorId/roomId) — cheap, reliable
 * alignment signal for the Extraction Agent's prompt without needing timestamp-precise correlation.
 */
async function transcribeInspection(inspectionId: string, provider: TranscriptionProvider): Promise<string> {
  const chunks = await selectAudioChunksOrdered(inspectionId);
  if (chunks.length === 0) return "";

  const storage = getStorage();
  const floorNames = new Map((await getDb().select().from(floors)).map((f) => [f.id, f.name]));
  const roomNames = new Map((await getDb().select().from(rooms)).map((r) => [r.id, r.name]));

  const blocks: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.cloudFileId) continue; // not yet uploaded — skip rather than fail the whole pipeline
    const bytes = await storage.get(chunk.cloudFileId);
    const mimeType = mimeTypeFromKey(chunk.cloudFileId);
    const result = await provider.transcribe(bytes, mimeType);

    const floorLabel = chunk.floorId ? floorNames.get(chunk.floorId) ?? "" : "";
    const roomLabel = chunk.roomId ? roomNames.get(chunk.roomId) ?? "" : "";
    const contextLabel = [floorLabel, roomLabel].filter(Boolean).join(" — ");
    const header = contextLabel ? `--- קטע ${chunk.sequence + 1} (${contextLabel}) ---` : `--- קטע ${chunk.sequence + 1} ---`;
    blocks.push(`${header}\n${result.text}`);
  }

  return blocks.join("\n\n");
}

async function selectAudioChunksOrdered(inspectionId: string) {
  const rows = await getDb().select().from(audioChunks).where(eq(audioChunks.inspectionId, inspectionId));
  return [...rows].sort((a, b) => a.sequence - b.sequence);
}

function mimeTypeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };
  return map[ext ?? ""] ?? "application/octet-stream";
}

async function buildReferenceData(
  projectId: string,
  inspectionId: string,
  inspectionRow: { startTime: Date },
  projectName: string
): Promise<ExtractionReferenceData> {
  const db = getDb();

  const floorRows = await db.select().from(floors).where(eq(floors.projectId, projectId));
  const floorIds = floorRows.map((f) => f.id);
  const roomRows = floorIds.length > 0 ? await db.select().from(rooms).where(inArray(rooms.floorId, floorIds)) : [];

  const contractorRows = await db.select().from(contractors).where(eq(contractors.projectId, projectId));
  const contractorIds = contractorRows.map((c) => c.id);
  const aliasRows =
    contractorIds.length > 0
      ? await db.select().from(contractorAliases).where(inArray(contractorAliases.contractorId, contractorIds))
      : [];
  const aliasesByContractor = new Map<string, string[]>();
  for (const alias of aliasRows) {
    const list = aliasesByContractor.get(alias.contractorId) ?? [];
    list.push(alias.alias);
    aliasesByContractor.set(alias.contractorId, list);
  }

  const openTaskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.status, ["פתוח", "בטיפול", "ממתין"])));

  const photoRows = await db.select().from(photos).where(eq(photos.inspectionId, inspectionId));

  return {
    projectName,
    floors: floorRows.map((f) => ({ id: f.id, name: f.name })),
    rooms: roomRows.map((r) => ({ id: r.id, name: r.name, floorId: r.floorId })),
    contractors: contractorRows.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      aliases: aliasesByContractor.get(c.id) ?? [],
    })),
    openTasks: openTaskRows.map((t) => ({ id: t.id, friendlyNumber: t.friendlyNumber, description: t.description })),
    photos: photoRows.map((p) => ({
      id: p.id,
      caption: p.caption,
      approxTimestampSeconds: (p.timestamp.getTime() - inspectionRow.startTime.getTime()) / 1000,
    })),
  };
}
