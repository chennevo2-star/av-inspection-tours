import type { TranscriptionProvider, TranscriptionResult } from "./types.js";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

/**
 * ADR-006's default Transcription Agent provider. Real implementation, written and typechecked — never
 * exercised against a live API key in this project's own sessions so far (no OPENAI_API_KEY provisioned
 * here; see AI_PIPELINE.md and ADR-006's "swappable default" framing). Swapping providers means
 * implementing TranscriptionProvider and changing what the orchestrator constructs — nothing else in the
 * pipeline needs to change.
 */
export class OpenAIWhisperProvider implements TranscriptionProvider {
  constructor(private readonly apiKey: string = requireApiKey()) {}

  async transcribe(audio: Buffer, mimeType: string, languageHint = "he"): Promise<TranscriptionResult> {
    const extension = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
    const formData = new FormData();
    // Uint8Array.from() copies into a fresh, plain ArrayBuffer — sidesteps a TS BlobPart mismatch with
    // Node's Buffer type (whose .buffer is typed ArrayBufferLike, which admits SharedArrayBuffer).
    formData.append("file", new Blob([Uint8Array.from(audio)], { type: mimeType }), `audio.${extension}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    if (languageHint) formData.append("language", languageHint);

    const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`OpenAI transcription failed (HTTP ${response.status}): ${bodyText.slice(0, 500)}`);
    }

    const body = (await response.json()) as {
      text: string;
      segments?: { start: number; end: number; text: string }[];
    };

    return {
      text: body.text,
      segments: body.segments?.map((segment) => ({
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      })),
    };
  }
}

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. The default Transcription Agent provider (ADR-006) needs it — set it, " +
        "or construct the orchestrator with a different TranscriptionProvider implementation."
    );
  }
  return key;
}
