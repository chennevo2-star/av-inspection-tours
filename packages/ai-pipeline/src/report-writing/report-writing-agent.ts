import Anthropic from "@anthropic-ai/sdk";

/**
 * Input is the user-APPROVED data (spec §23–24 — nothing reaches this agent before the human review
 * screen), never the AI's own first-draft extraction directly. This agent's whole job is turning already-
 * approved structured data into the polished prose paragraph for the report's cover/summary chapter
 * (REPORTING.md §Chapter 1) — it does not re-derive findings, assign contractors, or touch anything the
 * Extraction Agent + human review already decided.
 */
export interface ReportWritingInput {
  projectName: string;
  inspectionNumber: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** The user-approved/edited inspection summary text — the starting point to polish, not to rewrite. */
  approvedSummary: string;
  findingsCount: number;
  tasksCount: number;
  photosCount: number;
}

export interface ReportWritingAgent {
  writeCoverSummary(input: ReportWritingInput): Promise<string>;
}

const MODEL = "claude-opus-5";
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `אתה עוזר לכתיבת דוחות פיקוח עליון מקצועיים במערכות מולטימדיה (AV), בעברית תקנית ופורמלית.
תפקידך לנסח מחדש בצורה מקצועית וברורה סיכום שכבר אושר על ידי המפקח — אסור לך להוסיף עובדות, ממצאים, מספרים
או פרטים שלא נמסרו לך במפורש. אל תמציא דבר. פלט: פסקה אחת בלבד, ללא כותרות, ללא רשימות, ללא סימוני Markdown.`;

/**
 * ADR-006's Report Writing Agent. Real implementation — never exercised against a live API key in this
 * project's own sessions so far (no ANTHROPIC_API_KEY provisioned here). DOCX assembly itself (headers,
 * tables, images) is Phase 8's `packages/report-generator`, not this agent — this only produces the
 * prose paragraph that generator will place into the template.
 */
export class ClaudeReportWritingAgent implements ReportWritingAgent {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async writeCoverSummary(input: ReportWritingInput): Promise<string> {
    const userPrompt = [
      `פרויקט: ${input.projectName}`,
      `סיור מספר: ${input.inspectionNumber}`,
      `תאריך: ${input.date}`,
      `מספר ממצאים: ${input.findingsCount}`,
      `מספר משימות: ${input.tasksCount}`,
      `מספר תמונות: ${input.photosCount}`,
      "",
      "הסיכום שאושר על ידי המפקח (נסח מחדש בצורה מקצועית, ללא הוספת עובדות):",
      input.approvedSummary,
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    if (!textBlock) {
      throw new Error("Claude did not return a text block for the report summary");
    }
    return textBlock.text.trim();
  }
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The Report Writing Agent (ADR-006) needs it — set it, or construct " +
        "a different ReportWritingAgent implementation."
    );
  }
  return key;
}
