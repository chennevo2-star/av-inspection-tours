# REPORTING.md

## DOCX is the master document (spec §32, §37)

Generated with the `docx` npm package — real OOXML, not an HTML file renamed `.docx`. PDF is produced
*from* the generated DOCX (LibreOffice headless conversion: `soffice --headless --convert-to pdf`), never
generated independently in parallel — so DOCX and PDF can never visually diverge.

## RTL is a base requirement, not a later fix (spec §33–34)

Every paragraph, table, header, footer, and list in the template must be authored with
`bidirectional: true` / RTL paragraph properties from the start. Mixed Hebrew+Latin+digit content (model
numbers, "HDMI", "Poly", "Crestron", room names with English brand names) must render with correct
directional runs — no flipped digits or punctuation. This needs an explicit test case (see TESTING.md)
with real mixed strings, not just plain Hebrew.

Default font: a standard Hebrew-safe font (Arial or Noto Sans Hebrew) with the font configurable per
Workspace template (spec §34).

## Structure (spec §36)

1. Cover page — logo, "דו״ח פיקוח עליון – מערכות מולטימדיה", project, client, inspection number, date,
   location, participants, inspector.
2. Chapter 1 — AI-generated summary, as approved/edited by the user.
3. Chapter 2 — Findings/Tasks table: `מס' | קומה | חדר/אזור | נושא | ממצא/דרישה | באחריות | סטטוס | תמונה`.
4. Chapter 3 — Photo documentation: per photo — number, floor, room, finding, required action,
   contractor, image (1–2 photos per row depending on size).

## Branding (spec §35)

Per-Workspace: logo, company name, address, contact details, footer, colors — stored once, applied
automatically to every report generated under that workspace. Lives in the (future) `Workspace` /
`Organization` settings model — not hardcoded into the template.

## Report QA (spec §38) — must run before PDF is offered to the user

- RTL rendering correct (spot-check via the mixed-content test case)
- No missing/broken images (every `Photo` referenced by a finding actually has a resolved image)
- No table overflow
- Numbering consistent
- Footer present on every page
- Sane page breaks (chapter starts don't orphan a lone table header at the bottom of a page)
- No finding left with a missing contractor or missing required action without an explicit "לא צוין"
  placeholder — never a blank cell that looks like data loss.

QA failures block PDF generation and are surfaced as a specific, actionable list — not a generic error.

## Versioning (spec §83–84)

A report is never silently overwritten. Regenerating after edits creates a new revision:
`Inspection_12_Rev01`, `Inspection_12_Rev02`, ... Each revision's DOCX + PDF + the approved data snapshot
that produced it are retained.

## Storage policy (spec §39–40)

Images are compressed client-side before upload (balanced against report-quality needs — this is a
tunable, not a fixed number yet; revisit once real photos are being produced). Audio's source file is
eligible for deletion only after transcription + AI processing + report generation have all succeeded,
with a configurable retention window (default proposal: 30 days) and a per-inspection "שמור הקלטה
לצמיתות" override. Do not implement automatic audio deletion until Phase 8+ — flag it as a manual/cron
job specced but not yet running.
