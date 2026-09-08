# ARCHITECTURE.md

## Stack

| Layer | Choice | Why | ADR |
|---|---|---|---|
| App shell | Next.js 14 (App Router) + TypeScript, PWA (installable, Service Worker) | One codebase for mobile field UI + desktop admin UI; SSR for the desktop/admin surfaces, fully client-driven for the offline field UI | ADR-001 |
| Offline-first | Local write → queue → sync, never online-required | Core requirement, not a feature | ADR-002 |
| Local storage | IndexedDB via Dexie.js | Mature, TS-first, handles Blobs (audio/photos) natively, transactional | ADR-003 |
| Server DB | PostgreSQL via Drizzle ORM | Relational integrity for Project/Inspection/Issue/Task graph; Drizzle is TS-native, lightweight, migration-friendly | — |
| File storage | S3-compatible object storage (works with AWS S3 / Cloudflare R2 / MinIO / Backblaze) | Audio/photos never stored in Postgres; vendor-agnostic per §18 of the spec | — |
| Report generation | `docx` (OOXML) → LibreOffice headless (`soffice --convert-to pdf`) for PDF | Real DOCX (not HTML-as-docx); DOCX is the master document, PDF is derived from it, matching the spec's document policy | ADR-004 |
| Sync engine | Custom queue + state machine (`packages/sync-engine`) | Needs domain-specific semantics (photo/audio chunking, resumable upload, conflict rules) no generic library provides | ADR-005 |
| AI | Anthropic Claude API for Structured Extraction + Report Writing agents; pluggable Speech-to-Text provider (default: a swappable `TranscriptionProvider` interface, see AI_PIPELINE.md) | Three separate agents per spec §51, never one giant prompt | ADR-006 |

## Layer separation

```
UI (apps/web/app, components)
   │  reads/writes local state only, via hooks over Dexie
   ▼
Local persistence (apps/web/lib/db — Dexie / IndexedDB)
   │  every mutation also appends a SyncQueueItem
   ▼
Sync Engine (packages/sync-engine)
   │  drains queue when online, calls API routes
   ▼
API routes (apps/web/app/api/**)
   │  auth, validation (shared-types zod schemas), writes to Postgres + object storage
   ▼
Postgres (packages/db)  +  Object Storage (audio/photo/blobs)
   │
   ▼ (async, triggered after sync)
AI Pipeline (packages/ai-pipeline): Transcription → Structured Extraction → (after user approval) Report Writing
   │
   ▼
Report Generator (packages/report-generator): DOCX → QA → PDF
```

Business logic never lives in React components. Components call hooks/services in `apps/web/lib`, which
call into `packages/*`. This keeps `packages/sync-engine`, `packages/ai-pipeline`, and
`packages/report-generator` unit-testable without a browser or a UI.

## Core entities (all client-generated UUID primary keys)

`Project`, `Inspection`, `Floor`, `Room`, `Contractor` (+ `ContractorAlias`), `Issue`, `Task`, `Photo`,
`Audio` (+ `AudioChunk`), `ContextEvent` (room/floor-change timeline events used to align transcript ↔
room/floor/photo by timestamp). Full field lists live in `packages/shared-types/src/entities.ts` — that
file is the single source of truth; don't duplicate field lists here where they will drift out of date.

## Sync status (every syncable entity)

`LOCAL_ONLY → WAITING_FOR_SYNC → UPLOADING → SYNCED`, with `SYNC_ERROR` reachable from `UPLOADING`.
Defined once in `packages/shared-types/src/sync.ts`, used by both the client queue and any status UI.

## Desktop vs. mobile UI

Same codebase, same components where sensible, different routes/layouts:
- `apps/web/app/(field)/...` — large-touch-target single-column UI, the in-tour screen, optimized for
  one-handed phone use (spec §75).
- `apps/web/app/(admin)/...` — sidebar, tables, review screens, report management — desktop-oriented but
  still responsive.

## What Phase 1 (current) actually contains vs. what's still ahead

Phase 1 = repo, docs, schemas (Postgres + IndexedDB + Zod), sync-engine queue/state-machine skeleton with
real unit tests, PWA shell (manifest + service worker registering + offline page), sub-agent defs, test
harness. It does **not** yet contain: real UI screens beyond a skeleton, real API routes, real S3 upload,
real AI calls, or real DOCX generation — those are Phases 2–8 per the phased plan in the original spec.
Nothing in Phase 1 should be presented as more complete than this.
