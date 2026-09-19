import { z } from "zod";
import { SyncStatus } from "./sync.js";

/* ------------------------------------------------------------------------------------------------
 * Shared enums (spec §29–30, §80)
 * ---------------------------------------------------------------------------------------------- */

export const IssueCategory = z.enum([
  "מסכים",
  "מערכות_ועידה",
  "מצלמות",
  "מיקרופונים",
  "רמקולים",
  "מגברים",
  "DSP",
  "תשתיות",
  "כבילה",
  "שולחנות",
  "נגרות",
  "תקשורת",
  "חשמל",
  "תוכנה",
  "בקרה",
  "התקנה",
  "גמר",
  "אחר",
]);
export type IssueCategory = z.infer<typeof IssueCategory>;

export const Priority = z.enum(["נמוכה", "רגילה", "גבוהה", "קריטית"]);
export type Priority = z.infer<typeof Priority>;

export const IssueStatus = z.enum(["חדש", "פתוח", "בבדיקה", "טופל", "נסגר"]);
export type IssueStatus = z.infer<typeof IssueStatus>;

export const TaskStatus = z.enum(["פתוח", "בטיפול", "ממתין", "הושלם", "בוטל"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const ProjectStatus = z.enum(["פעיל", "מושהה", "הסתיים", "בארכיון"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const InspectionStatus = z.enum([
  "בהכנה",
  "בתהליך",
  "הסתיים_מקומית",
  "מסתנכרן",
  "מנותח_AI",
  "ממתין_לאישור",
  "אושר",
]);
export type InspectionStatus = z.infer<typeof InspectionStatus>;

export const AiStatus = z.enum([
  "לא_רלוונטי",
  "ממתין_לסנכרון",
  "מתמלל",
  "מחלץ_ממצאים",
  "הושלם",
  "שגיאה",
]);
export type AiStatus = z.infer<typeof AiStatus>;

export const ReportStatus = z.enum(["לא_הופק", "טיוטה", "מאושר", "הופק"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

const uuid = () => z.string().uuid();
const isoDateTime = () => z.string().datetime();

/* ------------------------------------------------------------------------------------------------
 * Project (spec §Project)
 * ---------------------------------------------------------------------------------------------- */

export const Project = z.object({
  id: uuid(),
  name: z.string().min(1),
  projectNumber: z.string().nullable().default(null),
  client: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  logoCloudFileId: z.string().nullable().default(null),
  status: ProjectStatus.default("פעיל"),
  offlineReady: z.boolean().default(false), // set true once "הכן לעבודה Offline" has downloaded the bundle
  createdAt: isoDateTime(),
  updatedAt: isoDateTime(),
  syncStatus: SyncStatus.default("SYNCED"), // Projects are typically server-authored; still versioned locally
});
export type Project = z.infer<typeof Project>;

/* ------------------------------------------------------------------------------------------------
 * Floor / Room (spec §Floor, §Room)
 * ---------------------------------------------------------------------------------------------- */

export const Floor = z.object({
  id: uuid(),
  projectId: uuid(),
  name: z.string().min(1), // e.g. "קומה 30"
  floorNumber: z.number().int().nullable().default(null),
  sortOrder: z.number().int().default(0),
  syncStatus: SyncStatus.default("SYNCED"),
});
export type Floor = z.infer<typeof Floor>;

export const Room = z.object({
  id: uuid(),
  floorId: uuid(),
  name: z.string().min(1), // e.g. "חדר ישיבות גדול"
  roomNumber: z.string().nullable().default(null),
  area: z.number().nullable().default(null),
  roomType: z.string().nullable().default(null),
  syncStatus: SyncStatus.default("SYNCED"),
});
export type Room = z.infer<typeof Room>;

/* ------------------------------------------------------------------------------------------------
 * Contractor (spec §Contractor, §25 aliasing)
 * ---------------------------------------------------------------------------------------------- */

export const Contractor = z.object({
  id: uuid(),
  projectId: uuid(),
  companyName: z.string().min(1),
  field: z.string().nullable().default(null), // e.g. "אינטגרטור AV", "חשמל", "נגרות"
  contactName: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  syncStatus: SyncStatus.default("SYNCED"),
});
export type Contractor = z.infer<typeof Contractor>;

/** Alternate names/spellings that resolve to the same Contractor (spec §25 — "סינמה"/"הדסינמה"/"Hadas Cinema"). */
export const ContractorAlias = z.object({
  id: uuid(),
  contractorId: uuid(),
  alias: z.string().min(1),
});
export type ContractorAlias = z.infer<typeof ContractorAlias>;

/**
 * A cross-project "bank" of companies previously used as a Contractor on ANY project (session's user
 * request: adding a contractor to one project should also make it pickable on the next one, instead of
 * retyping the same company from scratch every time) -- same role for contractors that `Inspector` above
 * already plays for supervisors, and the same reasoning for why it's local-only (no SyncEntityType/server
 * table): it's a convenience autocomplete list, not itself a business record anything else references.
 * The REAL, synced business record stays the per-project `Contractor` row (own id, own
 * Issue.responsibleContractorId references, etc.) -- adding a project's contractor from the bank just
 * pre-fills a brand new `Contractor` row from this entry, it never reuses the bank entry's own id.
 * Deduplicated by `companyName` (createContractor()'s own upsert, see contractor-bank.ts) -- keeps this a
 * plain "have we used this company before" list rather than a fully managed directory.
 */
export const ContractorBankEntry = z.object({
  id: uuid(),
  companyName: z.string().min(1),
  field: z.string().nullable().default(null),
  contactName: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  createdAt: isoDateTime().default(() => new Date().toISOString()),
});
export type ContractorBankEntry = z.infer<typeof ContractorBankEntry>;

/**
 * A managed list of field/discipline categories (session's user request: group and filter the contractor
 * bank by קטגוריית תחום, and let the user create new categories deliberately) -- `Contractor.field` /
 * `ContractorBankEntry.field` both stay plain strings (not a foreign key) for the same reason
 * ContractorBankEntry itself doesn't reuse ids across projects: this is a convenience/organizing list, not
 * a business record other rows need to reference relationally. Same local-only reasoning as Inspector/
 * ContractorBankEntry -- pure client-side organization, nothing here needs syncing for the feature to be
 * real. Picking (or typing a new) category writes its plain `name` into the `field` string, exactly like
 * ContractorBankEntry's own "type a company not yet in the bank" flow already works.
 */
export const ContractorCategory = z.object({
  id: uuid(),
  name: z.string().min(1),
  createdAt: isoDateTime().default(() => new Date().toISOString()),
});
export type ContractorCategory = z.infer<typeof ContractorCategory>;

/* ------------------------------------------------------------------------------------------------
 * Inspector (session's user request — a reusable "bank" of supervisors/inspectors, each with an
 * embeddable stamp image that appears on a generated report's closing page). Cross-project (like the
 * office itself, an inspector works across many projects, not just one) — the only entity in this app
 * that isn't scoped to a Project. Deliberately local-only for now (no SyncEntityType/server table): the
 * report pipeline that consumes it already runs fully offline from local IndexedDB, so cloud sync of the
 * bank itself isn't required for the feature to be real and working — extendable later without changing
 * this shape. `Inspection.inspectorId` below is still a real synced field (see entities.ts's own
 * Inspection def) even though the Inspector record it points at doesn't sync itself.
 * ---------------------------------------------------------------------------------------------- */

export const Inspector = z.object({
  id: uuid(),
  name: z.string().min(1),
  stampLocalFileId: z.string().nullable().default(null), // Dexie blob-table key; null until a stamp is uploaded
  createdAt: isoDateTime().default(() => new Date().toISOString()),
});
export type Inspector = z.infer<typeof Inspector>;

/**
 * Fixed set of tour disciplines (user request: "הוסף לכל סיור את קטגוריית הסיור") -- deliberately a
 * closed enum, not an editable bank like ContractorCategory: the user gave exactly these three and never
 * asked for a "create new category" flow the way they did for contractors. Drives both the checkbox list
 * shown when starting a tour and the generated tour name (see format-tour-name.ts).
 */
export const TourCategory = z.enum(["מולטימדיה", "תקשורת", "ביטחון"]);
export type TourCategory = z.infer<typeof TourCategory>;

/* ------------------------------------------------------------------------------------------------
 * Inspection (spec §Inspection)
 * ---------------------------------------------------------------------------------------------- */

export const Inspection = z.object({
  id: uuid(),
  projectId: uuid(),
  inspectionNumber: z.number().int().min(1),
  date: z.string().date(),
  startTime: isoDateTime(),
  endTime: isoDateTime().nullable().default(null), // null while the tour is in progress — drives Recovery (spec §44)
  inspector: z.string().min(1),
  /** Which Inspector-bank record this tour's inspector was picked from, if any (session's user request)
   * — null for an ad-hoc name typed free-text, or for tours predating this feature. This is what the
   * report screen uses to look up a stamp image; `inspector` above stays the plain display name either
   * way, so every existing read site keeps working unchanged. */
  inspectorId: uuid().nullable().default(null),
  participants: z.array(z.string()).default([]),
  status: InspectionStatus.default("בתהליך"),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
  aiStatus: AiStatus.default("לא_רלוונטי"),
  reportStatus: ReportStatus.default("לא_הופק"),
  /** The report screen's free-text "כללי"/"סיכום" fields (session's user request: these must actually
   * persist and auto-save, not just live as a transient draft in the report screen's own React state --
   * see assemble-report-data.ts's own comment for the bug this closes). Both null until the report screen
   * is opened and something is typed. */
  generalText: z.string().nullable().default(null),
  summaryText: z.string().nullable().default(null),
  /** The tour's discipline(s) (user request), chosen when the tour is started -- drives the generated
   * tour name (format-tour-name.ts). Empty for tours created before this feature existed; the name
   * formatter falls back to omitting the category segment entirely in that case. */
  categories: z.array(TourCategory).default([]),
});
export type Inspection = z.infer<typeof Inspection>;

/**
 * Timeline event recorded when the inspector changes room/floor or performs a notable action, used to
 * align the transcript to room/floor/photo context by timestamp (spec §12).
 *
 * `sequence` (not in the original spec) was added after a real bug: two events logged in quick
 * succession (e.g. picking a floor and its room from one combined action) can land on the exact same
 * millisecond, making `timestamp` alone an unreliable sort key — `getCurrentPosition()`
 * (apps/web/lib/db/context-events.ts) needs unambiguous ordering to reconstruct "where is the inspector
 * right now" correctly, including for Recovery (spec §44). `timestamp` remains the wall-clock value the
 * AI pipeline aligns the transcript against; `sequence` exists purely to break ties correctly.
 */
export const ContextEvent = z.object({
  id: uuid(),
  inspectionId: uuid(),
  sequence: z.number().int().min(0),
  type: z.enum(["enter_floor", "enter_room", "photo_captured", "recording_started", "recording_paused", "recording_resumed", "recording_interrupted"]),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  refId: uuid().nullable().default(null), // e.g. the Photo id for a photo_captured event
  timestamp: isoDateTime(),
});
export type ContextEvent = z.infer<typeof ContextEvent>;

/* ------------------------------------------------------------------------------------------------
 * Note — not in the spec's own §5 entity list, but §10's field UI explicitly requires a "📝 הערה"
 * quick-action alongside ⚠️ ליקוי / ✅ משימה, and there's nowhere in the original entity list for a
 * quick free-text field note to live. Added here as the minimal honest backing for that button — a
 * timestamped, room/floor/inspection-scoped text note, structurally identical in spirit to Issue/Task
 * but without their workflow fields (status/priority/contractor) since a note isn't a tracked item.
 * ---------------------------------------------------------------------------------------------- */

export const Note = z.object({
  id: uuid(),
  inspectionId: uuid(),
  projectId: uuid(),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  text: z.string().min(1),
  timestamp: isoDateTime(),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Note = z.infer<typeof Note>;

/* ------------------------------------------------------------------------------------------------
 * Issue / Finding (spec §Issue)
 * ---------------------------------------------------------------------------------------------- */

export const Issue = z.object({
  id: uuid(),
  inspectionId: uuid(),
  projectId: uuid(),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  friendlyNumber: z.number().int().nullable().default(null), // display-only, e.g. #001 — never the join key
  category: IssueCategory.nullable().default(null),
  subject: z.string().min(1),
  finding: z.string().min(1),
  requiredAction: z.string().nullable().default(null),
  responsibleContractorId: uuid().nullable().default(null),
  secondaryResponsibleContractorId: uuid().nullable().default(null),
  priority: Priority.nullable().default(null),
  status: IssueStatus.default("חדש"),
  dueDate: z.string().date().nullable().default(null),
  source: z.enum(["manual", "ai_extracted"]).default("manual"),
  needsUserReview: z.boolean().default(false), // true when AI left a field null / low-confidence (spec §53)
  timestamp: isoDateTime(),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Issue = z.infer<typeof Issue>;

/* ------------------------------------------------------------------------------------------------
 * Task (spec §Task)
 * ---------------------------------------------------------------------------------------------- */

export const Task = z.object({
  id: uuid(),
  issueId: uuid().nullable().default(null),
  projectId: uuid(),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  friendlyNumber: z.number().int().nullable().default(null),
  description: z.string().min(1),
  responsibleParty: z.string().nullable().default(null),
  status: TaskStatus.default("פתוח"),
  createdInspectionId: uuid(),
  lastUpdatedInspectionId: uuid().nullable().default(null),
  closedInspectionId: uuid().nullable().default(null),
  dueDate: z.string().date().nullable().default(null),
  timestamp: isoDateTime().default(() => new Date().toISOString()), // when the task was created — drives "most recent first" ordering
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Task = z.infer<typeof Task>;

/* ------------------------------------------------------------------------------------------------
 * Photo (spec §Photo)
 * ---------------------------------------------------------------------------------------------- */

export const Photo = z.object({
  id: uuid(),
  inspectionId: uuid(),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  issueId: uuid().nullable().default(null),
  taskId: uuid().nullable().default(null),
  timestamp: isoDateTime(),
  caption: z.string().nullable().default(null),
  localFileId: z.string(), // Dexie blob-table key
  cloudFileId: z.string().nullable().default(null),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Photo = z.infer<typeof Photo>;

/* ------------------------------------------------------------------------------------------------
 * Audio (spec §Audio, §11 chunking)
 * ---------------------------------------------------------------------------------------------- */

export const Audio = z.object({
  id: uuid(),
  inspectionId: uuid(),
  startTime: isoDateTime(),
  endTime: isoDateTime().nullable().default(null),
  transcriptionStatus: z.enum(["לא_רלוונטי", "ממתין", "בתהליך", "הושלם", "שגיאה"]).default("לא_רלוונטי"),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Audio = z.infer<typeof Audio>;

/** One persisted chunk of a recording (spec §11, §78 — persisted as it's recorded, not only at the end). */
export const AudioChunk = z.object({
  id: uuid(),
  audioId: uuid(),
  inspectionId: uuid(),
  sequence: z.number().int().min(0),
  startTime: isoDateTime(),
  endTime: isoDateTime().nullable().default(null),
  floorId: uuid().nullable().default(null), // context at time of recording, for later transcript alignment
  roomId: uuid().nullable().default(null),
  localFileId: z.string(),
  cloudFileId: z.string().nullable().default(null),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type AudioChunk = z.infer<typeof AudioChunk>;

/* ------------------------------------------------------------------------------------------------
 * Attachment (Microsoft 365 offline upgrade, 2026-09-18 — a generic file attached to a visit, distinct
 * from Photo/Audio which are their own first-class entities with their own workflows). This entity type
 * had actually been reserved in SyncEntityType/SYNC_ENTITY_PRIORITY (sync.ts) since the original Phase 1
 * design — "Attachment" was already declared there, and the sync queue's drain order already accounted
 * for it — but no concrete Zod shape, Dexie table, or server table was ever built to back it. This closes
 * that gap; it doesn't introduce a new mechanism, it finishes wiring one that was already half-built.
 * ---------------------------------------------------------------------------------------------- */

export const Attachment = z.object({
  id: uuid(),
  inspectionId: uuid(),
  floorId: uuid().nullable().default(null),
  roomId: uuid().nullable().default(null),
  taskId: uuid().nullable().default(null), // e.g. a spec sheet or a signed form attached to a specific task
  fileName: z.string().min(1), // the user-facing name (also used to derive the Microsoft 365 file name)
  mimeType: z.string().min(1),
  timestamp: isoDateTime(),
  localFileId: z.string(), // Dexie blob-table key
  cloudFileId: z.string().nullable().default(null),
  syncStatus: SyncStatus.default("LOCAL_ONLY"),
});
export type Attachment = z.infer<typeof Attachment>;
