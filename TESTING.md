# TESTING.md

## Tools

- **Vitest** — unit/integration tests for `packages/*` (shared-types validation, sync-engine queue/state
  machine, report QA checks) and pure logic in `apps/web/lib`.
- **Playwright** — E2E, specifically for the offline scenario matrix below (`page.context().setOffline()`
  / `route.abort()` to emulate lost connectivity, and Service Worker + IndexedDB state inspection).

```
npm run test          # vitest run, all packages
npm run test:watch
npm run typecheck
```

## Definition of Done for v1 (spec §48) — the scenario every release must actually pass

1. Open a project online → download it for offline use.
2. Turn off Wi-Fi and mobile data.
3. Start an inspection, start recording, change floor, enter a room, take photos, create an issue, add a
   note, keep recording, finish the inspection.
4. Close the app entirely, reopen it — the inspection is still there (recovery).
5. Reconnect → sync runs automatically (and via manual "↻ סנכרן עכשיו") → photos and audio reach the
   server → transcription runs → AI extraction produces findings → user reviews the draft → DOCX is
   generated with correct RTL and correctly placed images → PDF is generated.

This is the acceptance test for v1, not a unit test — track it as a standing Playwright E2E scenario
(`e2e/full-offline-tour.spec.ts`, to be built once Phase 3 UI exists) and don't consider v1 shippable
until it passes for real, end to end.

## Offline test matrix (spec §49) — each needs an explicit test, not just "should be fine"

- Start offline (no prior online session at all)
- Lose internet mid-recording
- Internet returns during the inspection (mid-tour)
- Internet returns only after the inspection ends
- A single failed image upload (server 5xx / timeout) — must retry, must not lose the local photo
- A single failed audio chunk upload — must resume, not restart
- Duplicate sync attempt (retry an already-confirmed item) — must be a no-op, not a duplicate row
- App refresh mid-tour
- Browser fully closed mid-tour
- Device restart, where the test environment allows it
- A large inspection: 50+ photos, a long (1h+) audio recording — must not degrade UI responsiveness
  (this is also where `packages/sync-engine`'s queue-ordering and `apps/web`'s virtualization/pagination
  choices get validated for real)

## What "done" means for a feature (ties back to CLAUDE.md §4, §7)

A feature isn't done if its test only exercises the online/happy path. If you can't write a test for it
with the network off, either it isn't actually offline-first yet, or the test suite is incomplete —
either way, say so explicitly rather than marking the feature complete.
