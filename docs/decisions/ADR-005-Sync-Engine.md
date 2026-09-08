# ADR-005: Custom sync engine, not a generic sync library

## Status
Accepted

## Context
Sync needs domain-specific behavior: ordered queue draining (metadata → issues → tasks → photos → audio
chunks → other), resumable chunked audio upload, idempotent writes keyed by client UUID, and explicit
visible sync-status per entity (spec §16–21).

## Decision
Build `packages/sync-engine` as a small, framework-agnostic, independently-testable module: a queue table
+ a state machine (`LOCAL_ONLY → WAITING_FOR_SYNC → UPLOADING → SYNCED`, with `SYNC_ERROR` reachable from
`UPLOADING`) + retry/backoff logic. Do not adopt a generic offline-sync library (e.g. a CRDT framework) —
v1 is single-inspector-per-inspection, so last-write-wins with visible conflict-flagging is sufficient
(see OFFLINE_SYNC.md §Conflict resolution) and a generic library would add complexity the product doesn't
need yet.

## Consequences
- More code to own than adopting a library, but full control over the domain-specific ordering/resume
  semantics the spec requires.
- If multi-inspector concurrent editing becomes a real requirement later, that's a new ADR (likely
  bringing in real conflict resolution/CRDT machinery then, not speculatively now).
