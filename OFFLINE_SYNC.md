# OFFLINE_SYNC.md

## The rule

Every field action writes to IndexedDB **first and only**, synchronously from the UI's point of view.
A `SyncQueueItem` is appended in the same Dexie transaction as the entity write. The UI never awaits a
network call to consider an action "done".

```
Local Write (Dexie tx: entity + SyncQueueItem)
        ↓
Queue (IndexedDB table, persists across app restarts)
        ↓
Upload (sync-engine drains queue when online)
        ↓
Server Confirmation (2xx + server-assigned confirmation, keyed by the same client UUID — idempotent)
        ↓
Mark SYNCED (and only then may any local-only staging data be pruned)
```

Never: `Upload attempt → delete local`. Local rows are never deleted on the strength of an upload attempt
— only on explicit server confirmation. If the confirmation never arrives, the row stays `SYNC_ERROR` or
`WAITING_FOR_SYNC` forever, visibly, until retried or manually resolved. See spec §20, §88 ("no silent
data loss").

## Sync status enum

`LOCAL_ONLY | WAITING_FOR_SYNC | UPLOADING | SYNCED | SYNC_ERROR` — defined in
`packages/shared-types/src/sync.ts`. `LOCAL_ONLY` exists for a brief instant before the item is enqueued;
in practice almost everything moves to `WAITING_FOR_SYNC` immediately.

## Queue drain order (packages/sync-engine)

1. Project
2. Floor
3. Room
4. Contractor
5. Inspection metadata
6. Issues
7. Tasks
8. Notes
9. Photos
10. Audio chunks
11. Other attachments

Reference data (Project/Floor/Room/Contractor — Phase 2) drains first because everything below it
references those ids; the server needs them to exist before it can accept an Inspection/Issue/Task/Photo
that points at them. See `packages/shared-types/src/sync.ts`'s `SYNC_ENTITY_PRIORITY` comment.

Each item carries: `entityType`, `entityId` (UUID), `op` (create/update), `payload` or a reference to a
local Blob, `attempts`, `lastError`, `createdAt`. The engine is push-based (drains on an `online` event
and on an explicit "sync now") and pull-based (a manual "↻ סנכרן עכשיו" always available — never rely on
OS background sync alone, per spec §19).

## Large files (photo/audio)

Never inline a Blob into the Postgres row. Photos/audio go straight to object storage via the API route,
referenced by `Cloud_File_ID`. Audio in particular is chunked during recording (not just for upload — see
below) so a chunk finishes and can start uploading independently of the rest of the recording.

## Failure handling

`retry` (exponential backoff, capped), `failed upload` (surfaced to the user with a retry action, never
silently dropped), `duplicate upload` (idempotent server write keyed by client UUID — a retried upload of
an already-confirmed item is a no-op, not a duplicate row), `partial upload` (chunked audio resumes from
the last confirmed chunk, not from zero), `intermittent network` (queue keeps draining opportunistically;
a request that fails mid-flight goes back to `WAITING_FOR_SYNC`, not `SYNC_ERROR`, unless it fails
repeatedly).

## Recording resilience (spec §11, §76–78)

- Audio is chunked (target: a few minutes per chunk) and each chunk is persisted to IndexedDB as soon as
  it's finalized — not held in memory until the tour ends.
- A checkpoint is written with each chunk so, worst case, a crash loses only the in-progress chunk, not
  the whole recording.
- Screen lock / app backgrounding must not be assumed to keep recording alive silently — the UI must
  reflect actual state: `🔴 Recording` / `⏸ Paused` / `⚠ Recording interrupted` / `✅ Audio saved
  locally`, and must detect + recover from an interruption rather than pretend nothing happened.

## Recovery

On app open, if an `Inspection` exists locally with no `End_Time`, show "נמצא סיור שלא הסתיים" → "המשך
סיור", reopening the exact in-progress state (current floor/room, recording status, queued items).

## Conflict resolution (baseline for v1)

v1 has a single inspector per inspection, so true multi-writer conflicts are rare. Baseline policy:
last-write-wins per field, keyed by the entity's own `updatedAt`, with the sync engine surfacing (not
silently resolving) any case where a local pending write's base version doesn't match the server's
current version — flag it as `SYNC_ERROR` with a clear message rather than guessing. Multi-inspector
concurrent editing is out of scope for v1; don't build speculative CRDT/OT machinery for it now.
