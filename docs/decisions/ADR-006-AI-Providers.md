# ADR-006: AI provider choices

## Status
Accepted (defaults — explicitly swappable, see below)

## Context
The spec (§22, §51) requires three separate AI agents (Transcription, Structured Extraction, Report
Writing) but deliberately doesn't name vendors. This is a real cost/architecture decision the spec leaves
open.

## Decision
- **Structured Extraction Agent** and **Report Writing Agent**: Anthropic Claude API. Both need careful
  instruction-following against a strict JSON schema (extraction) and fluent Hebrew prose (report
  writing) — Claude is a solid default for both, and keeps the AI vendor surface small (one API for two
  of the three agents).
- **Transcription Agent**: no LLM-vendor-neutral default exists for STT the way Claude covers the other
  two, so this is the one genuinely open choice. Default proposal: OpenAI Whisper API, for its Hebrew
  multilingual transcription quality. Implemented behind a `TranscriptionProvider` interface
  (`packages/ai-pipeline/src/transcription/`) specifically so this is a one-file swap, not a rewrite, if
  a different provider (self-hosted whisper.cpp, Azure Speech, Google STT) is preferred.

## Consequences
- Two API keys to provision in production: Anthropic + the chosen STT provider.
- If the user has a preference for the STT provider (cost, data-residency, or accuracy reasons — audio
  may contain sensitive client site information, spec §45), that's a one-file change, not an
  architecture change — flag it for confirmation before Phase 5 (AI Pipeline) actually starts, since real
  API keys/billing are involved.
