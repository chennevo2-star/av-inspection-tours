export type { TranscriptionProvider, TranscriptionResult } from "./transcription/types.js";
export { OpenAIWhisperProvider } from "./transcription/openai-whisper-provider.js";

export type { ExtractionAgent } from "./extraction/extraction-agent.js";
export { ClaudeExtractionAgent, ExtractionValidationError } from "./extraction/extraction-agent.js";
export type {
  ExtractionReferenceData,
  ReferenceContractor,
  ReferenceFloor,
  ReferenceOpenTask,
  ReferencePhoto,
  ReferenceRoom,
} from "./extraction/reference-data.js";
export { buildExtractionPrompt, EXTRACTION_TOOL_SCHEMA } from "./extraction/build-prompt.js";

export type { ReportWritingAgent, ReportWritingInput } from "./report-writing/report-writing-agent.js";
export { ClaudeReportWritingAgent } from "./report-writing/report-writing-agent.js";

export type { AiPipelineDeps, AiPipelineResult } from "./orchestrator.js";
export { runAiPipelineForInspection } from "./orchestrator.js";
