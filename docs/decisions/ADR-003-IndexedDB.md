# ADR-003: Dexie.js over IndexedDB for local storage

## Status
Accepted

## Context
Local storage needs to hold structured entities (projects, inspections, issues, tasks) and large Blobs
(photos, audio chunks) reliably, transactionally, across app restarts, in a browser context.

## Decision
Use Dexie.js as the IndexedDB wrapper (`apps/web/lib/db`), with a schema mirrored from
`packages/shared-types`. Not `localStorage`/`sessionStorage` (too small, string-only, no Blob support,
no transactions) and not a raw IndexedDB API (verbose, error-prone for this much schema).

## Consequences
- Dexie's versioned schema/migration support is used for any future local schema change.
- Query indexes are defined per the app's actual access patterns (by inspection, by room, by sync
  status) — see `apps/web/lib/db/local-db.ts`.
- Blobs (photos, audio) are stored as Dexie table rows referencing the Blob directly, not encoded as
  base64 strings (avoids ~33% size bloat and encode/decode cost).
