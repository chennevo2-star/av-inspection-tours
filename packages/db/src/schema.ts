import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Server-side Postgres schema (Drizzle ORM), mirroring packages/shared-types/src/entities.ts.
 * See ARCHITECTURE.md, ADR-002/003/005. Every table's primary key is a client-generated UUID — never
 * a serial/identity column — because sync identity must be assignable offline, on-device, before the
 * row has ever reached the server (spec §6).
 *
 * Not yet run against a live Postgres instance in this environment — see the note in drizzle.config.ts.
 *
 * Note on `syncStatus`: the shared-types entity shapes include a `syncStatus` field because that's a
 * *client-local* concept (LOCAL_ONLY/WAITING_FOR_SYNC/UPLOADING/SYNC_ERROR describe a row's journey from
 * device to server). A row that exists in this Postgres schema is by definition already confirmed
 * (`SYNCED`) from the server's point of view, so these tables intentionally do not carry a sync_status
 * column — don't add one here; sync status belongs in apps/web/lib/db (IndexedDB) and the sync queue.
 */

export const syncStatusEnum = pgEnum("sync_status", [
  "LOCAL_ONLY",
  "WAITING_FOR_SYNC",
  "UPLOADING",
  "SYNCED",
  "SYNC_ERROR",
]);

export const projectStatusEnum = pgEnum("project_status", ["פעיל", "מושהה", "הסתיים", "בארכיון"]);

export const inspectionStatusEnum = pgEnum("inspection_status", [
  "בהכנה",
  "בתהליך",
  "הסתיים_מקומית",
  "מסתנכרן",
  "מנותח_AI",
  "ממתין_לאישור",
  "אושר",
]);

export const aiStatusEnum = pgEnum("ai_status", [
  "לא_רלוונטי",
  "ממתין_לסנכרון",
  "מתמלל",
  "מחלץ_ממצאים",
  "הושלם",
  "שגיאה",
]);

export const reportStatusEnum = pgEnum("report_status", ["לא_הופק", "טיוטה", "מאושר", "הופק"]);

export const issueStatusEnum = pgEnum("issue_status", ["חדש", "פתוח", "בבדיקה", "טופל", "נסגר"]);

export const taskStatusEnum = pgEnum("task_status", ["פתוח", "בטיפול", "ממתין", "הושלם", "בוטל"]);

export const priorityEnum = pgEnum("priority", ["נמוכה", "רגילה", "גבוהה", "קריטית"]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  projectNumber: text("project_number"),
  client: text("client"),
  address: text("address"),
  description: text("description"),
  logoCloudFileId: text("logo_cloud_file_id"),
  status: projectStatusEnum("status").notNull().default("פעיל"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const floors = pgTable("floors", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  floorNumber: integer("floor_number"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey(),
  floorId: uuid("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  roomNumber: text("room_number"),
  area: doublePrecision("area"),
  roomType: text("room_type"),
});

export const contractors = pgTable("contractors", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  field: text("field"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
});

export const contractorAliases = pgTable("contractor_aliases", {
  id: uuid("id").primaryKey(),
  contractorId: uuid("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
});

export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inspectionNumber: integer("inspection_number").notNull(),
  date: date("date").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  inspector: text("inspector").notNull(),
  // No FK: the Inspector "bank" (packages/shared-types Inspector) is deliberately local-only for now
  // (see its own doc comment) -- this is just a loose id, not a real referenced table server-side yet.
  inspectorId: uuid("inspector_id"),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  status: inspectionStatusEnum("status").notNull().default("בתהליך"),
  aiStatus: aiStatusEnum("ai_status").notNull().default("לא_רלוונטי"),
  reportStatus: reportStatusEnum("report_status").notNull().default("לא_הופק"),
});

export const contextEvents = pgTable("context_events", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), // tie-breaker for same-millisecond events — see shared-types
  type: text("type").notNull(), // enter_floor | enter_room | photo_captured | recording_* — see shared-types
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  refId: uuid("ref_id"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
});

/** Note — see shared-types/src/entities.ts's Note comment for why this exists beyond the original §5 list. */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  text: text("text").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
});

export const issues = pgTable("issues", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  friendlyNumber: integer("friendly_number"),
  category: text("category"),
  subject: text("subject").notNull(),
  finding: text("finding").notNull(),
  requiredAction: text("required_action"),
  responsibleContractorId: uuid("responsible_contractor_id").references(() => contractors.id),
  secondaryResponsibleContractorId: uuid("secondary_responsible_contractor_id").references(() => contractors.id),
  priority: priorityEnum("priority"),
  status: issueStatusEnum("status").notNull().default("חדש"),
  dueDate: date("due_date"),
  source: text("source").notNull().default("manual"), // 'manual' | 'ai_extracted'
  needsUserReview: boolean("needs_user_review").notNull().default(false),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  issueId: uuid("issue_id").references(() => issues.id),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  friendlyNumber: integer("friendly_number"),
  description: text("description").notNull(),
  responsibleParty: text("responsible_party"),
  status: taskStatusEnum("status").notNull().default("פתוח"),
  createdInspectionId: uuid("created_inspection_id").notNull().references(() => inspections.id),
  lastUpdatedInspectionId: uuid("last_updated_inspection_id").references(() => inspections.id),
  closedInspectionId: uuid("closed_inspection_id").references(() => inspections.id),
  dueDate: date("due_date"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const photos = pgTable("photos", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  issueId: uuid("issue_id").references(() => issues.id),
  taskId: uuid("task_id").references(() => tasks.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  caption: text("caption"),
  cloudFileId: text("cloud_file_id"), // object-storage key; never stored inline in Postgres
});

export const audio = pgTable("audio", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  transcriptionStatus: text("transcription_status").notNull().default("לא_רלוונטי"),
});

export const audioChunks = pgTable("audio_chunks", {
  id: uuid("id").primaryKey(),
  audioId: uuid("audio_id").notNull().references(() => audio.id, { onDelete: "cascade" }),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  cloudFileId: text("cloud_file_id"),
});

/**
 * A generic file attached to a visit (spec: "קבצים מצורפים"), distinct from Photo/Audio. `SyncEntityType`
 * already reserved "Attachment" (see shared-types/src/sync.ts's own comment) since the original Phase 1
 * design, but this table never existed until the Microsoft 365 offline upgrade — closing a real,
 * pre-existing gap, not introducing a new mechanism.
 */
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  floorId: uuid("floor_id").references(() => floors.id),
  roomId: uuid("room_id").references(() => rooms.id),
  taskId: uuid("task_id").references(() => tasks.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  cloudFileId: text("cloud_file_id"),
});

export const aiExtractionStatusEnum = pgEnum("ai_extraction_status", [
  "processing",
  "completed",
  "failed",
]);

/**
 * Small shared key/value store for settings that must be the same for every device/team member (unlike
 * apps/web/lib/db/settings.ts, which is a PER-DEVICE IndexedDB preference store) -- e.g. the SharePoint
 * folder picked via the storage settings screen (packages/storage's `MsGraphStorage` reads it as an
 * override for the env-var-configured default). Deliberately generic (one row per key) rather than a
 * dedicated column/table per setting, since this is expected to grow with a handful more similarly-shaped
 * settings over time, not warrant its own migration each time.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One AI-pipeline run for an inspection (spec §22–23, AI_PIPELINE.md). `rawExtraction` is the validated
 * (schema-checked + enforceKnownEntityIds-guarded) InspectionExtraction JSON — always a Draft, never
 * auto-applied (spec §23). Multiple rows per inspection are allowed (e.g. a re-run after a failure); the
 * most recent `completed` row is the one Phase 6's review screen would show. Server-only — never synced
 * from a client, so it has no SyncEntityType/client-side counterpart.
 */
export const aiExtractions = pgTable("ai_extractions", {
  id: uuid("id").primaryKey(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  status: aiExtractionStatusEnum("status").notNull().default("processing"),
  transcript: text("transcript"),
  rawExtraction: jsonb("raw_extraction"),
  errorMessage: text("error_message"),
  transcriptionModel: text("transcription_model"),
  extractionModel: text("extraction_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
