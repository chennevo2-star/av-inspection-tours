import { NextRequest, NextResponse } from "next/server";
import {
  ClaudeExtractionAgent,
  ExtractionValidationError,
  OpenAIWhisperProvider,
  runAiPipelineForInspection,
} from "@av-inspection/ai-pipeline";
import { ensureDbReady } from "../../../../../lib/server/ensure-db-ready";

/**
 * Triggers the AI pipeline (transcription → structured extraction, AI_PIPELINE.md) for one already-synced
 * inspection, using the real ADR-006 default providers. No UI calls this yet — Phase 6 (Review UI) is
 * what will surface a "run AI analysis" action and the resulting Draft to the user; this route exists so
 * that UI has something real to call once it's built, and so the pipeline is exercisable (e.g. via curl)
 * without needing to wait for that screen.
 *
 * Will throw a clear "ANTHROPIC_API_KEY is not set" / "OPENAI_API_KEY is not set" error until real keys
 * are provisioned in this environment — that's correct, honest behavior (see ADR-006, AI_PIPELINE.md),
 * not a bug to route around.
 */
export async function POST(_request: NextRequest, { params }: { params: { inspectionId: string } }) {
  try {
    await ensureDbReady();

    const result = await runAiPipelineForInspection(params.inspectionId, {
      transcriptionProvider: new OpenAIWhisperProvider(),
      extractionAgent: new ClaudeExtractionAgent(),
    });

    return NextResponse.json({
      ok: true,
      extractionRowId: result.extractionRowId,
      extraction: result.extraction,
    });
  } catch (err) {
    if (err instanceof ExtractionValidationError) {
      // Claude's output failed schema validation twice — non-retriable as-is, needs a human/investigation.
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[ai] pipeline failed for inspection ${params.inspectionId}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
