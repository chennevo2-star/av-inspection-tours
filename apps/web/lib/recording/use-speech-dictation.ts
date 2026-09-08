"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live speech-to-text dictation directly into a text field (New Task wizard, step 3 — the user's
 * explicit choice over "type only" or "continuous background recording + later AI transcription").
 *
 * Uses the browser's built-in Web Speech API (`SpeechRecognition`). This is NOT the same mechanism as
 * lib/recording/use-audio-recorder.ts's MediaRecorder-based continuous recording — that pipeline still
 * exists and still works (verified on a real device), it's just unused by the current tour UI in favor
 * of this per-field live dictation.
 *
 * Real, known risk (flagged to the user before building this, they chose it anyway): browser support for
 * `SpeechRecognition` is inconsistent, and specifically **Safari on iPhone has limited/unreliable
 * support** — this hook feature-detects and degrades to "unavailable" (caller shows typing-only) rather
 * than crashing, but hasn't been verified working on a real iPhone. Verify on the actual target device
 * before relying on it.
 */

export type DictationStatus = "idle" | "listening" | "unsupported" | "error";

export interface UseSpeechDictationResult {
  status: DictationStatus;
  errorMessage: string | null;
  /** True once feature-detection has run — lets the UI avoid a flash of the mic button before knowing
   * whether it'll actually work. */
  checked: boolean;
  start: () => void;
  stop: () => void;
}

// Not in the standard DOM lib typings (still non-standard/vendor-prefixed) — narrow local shape for just
// what this hook uses, rather than pulling in a third-party @types package for one browser API.
interface MinimalSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: any) => void) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  onerror: ((event: any) => void) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => MinimalSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => MinimalSpeechRecognition;
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** @param onTranscript called with each finalized chunk of recognized text (append to the field yourself — this hook doesn't own the text value). */
export function useSpeechDictation(onTranscript: (text: string) => void): UseSpeechDictationResult {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setStatus(getSpeechRecognitionCtor() ? "idle" : "unsupported");
    setChecked(true);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }

    setErrorMessage(null);
    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText.trim()) onTranscriptRef.current(finalText.trim());
    };
    recognition.onerror = (event) => {
      setStatus("error");
      const code = event?.error as string | undefined;
      setErrorMessage(
        code === "not-allowed"
          ? "הגישה למיקרופון נדחתה. יש לאשר גישה בהגדרות הדפדפן ולנסות שוב."
          : code === "no-speech"
            ? "לא זוהה דיבור. ניתן לנסות שוב."
            : "שגיאה בזיהוי הדיבור. ניתן להקליד במקום, או לנסות שוב."
      );
    };
    recognition.onend = () => {
      setStatus((current) => (current === "error" ? current : "idle"));
    };

    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { status, errorMessage, checked, start, stop };
}
