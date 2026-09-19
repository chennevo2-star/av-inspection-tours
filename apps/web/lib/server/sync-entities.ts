import {
  Audio,
  Contractor,
  ContractorAlias,
  Floor,
  Inspection,
  Issue,
  Note,
  Project,
  Room,
  Task,
} from "@av-inspection/shared-types";
import {
  audio,
  contractorAliases,
  contractors,
  floors,
  getDb,
  inspections,
  issues,
  notes,
  projects,
  rooms,
  tasks,
} from "@av-inspection/db";

/**
 * Server-side upsert handlers for every JSON (non-file) sync entity type. Idempotent by design — a
 * retried "create" of an already-confirmed row is a no-op update to the same values, never a duplicate
 * (spec §17, OFFLINE_SYNC.md). Photo/AudioChunk are handled separately in the route itself (multipart,
 * needs @av-inspection/storage) — they're not in this table.
 */
export interface JsonSyncHandler {
  /** Validates the raw request body against this entity's Zod schema, then upserts it. Throws
   * (ZodError or otherwise) on invalid input — the route maps that to a 400, not a 500. */
  upsert(rawPayload: unknown): Promise<void>;
}

const isoToDate = (iso: string) => new Date(iso);

/**
 * `table: any` is a deliberate, narrow boundary: each Drizzle PgTable has a structurally distinct
 * generic type, and fighting Drizzle's generics to unify them behind one shared helper isn't worth it
 * for glue code this small — the real input-safety boundary is `schema.parse()` below, which runs before
 * any of this. Every call site is still fully typed on the entity side (`T`).
 */
function handler<T extends { id: string }>(
  schema: { parse: (input: unknown) => T },
  table: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  toRow: (entity: T) => Record<string, unknown>
): JsonSyncHandler {
  return {
    async upsert(rawPayload: unknown) {
      const entity = schema.parse(rawPayload);
      const row = toRow(entity);
      await getDb().insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row });
    },
  };
}

export const JSON_SYNC_HANDLERS: Partial<Record<string, JsonSyncHandler>> = {
  Project: handler(Project, projects, (p) => ({
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    client: p.client,
    address: p.address,
    description: p.description,
    logoCloudFileId: p.logoCloudFileId,
    status: p.status,
    createdAt: isoToDate(p.createdAt),
    updatedAt: isoToDate(p.updatedAt),
  })),

  Floor: handler(Floor, floors, (f) => ({
    id: f.id,
    projectId: f.projectId,
    name: f.name,
    floorNumber: f.floorNumber,
    sortOrder: f.sortOrder,
  })),

  Room: handler(Room, rooms, (r) => ({
    id: r.id,
    floorId: r.floorId,
    name: r.name,
    roomNumber: r.roomNumber,
    area: r.area,
    roomType: r.roomType,
  })),

  Contractor: handler(Contractor, contractors, (c) => ({
    id: c.id,
    projectId: c.projectId,
    companyName: c.companyName,
    field: c.field,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
  })),

  ContractorAlias: handler(ContractorAlias, contractorAliases, (a) => ({
    id: a.id,
    contractorId: a.contractorId,
    alias: a.alias,
  })),

  Inspection: handler(Inspection, inspections, (i) => ({
    id: i.id,
    projectId: i.projectId,
    inspectionNumber: i.inspectionNumber,
    date: i.date,
    startTime: isoToDate(i.startTime),
    endTime: i.endTime ? isoToDate(i.endTime) : null,
    inspector: i.inspector,
    inspectorId: i.inspectorId,
    participants: i.participants,
    status: i.status,
    aiStatus: i.aiStatus,
    reportStatus: i.reportStatus,
    generalText: i.generalText,
    summaryText: i.summaryText,
    categories: i.categories,
  })),

  Issue: handler(Issue, issues, (i) => ({
    id: i.id,
    inspectionId: i.inspectionId,
    projectId: i.projectId,
    floorId: i.floorId,
    roomId: i.roomId,
    friendlyNumber: i.friendlyNumber,
    category: i.category,
    subject: i.subject,
    finding: i.finding,
    requiredAction: i.requiredAction,
    responsibleContractorId: i.responsibleContractorId,
    secondaryResponsibleContractorId: i.secondaryResponsibleContractorId,
    priority: i.priority,
    status: i.status,
    dueDate: i.dueDate,
    source: i.source,
    needsUserReview: i.needsUserReview,
    timestamp: isoToDate(i.timestamp),
  })),

  Task: handler(Task, tasks, (t) => ({
    id: t.id,
    issueId: t.issueId,
    projectId: t.projectId,
    floorId: t.floorId,
    roomId: t.roomId,
    friendlyNumber: t.friendlyNumber,
    description: t.description,
    responsibleParty: t.responsibleParty,
    status: t.status,
    createdInspectionId: t.createdInspectionId,
    lastUpdatedInspectionId: t.lastUpdatedInspectionId,
    closedInspectionId: t.closedInspectionId,
    dueDate: t.dueDate,
    timestamp: isoToDate(t.timestamp),
  })),

  Note: handler(Note, notes, (n) => ({
    id: n.id,
    inspectionId: n.inspectionId,
    projectId: n.projectId,
    floorId: n.floorId,
    roomId: n.roomId,
    text: n.text,
    timestamp: isoToDate(n.timestamp),
  })),

  // Must be synced before AudioChunk — see SYNC_ENTITY_PRIORITY's comment (shared-types/sync.ts) for
  // the real bug this fixed (every AudioChunk permanently failing its FK check).
  Audio: handler(Audio, audio, (a) => ({
    id: a.id,
    inspectionId: a.inspectionId,
    startTime: isoToDate(a.startTime),
    endTime: a.endTime ? isoToDate(a.endTime) : null,
    transcriptionStatus: a.transcriptionStatus,
  })),
};
