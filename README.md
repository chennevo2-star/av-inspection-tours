# AV Inspection Tours

Offline-first system for supervisory AV/multimedia inspection tours. Start with
[CLAUDE.md](CLAUDE.md) — it's the map for the rest of the docs and the rules that apply to every change.

## Status

**Phase 1 (Foundation) — in progress.** See [ARCHITECTURE.md § "What Phase 1 actually contains"](ARCHITECTURE.md#what-phase-1-current-actually-contains-vs-whats-still-ahead)
for exactly what is and isn't real yet. Nothing here is a mock/stub presented as finished — anything not
yet wired says so.

## Getting started

```bash
npm install
npm run test        # vitest, all packages
npm run typecheck
npm run dev          # apps/web dev server
```

## Docs map

- [CLAUDE.md](CLAUDE.md) — start here
- [ARCHITECTURE.md](ARCHITECTURE.md) — stack, layers, entities
- [OFFLINE_SYNC.md](OFFLINE_SYNC.md) — the offline-first contract, sync queue, recovery
- [AI_PIPELINE.md](AI_PIPELINE.md) — transcription / extraction / report-writing agents
- [REPORTING.md](REPORTING.md) — DOCX/PDF generation, RTL, QA
- [TESTING.md](TESTING.md) — commands, offline test matrix, v1 acceptance scenario
- [docs/decisions/](docs/decisions/) — ADRs; read before changing any technology choice
