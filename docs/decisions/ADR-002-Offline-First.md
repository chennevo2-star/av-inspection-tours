# ADR-002: Offline-first, not online-with-offline-fallback

## Status
Accepted

## Context
Field work happens at construction sites/basements/hotels with unreliable or no connectivity. Losing
inspection data because of a dropped connection is the single worst failure mode for this product
(spec §2, §72 priority order).

## Decision
All field-critical actions (photo, audio, note, issue, task, room/floor change, start/end inspection)
write to local IndexedDB storage synchronously and are queued for sync — never awaiting a network call.
Network is required only for sync, AI processing, cross-device collaboration, and server-side document
generation.

## Consequences
- Every field feature needs a local-first implementation before it needs a server implementation.
- Requires a real sync engine with a state machine and retry/resume logic (see ADR-005) — this is not
  optional infrastructure, it's core product.
- Data integrity rule follows directly: never delete local data before server confirmation (OFFLINE_SYNC.md).
