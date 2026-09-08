import Anthropic from "@anthropic-ai/sdk";
import { InspectionExtraction, enforceKnownEntityIds, type InspectionExtraction as InspectionExtractionType } from "@av-inspection/shared-types";
import { buildExtractionPrompt, EXTRACTION_TOOL_SCHEMA } from "./build-prompt.js";
import type { ExtractionReferenceData } from "./reference-data.js";

export interface ExtractionAgent {
  extract(transcript: string, reference: ExtractionReferenceData): Promise<InspectionExtractionType>;
}

/** Thrown when Claude's output still fails schema validation after the one documented retry
 * (AI_PIPELINE.md's "Validation" section) — the orchestrator turns this into the inspection's explicit
 * error state, never a half-applied result. */
export class ExtractionValidationError extends Error {}

// Per this session's own guidance: default AI-application code to the latest, most capable Claude model.
const MODEL = "claude-opus-5";
const MAX_TOKENS = 8000;

/**
 * ADR-006's Structured Extraction Agent. Real implementation — never exercised against a live API key in
 * this project's own sessions so far (no ANTHROPIC_API_KEY provisioned here). Forces tool use rather than
 * asking for bare JSON (see build-prompt.ts) for reliable structured output, validates the result against
 * the same Zod schema used everywhere else in the app, retries once with the validation error fed back,
 * and finally runs enforceKnownEntityIds() — the second, code-level half of "AI never invents entities"
 * (spec §53) that doesn't depend on the model actually following instruction 1 in the system prompt.
 */
export class ClaudeExtractionAgent implements ExtractionAgent {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(transcript: string, reference: ExtractionReferenceData): Promise<InspectionExtractionType> {
    const prompt = buildExtractionPrompt(transcript, reference);

    let raw = await this.callOnce(prompt);
    let validated = InspectionExtraction.safeParse(raw);

    if (!validated.success) {
      raw = await this.callOnce(prompt, validated.error.message);
      validated = InspectionExtraction.safeParse(raw);
      if (!validated.success) {
        throw new ExtractionValidationError(
          `Claude's extraction failed schema validation twice: ${validated.error.message}`
        );
      }
    }

    const knownIds = {
      floorIds: new Set(reference.floors.map((f) => f.id)),
      roomIds: new Set(reference.rooms.map((r) => r.id)),
      contractorIds: new Set(reference.contractors.map((c) => c.id)),
    };
    return enforceKnownEntityIds(validated.data, knownIds);
  }

  private async callOnce(
    prompt: { system: string; user: string },
    priorValidationError?: string
  ): Promise<unknown> {
    const userContent = priorValidationError
      ? `${prompt.user}\n\n---\nהתגובה הקודמת שלך לא עמדה בסכמה הנדרשת:\n${priorValidationError}\nאנא תקן ושלח שוב תגובה תקינה בלבד, דרך אותו כלי.`
      : prompt.user;

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: userContent }],
      tools: [EXTRACTION_TOOL_SCHEMA],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL_SCHEMA.name },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) {
      throw new Error("Claude did not return a tool_use block for the extraction tool");
    }
    return toolUse.input;
  }
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The Extraction Agent (ADR-006) needs it — set it, or construct the " +
        "orchestrator with a different ExtractionAgent implementation."
    );
  }
  return key;
}
