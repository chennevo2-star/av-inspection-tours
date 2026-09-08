"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Audio, AudioChunk } from "@av-inspection/shared-types";
import { getLocalDb } from "../db/local-db";
import { enqueueSync } from "../sync/enqueue";

/**
 * Continuous field-tour audio recording (spec §11, §76–78). Not verifiable end-to-end in this project's
 * sandboxed dev/test browser (no real microphone hardware, no way to answer a getUserMedia permission
 * prompt) — the state machine, chunk-persistence, and error surfaces below are implemented for real and
 * typecheck-verified, but actual mic capture needs confirming in a real browser on a real device before
 * trusting it end to end. See TESTING.md.
 *
 * Chunking strategy (spec §11 "audio chunk every X minutes", §78 checkpoints): rather than one
 * MediaRecorder with a `timeslice`, whose interim Blobs aren't reliably self-contained playable files
 * across browsers, this **stops and restarts** the recorder every CHUNK_INTERVAL_MS. Each stop produces
 * one complete, independently valid, immediately-persistable file — at the cost of a small (tens of ms)
 * gap between chunks, which is the honest tradeoff for chunks that are guaranteed usable on their own.
 */

export type RecordingStatus = "idle" | "recording" | "paused" | "interrupted" | "error";

const CHUNK_INTERVAL_MS = 3 * 60 * 1000;

export interface UseAudioRecorderResult {
  status: RecordingStatus;
  elapsedSeconds: number;
  errorMessage: string | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
}

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function describeGetUserMediaError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "הגישה למיקרופון נדחתה. יש לאשר גישה בהגדרות הדפדפן ולנסות שוב.";
    if (err.name === "NotFoundError") return "לא נמצא מיקרופון זמין במכשיר זה.";
    if (err.name === "NotReadableError") return "לא ניתן לגשת למיקרופון — ייתכן שהוא בשימוש על ידי אפליקציה אחרת.";
  }
  return "שגיאה בהפעלת ההקלטה. ניתן לנסות שוב.";
}

export function useAudioRecorder(
  inspectionId: string,
  getContext: () => { floorId: string | null; roomId: string | null }
): UseAudioRecorderResult {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusRef = useRef<RecordingStatus>("idle");
  const contextGetterRef = useRef(getContext);
  contextGetterRef.current = getContext;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopRequestedRef = useRef(false);
  const sequenceRef = useRef(0);
  const audioIdRef = useRef<string | null>(null);
  const chunkStartRef = useRef<Date | null>(null);

  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number>(0);

  const setStatusBoth = useCallback((next: RecordingStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const persistChunk = useCallback(
    async (blob: Blob, startedAt: Date) => {
      if (blob.size === 0 || !audioIdRef.current) return;
      const db = getLocalDb();
      const localFileId = crypto.randomUUID();
      await db.audioChunkBlobs.add({ id: localFileId, blob });

      const { floorId, roomId } = contextGetterRef.current();
      const chunk: AudioChunk = AudioChunk.parse({
        id: crypto.randomUUID(),
        audioId: audioIdRef.current,
        inspectionId,
        sequence: sequenceRef.current++,
        startTime: startedAt.toISOString(),
        endTime: new Date().toISOString(),
        floorId,
        roomId,
        localFileId,
        cloudFileId: null,
        syncStatus: "LOCAL_ONLY",
      });
      await db.audioChunks.add(chunk);
      await enqueueSync("AudioChunk", chunk.id, "create", chunk);
    },
    [inspectionId]
  );

  const startSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = pickSupportedMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const parts: Blob[] = [];
    const segmentStartedAt = new Date();
    chunkStartRef.current = segmentStartedAt;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onerror = () => {
      setStatusBoth("interrupted");
      setErrorMessage("ההקלטה נקטעה באופן בלתי צפוי.");
    };
    recorder.onstop = () => {
      const blob = new Blob(parts, { type: recorder.mimeType });
      void persistChunk(blob, segmentStartedAt);
      // Rotate to the next chunk only if this stop was the chunk-boundary timer, not a deliberate
      // full stop() or an interruption — those paths set stopRequestedRef / change status themselves.
      if (!stopRequestedRef.current && statusRef.current === "recording") {
        startSegment();
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    chunkTimerRef.current = setTimeout(() => {
      if (recorderRef.current === recorder && recorder.state !== "inactive") recorder.stop();
    }, CHUNK_INTERVAL_MS);
  }, [persistChunk, setStatusBoth]);

  const start = useCallback(async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (statusRef.current === "recording" || statusRef.current === "paused") {
            setStatusBoth("interrupted");
            setErrorMessage("גישת ההקלטה למיקרופון נותקה (ייתכן ברקע/נעילת מסך). ניתן להתחיל הקלטה חדשה.");
          }
        });
      });

      const db = getLocalDb();
      const audio: Audio = Audio.parse({
        id: crypto.randomUUID(),
        inspectionId,
        startTime: new Date().toISOString(),
        endTime: null,
        transcriptionStatus: "ממתין",
        syncStatus: "LOCAL_ONLY",
      });
      await db.audio.add(audio);
      // Audio has a real, ordinary sync lifecycle (fixed after real-device testing found every
      // AudioChunk permanently failing its FK check — the parent Audio row this used to say would be
      // "upserted from the first chunk" server-side was never actually implemented anywhere).
      await enqueueSync("Audio", audio.id, "create", audio);
      audioIdRef.current = audio.id;

      sequenceRef.current = 0;
      stopRequestedRef.current = false;
      accumulatedMsRef.current = 0;
      segmentStartRef.current = Date.now();
      setElapsedSeconds(0);
      tickIntervalRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((accumulatedMsRef.current + (Date.now() - segmentStartRef.current)) / 1000));
      }, 1000);

      setStatusBoth("recording");
      startSegment();
    } catch (err) {
      setStatusBoth("error");
      setErrorMessage(describeGetUserMediaError(err));
    }
  }, [inspectionId, setStatusBoth, startSegment]);

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return;
    recorderRef.current?.pause();
    accumulatedMsRef.current += Date.now() - segmentStartRef.current;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    setStatusBoth("paused");
  }, [setStatusBoth]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    recorderRef.current?.resume();
    segmentStartRef.current = Date.now();
    tickIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((accumulatedMsRef.current + (Date.now() - segmentStartRef.current)) / 1000));
    }, 1000);
    setStatusBoth("recording");
  }, [setStatusBoth]);

  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;

    if (audioIdRef.current) {
      const db = getLocalDb();
      const audio = await db.audio.get(audioIdRef.current);
      if (audio) {
        const updated: Audio = { ...audio, endTime: new Date().toISOString() };
        await db.audio.put(updated);
        await enqueueSync("Audio", updated.id, "update", updated);
      }
    }

    setStatusBoth("idle");
  }, [setStatusBoth]);

  // Safety net: if the component unmounts mid-recording (navigation away without pressing "סיום סיור"),
  // release the microphone rather than leaking an open stream.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    };
  }, []);

  return { status, elapsedSeconds, errorMessage, start, pause, resume, stop };
}
