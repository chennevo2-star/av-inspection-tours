import { Issue, IssueCategory, Priority } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export interface CreateIssueInput {
  subject: string;
  finding: string;
  category?: IssueCategory | null;
  priority?: Priority | null;
  requiredAction?: string | null;
}

/** Quick field-created issue (spec §10 "⚠️ ליקוי"). Contractor assignment is left null here on
 * purpose — that's an AI-suggested-then-user-confirmed step (Phase 5/6), not something to force during
 * the tour itself when the inspector is trying to move fast. */
export async function createIssue(
  inspectionId: string,
  projectId: string,
  ctx: { floorId?: string | null; roomId?: string | null },
  input: CreateIssueInput
): Promise<Issue> {
  const db = getLocalDb();
  const existingCount = await db.issues.where("projectId").equals(projectId).count();

  const issue = Issue.parse({
    id: crypto.randomUUID(),
    inspectionId,
    projectId,
    floorId: ctx.floorId ?? null,
    roomId: ctx.roomId ?? null,
    friendlyNumber: existingCount + 1,
    category: input.category ?? null,
    subject: input.subject,
    finding: input.finding,
    requiredAction: input.requiredAction ?? null,
    responsibleContractorId: null,
    secondaryResponsibleContractorId: null,
    priority: input.priority ?? null,
    status: "חדש",
    dueDate: null,
    source: "manual",
    needsUserReview: false,
    timestamp: new Date().toISOString(),
    syncStatus: "LOCAL_ONLY",
  });
  await db.issues.add(issue);
  await enqueueSync("Issue", issue.id, "create", issue);
  return issue;
}

export async function listIssues(inspectionId: string): Promise<Issue[]> {
  const issues = await getLocalDb().issues.where("inspectionId").equals(inspectionId).toArray();
  return issues.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
