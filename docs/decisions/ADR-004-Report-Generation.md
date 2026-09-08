# ADR-004: Real OOXML DOCX via `docx`, PDF derived from it via LibreOffice headless

## Status
Accepted

## Context
Reports must be genuine Word documents (spec §32) with correct Hebrew RTL (spec §33) across paragraphs,
tables, headers/footers, bullets, numbering, and mixed Hebrew/English/digit content. PDF must match the
DOCX exactly (spec §37).

## Decision
- Generate DOCX with the `docx` npm package (dolanmiu/docx), authoring RTL properties explicitly on every
  paragraph/table/section from the start.
- Convert DOCX → PDF via LibreOffice headless (`soffice --headless --convert-to pdf`) server-side, so the
  PDF is a faithful rendering of the exact DOCX the user approved — never a separately-generated PDF that
  could visually diverge.

## Consequences
- The server environment needs LibreOffice installed for PDF conversion — an infra requirement to plan
  for in deployment, not just local dev.
- RTL correctness must be verified with real mixed-content test fixtures (REPORTING.md), not just plain
  Hebrew strings.
- If LibreOffice conversion proves unreliable/slow in production, revisit with a new ADR (candidate
  alternative: a hosted DOCX→PDF conversion API) rather than silently switching.
