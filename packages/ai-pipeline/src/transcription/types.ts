/**
 * Transcription Agent (spec §51, AI_PIPELINE.md). Kept as a narrow interface specifically so the
 * provider (ADR-006's swappable default: OpenAI Whisper) is a one-file change, not a rewrite — see
 * ADR-006 for why this is the one genuinely open provider choice in the pipeline.
 */
export interface TranscriptionResult {
  text: string;
  /** Word/phrase-level timing, when the provider supports it — not required for the pipeline to work
   * (room/floor alignment comes from ContextEvent timestamps, not transcript timing), but useful for a
   * future "jump to this moment" review UI. */
  segments?: { startSeconds: number; endSeconds: number; text: string }[];
}

export interface TranscriptionProvider {
  transcribe(audio: Buffer, mimeType: string, languageHint?: string): Promise<TranscriptionResult>;
}
