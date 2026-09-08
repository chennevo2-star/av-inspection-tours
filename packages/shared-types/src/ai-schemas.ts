import { z } from "zod";
import { IssueCategory, Priority, TaskStatus } from "./entities.js";

/**
 * Structured Extraction Agent output (spec §22, §52). See /AI_PIPELINE.md — this file is the single
 * source of truth for the schema described there; keep them in sync if either changes.
 *
 * Hard rule (spec §53, /AI_PIPELINE.md "AI never invents entities"): any *_id field the model could not
 * confidently resolve against the project's own reference data MUST be null, with needsUserReview true.
 * This is enforced by validating every response against this schema AND by only accepting ids that were
 * present in the reference data passed into the prompt — never trust an id merely because it matches the
 * UUID shape.
 */

const confidence = () => z.number().min(0).max(1);
const uuid = () => z.string().uuid();

export const Finding = z.object({
  floorId: uuid().nullable(),
  roomId: uuid().nullable(),
  category: IssueCategory.nullable(),
  subject: z.string().min(1),
  finding: z.string().min(1),
  requiredAction: z.string().nullable(),
  responsibleContractorId: uuid().nullable(),
  secondaryResponsibleContractorId: uuid().nullable(),
  priority: Priority.nullable(),
  confidence: confidence(),
  needsUserReview: z.boolean(),
});
export type Finding = z.infer<typeof Finding>;

export const TaskUpdate = z.object({
  /** Present when this is a proposed update/close of an existing task; absent for a brand-new task. */
  existingTaskId: uuid().nullable(),
  description: z.string().min(1),
  responsibleParty: z.string().nullable(),
  proposedStatus: TaskStatus.nullable(),
  evidence: z.string().min(1), // the transcript snippet the model is basing this on — required for review
  confidence: confidence(),
});
export type TaskUpdate = z.infer<typeof TaskUpdate>;

export const PhotoAssociation = z.object({
  photoId: uuid(),
  findingIndex: z.number().int().min(0), // index into InspectionExtraction.findings
  confidence: confidence(),
});
export type PhotoAssociation = z.infer<typeof PhotoAssociation>;

export const EntityMention = z.object({
  rawText: z.string().min(1),
  matchedId: uuid().nullable(),
  confidence: confidence(),
});
export type EntityMention = z.infer<typeof EntityMention>;

export const PreviousTaskUpdate = z.object({
  taskId: uuid(),
  newStatus: TaskStatus,
  evidence: z.string().min(1),
  confidence: confidence(),
});
export type PreviousTaskUpdate = z.infer<typeof PreviousTaskUpdate>;

export const InspectionExtraction = z.object({
  inspectionSummary: z.string().min(1),
  findings: z.array(Finding),
  tasks: z.array(TaskUpdate),
  photoAssociations: z.array(PhotoAssociation),
  contractorMentions: z.array(EntityMention),
  roomMentions: z.array(EntityMention),
  previousTaskUpdates: z.array(PreviousTaskUpdate),
});
export type InspectionExtraction = z.infer<typeof InspectionExtraction>;

/**
 * Guardrail helper: strips any *_id the extraction agent returned that isn't in the set of ids that were
 * actually offered to it as reference data, replacing it with null + needsUserReview=true. Call this on
 * every LLM response before it's treated as valid — schema validation alone only checks *shape*, not
 * that an id is real, so this is the second half of the "AI never invents entities" enforcement
 * described in /AI_PIPELINE.md.
 */
export function enforceKnownEntityIds(
  extraction: InspectionExtraction,
  knownIds: { floorIds: Set<string>; roomIds: Set<string>; contractorIds: Set<string> }
): InspectionExtraction {
  const cleanFinding = (f: Finding): Finding => {
    const floorOk = f.floorId === null || knownIds.floorIds.has(f.floorId);
    const roomOk = f.roomId === null || knownIds.roomIds.has(f.roomId);
    const respOk = f.responsibleContractorId === null || knownIds.contractorIds.has(f.responsibleContractorId);
    const secOk =
      f.secondaryResponsibleContractorId === null || knownIds.contractorIds.has(f.secondaryResponsibleContractorId);
    const forcedReview = !floorOk || !roomOk || !respOk || !secOk;
    return {
      ...f,
      floorId: floorOk ? f.floorId : null,
      roomId: roomOk ? f.roomId : null,
      responsibleContractorId: respOk ? f.responsibleContractorId : null,
      secondaryResponsibleContractorId: secOk ? f.secondaryResponsibleContractorId : null,
      needsUserReview: f.needsUserReview || forcedReview,
    };
  };

  return {
    ...extraction,
    findings: extraction.findings.map(cleanFinding),
    // previousTaskUpdates.taskId is validated server-side against the project's own currently-open
    // tasks (not part of `knownIds` here) — see packages/ai-pipeline's extraction service.
    previousTaskUpdates: extraction.previousTaskUpdates,
  };
}
