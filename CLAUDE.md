# CLAUDE.md — AV Inspection Tours

## 1. Project overview

Offline-first system for supervisory AV/multimedia inspection tours (סיורי פיקוח עליון בתחום המולטימדיה).
An inspector walks a site (office, hotel, venue) on a phone/tablet/laptop, records audio continuously,
takes photos, opens issues/tasks, and moves between floors/rooms — **all of it must work with zero
network connectivity**. After the tour, once the device is back online, audio/photos/notes sync to the
cloud, an AI pipeline transcribes + extracts structured findings, the inspector reviews/edits an AI draft,
and only then approves generation of a Hebrew RTL Word (DOCX) report and a PDF derived from it.

This is a **separate, independent project from CN AV Planner**. Do not import code, conventions, or
assumptions from that repo. If you are an agent that also has memory of CN AV Planner, treat that as
unrelated background — nothing here inherits its architecture.

## 2. Non-negotiable architecture principle

**Offline-first, not online-with-offline-support.** Every field action (photo, note, issue, room/floor
change, start/stop recording, finish inspection) must complete against local storage only, instantly,
with no network call in its critical path. The network is only for: cloud sync, AI processing, and
document generation. See [OFFLINE_SYNC.md](OFFLINE_SYNC.md).

## 3. Repository layout

```
apps/
  web/                  Next.js 14 App Router — PWA shell, mobile field UI, desktop admin UI, API routes
packages/
  shared-types/         Zod schemas + TS types for every entity (source of truth for validation)
  db/                   Postgres schema (Drizzle ORM) + migrations — server-side persistence
  sync-engine/          Client sync queue: state machine, retry/resume logic (framework-agnostic, testable without a browser)
  ai-pipeline/          Transcription / Structured Extraction / Report Writing agents (server-side)
  report-generator/     DOCX generation (docx lib) + DOCX→PDF conversion + report QA checks
docs/
  decisions/            ADRs — read before changing any technology choice (see rule in §8)
.claude/
  agents/               Sub-agent definitions (Investigator, Builder, Reviewer, Offline-Sync, Report, AI Processing)
CLAUDE.md, ARCHITECTURE.md, OFFLINE_SYNC.md, REPORTING.md, AI_PIPELINE.md, TESTING.md
```

## 4. Coding standards

- TypeScript everywhere, `strict: true`. No `any` without a comment explaining why.
- Every entity has a client-generated **UUID** (crypto.randomUUID()), never a server auto-increment as
  the sync key. See ARCHITECTURE.md §Entities.
- Zod schemas in `packages/shared-types` are the single source of truth for entity shape; the Postgres
  schema (Drizzle) and the IndexedDB schema (Dexie) both derive from / are kept in lockstep with them.
- Local writes (IndexedDB) are always synchronous-feeling: write local → enqueue sync → return to the UI.
  Never `await` a network call before a local mutation is visible to the user.
- No feature is "done" if it only works online. If you cannot test it with the network off, it is not
  done.

## 5. Testing commands

```
npm run test          # vitest run (all packages)
npm run test:watch    # vitest watch mode
npm run typecheck     # tsc --noEmit across workspaces
npm run dev           # apps/web dev server
```

See [TESTING.md](TESTING.md) for the offline-scenario test matrix (Playwright, network emulation).

## 6. Sub-agent responsibilities

Defined in `.claude/agents/`. Summary — see each file for full scope:

| Agent | Scope | Touches code? |
|---|---|---|
| `investigator` | Find files, explain architecture, locate dependencies, diagnose bugs | No, unless explicitly asked |
| `builder` | Implementation, patches, targeted refactors | Yes |
| `reviewer` | Diff review — regressions, security, correctness, architecture violations | No |
| `offline-sync` | IndexedDB, Service Worker, sync queue, conflict resolution, resumable uploads, recovery | Yes, scoped to sync/offline code |
| `report-agent` | DOCX/PDF generation, RTL, Hebrew, tables, images, templates | Yes, scoped to `packages/report-generator` |
| `ai-processing` | Transcription pipeline, extraction, contractor/room/task matching | Yes, scoped to `packages/ai-pipeline` |

Give each sub-agent only the files/requirements/errors relevant to its task — not the whole repo.

## 7. Prohibited actions

- Do not make any field action (photo/note/issue/room-change/recording) depend on network availability.
- Do not delete local data before the server has confirmed receipt (see OFFLINE_SYNC.md §Data-loss rule).
- Do not let AI auto-finalize or auto-send a report. AI output is always a draft pending human review
  (AI_PIPELINE.md §Human in the loop).
- Do not invent contractors/rooms/floors in AI extraction — unresolved references must come back as
  `null` + "needs user review", never a fabricated new entity.
- Do not fake DOCX generation with HTML-renamed-to-.docx. Must be a real OOXML document (the `docx` npm
  package). Do not claim a report/sync/upload feature "works" if it is a stub — say so explicitly.
- Do not swap core technology choices (framework, DB, sync strategy) without writing a new ADR that
  states the reason and consequences.

## 8. Before changing an architecture decision

Read `docs/decisions/`. If you disagree with a standing ADR, write a new ADR proposing the change and
its consequences — do not silently diverge.

## 9. Token/tool-usage discipline

Search → targeted read → edit → targeted test → diff review. Don't read `node_modules`, `.next`,
`dist`, or generated artifacts unless specifically debugging inside them. Don't re-read a file you just
edited to "confirm" — trust the edit tool. Use RTK-style pre-filtering for noisy output (build logs,
long test output) but never let filtering hide an error, warning, stack trace, or regression — read raw
output for anything that failed.

## 10. Priority order when goals conflict

1. Data integrity  2. No data loss  3. Offline reliability  4. Sync reliability  5. Report accuracy
6. RTL correctness  7. Security  8. Performance  9. Token efficiency  10. Development convenience.
