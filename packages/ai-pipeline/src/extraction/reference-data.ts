/**
 * The project's own reference data, assembled by the orchestrator (src/orchestrator.ts) from Postgres
 * and handed to the Extraction Agent's prompt — this is what "AI never invents entities" (spec §53,
 * AI_PIPELINE.md) is actually enforced against: only ids that appear here are ever accepted back.
 */
export interface ReferenceFloor {
  id: string;
  name: string;
}

export interface ReferenceRoom {
  id: string;
  name: string;
  floorId: string;
}

export interface ReferenceContractor {
  id: string;
  companyName: string;
  aliases: string[];
}

export interface ReferenceOpenTask {
  id: string;
  friendlyNumber: number | null;
  description: string;
}

export interface ReferencePhoto {
  id: string;
  caption: string | null;
  /** Seconds since the inspection's own startTime — cheap, timezone-safe alignment hint for the prompt. */
  approxTimestampSeconds: number;
}

export interface ExtractionReferenceData {
  projectName: string;
  floors: ReferenceFloor[];
  rooms: ReferenceRoom[];
  contractors: ReferenceContractor[];
  openTasks: ReferenceOpenTask[];
  photos: ReferencePhoto[];
}
