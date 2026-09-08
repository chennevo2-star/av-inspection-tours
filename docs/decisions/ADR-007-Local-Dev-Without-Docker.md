# ADR-007: PGlite + local filesystem storage as Docker-free local dev/verification backends

## Status
Accepted (local dev/verification only — does not change the production target)

## Context
ADR-004/ARCHITECTURE.md already commit to Postgres + S3-compatible object storage, with Docker Compose
(Postgres + MinIO) as the intended way to run both locally. When Phase 4 (Sync Engine) actually needed a
live database and file storage to build and verify real API routes against, this project's own dev
machine turned out to have **no Docker installed** (no `docker` CLI, no WSL). Rather than write
server-side sync code that could never be run or verified in this environment, or silently pick a paid
cloud vendor the user didn't ask for, this was raised back to the user, who chose a Docker-free
alternative for now.

## Decision
`packages/db`'s client (`packages/db/src/client.ts`) picks its backend by whether `DATABASE_URL` is set:
- **Set** → real Postgres via `postgres-js` (the ADR-004/Docker/production path — unchanged).
- **Unset** → [PGlite](https://pglite.dev/), an embedded WASM build of real Postgres, requiring zero
  installation. This is genuine Postgres SQL semantics (not a mock/stub), persisted to a local directory
  (`.pglite-data/`, gitignored) so data survives dev-server restarts.

Object storage (`packages/storage`) similarly picks its backend by whether `S3_ENDPOINT` is set:
- **Set** → real S3-compatible client (`@aws-sdk/client-s3`) — works against AWS S3, Cloudflare R2, or a
  real MinIO once Docker is available.
- **Unset** → a local-filesystem store (`apps/web/.local-uploads/`, gitignored) served through a Next.js
  route that mimics a signed-URL contract (a random per-object token, not real cryptographic signing —
  see the storage module's own comment) closely enough to exercise the real upload → reference → fetch
  flow end to end.

## Consequences
- Phase 4's sync engine, API routes, and upload flow are built against the same abstractions
  (`getDb()`/`getStorage()`) either way — swapping in real Postgres/S3 later is an environment-variable
  change, not a code change.
- What actually ran and got verified in this project's own sessions so far is the PGlite/local-filesystem
  path, not real Postgres/S3 — say so plainly whenever reporting on Phase 4 status, per CLAUDE.md's
  no-mock-success rule. The `postgres-js` path is written correctly and typechecks, but is only genuinely
  proven once someone runs it against a real Postgres instance (Docker or otherwise).
- The local-filesystem storage's "signed URL" is not real access control — don't reuse that token scheme
  if this ever needs to hold genuinely sensitive client data before Docker/real S3 is wired up.
- If Docker becomes available later, switching is just setting `DATABASE_URL` and `S3_ENDPOINT` (plus
  running the real `docker-compose.yml` this ADR's sibling work adds) — no new ADR needed for that switch
  itself, since it was already the target in ADR-004.
