/** Small, deliberately narrow mime↔extension map — only the types this app actually produces
 * (camera photos, MediaRecorder audio chunks). Extension is used both to pick a storage key (so
 * ADR-007's LocalFsStorage can infer Content-Type on serve without a sidecar metadata file) and, in
 * reverse, by the file-serving route. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

export function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? "bin";
}

export function mimeTypeForExtension(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}
