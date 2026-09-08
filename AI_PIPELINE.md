# AI_PIPELINE.md

## Three separate agents (spec §51) — never one giant prompt

1. **Transcription Agent** — audio → text. Provider-agnostic behind a `TranscriptionProvider` interface
   in `packages/ai-pipeline/src/transcription/`. Default provider: OpenAI Whisper API (good Hebrew
   multilingual accuracy) — this is a deliberate, swappable default (ADR-006), not a hard commitment; say
   so if the user wants a different provider (self-hosted whisper.cpp, Azure Speech, Google STT).
2. **Structured Extraction Agent** — transcript + context events (room/floor timeline) + photo timestamps
   → structured JSON (see schema below). Uses Anthropic Claude. Runs against the project's own
   contractor/room/floor lists (never invents new ones — see below).
3. **Report Writing Agent** — approved structured findings → the prose (summary paragraph, per-issue
   phrasing) that feeds the DOCX template. Also Claude. Only runs after human review of Structured
   Extraction output, and even its output is still an editable draft, not a final document.

Each agent is a separate module with its own narrow input/output contract — do not merge them into one
call "for efficiency". This matches spec §51 exactly and keeps each step debuggable/replaceable on its
own.

## Structured Extraction output schema (spec §52)

Defined as a Zod schema in `packages/shared-types/src/ai-schemas.ts` (source of truth — validate every
LLM response against it before it touches the DB):

```ts
InspectionExtraction = {
  inspection_summary: string,
  findings: Finding[],        // → become Issue rows after user approval
  tasks: TaskUpdate[],        // new tasks OR updates/closures of previously-open tasks
  photo_associations: { photo_id: string; finding_index: number; confidence: number }[],
  contractor_mentions: { raw_text: string; matched_contractor_id: string | null; confidence: number }[],
  room_mentions: { raw_text: string; matched_room_id: string | null; confidence: number }[],
  previous_task_updates: { task_id: string; new_status: TaskStatus; evidence: string }[],
}

Finding = {
  floor_id: string | null,
  room_id: string | null,
  category: IssueCategory | null,
  subject: string,
  finding: string,
  required_action: string,
  responsible_contractor_id: string | null,   // null, never invented — see rule below
  secondary_responsible_contractor_id: string | null,
  priority: Priority | null,
  confidence: number,          // 0–1
  needs_user_review: boolean,  // true whenever any of the above is null or low-confidence
}
```

## Hard rule: AI never invents entities

If a contractor/room/floor mentioned in the audio doesn't clearly match an existing project entity, the
corresponding field is `null` and `needs_user_review = true`. The AI must not create a new Contractor,
Room, or Floor row on its own — ever. This is enforced at the schema/validation layer, not just by
prompting: the extraction service only accepts IDs that exist in that project's own reference data passed
into the prompt; anything else is coerced to `null` server-side even if the model hallucinates an id.

## Contractor / room / task matching (spec §25–27)

- Contractor matching runs against the project's `Contractor` + `ContractorAlias` table (e.g. "סינמה" /
  "הדסינמה" / "Hadas Cinema" → one `Contractor_ID`). Matching is alias-lookup + fuzzy string match,
  surfaced with a confidence score — never a silent guess above the review threshold.
- Room/floor matching is the same pattern against the project's own `Room`/`Floor` tables.
- Previous-inspection task matching: before extraction, the project's currently-open tasks are included
  in the prompt context so the model can propose "this sounds like task #14 being closed" instead of
  creating a duplicate new task. The proposal is still just a proposal — surfaced in the review UI as
  "close task #14?", not auto-applied.

## Human in the loop (spec §23–24, §54)

AI output is always a **Draft**. Nothing reaches the DOCX generator without passing through the "סקירת
טיוטת הסיור" review screen, where every finding/task/association is editable (edit/delete/merge/reassign
contractor/room/floor/status, add/remove photo). The user is the final approval authority — full stop.

## Validation

Every LLM JSON response is parsed with `InspectionExtraction.safeParse()` before use. A response that
fails schema validation is retried once with the validation error fed back to the model; if it still
fails, the inspection's `AI_Status` is set to an explicit error state surfaced to the user — never
half-applied.
