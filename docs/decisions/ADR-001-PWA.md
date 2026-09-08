# ADR-001: Progressive Web App, not native apps

## Status
Accepted

## Context
The system must run on iPhone, Android, tablet, Windows, and macOS, with a single mobile-first field UI
and a richer desktop admin UI, sharing one codebase as much as possible (spec §3).

## Decision
Build as a PWA (Next.js + Service Worker, installable to the home screen on iOS/Android). Do not build
separate native apps in v1.

## Consequences
- One codebase, one deployment, fastest path to all five target platforms.
- iOS Safari's PWA background/recording limitations (spec §76) must be handled explicitly with visible
  status (🔴/⏸/⚠) and recovery, not assumed away.
- If a specific capability turns out to be unreliable in PWA (e.g. iOS background audio truly cannot be
  made reliable), revisit with a new ADR — don't silently reach for a native wrapper without recording
  why.
