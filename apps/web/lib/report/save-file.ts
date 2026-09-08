"use client";

// Minimal local shape for the File System Access API's save picker -- not universally present in
// TypeScript's default DOM lib depending on the configured lib version, and only implemented by
// Chromium browsers today. Same "small local interface for one non-standard browser API" pattern as
// lib/recording/use-speech-dictation.ts's MinimalSpeechRecognition.
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}
type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;

export type SaveFileResult = { method: "picker" } | { method: "download" } | { method: "cancelled" };

/**
 * Saves a generated report file to a location the user picks (spec: export "to a user-chosen OneDrive
 * folder"). Uses the File System Access API's save picker where available (Chromium desktop) -- the
 * user can navigate straight into their OneDrive-synced folder in that native dialog. Falls back to a
 * plain browser download (Safari, Firefox, and every mobile browser implement none of this API), which
 * lands in the browser's default Downloads location; there is no folder-choosing capability there at
 * all, so the honest fallback is "download, then the user moves it into OneDrive themselves" -- the
 * caller (report-screen.tsx) surfaces which path was taken rather than implying they're equivalent.
 */
export async function saveGeneratedFile(
  blob: Blob,
  suggestedName: string,
  mimeType: string,
  extension: string
): Promise<SaveFileResult> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: extension.toUpperCase(), accept: { [mimeType]: [`.${extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: "picker" };
    } catch (err) {
      // The user closing the native picker without choosing a location is a normal outcome, not an
      // error to surface -- every other failure (e.g. a real write error) still propagates.
      if (err instanceof DOMException && err.name === "AbortError") return { method: "cancelled" };
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { method: "download" };
}
