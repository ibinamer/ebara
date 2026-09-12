"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeVocabularyInput } from "./speech";

export type VoiceAlternative = { transcript: string; confidence: number };
export type VoiceInputStatus = "idle" | "requesting" | "listening" | "processing";
export type VoiceInputErrorCode =
  | "unsupported"
  | "blocked"
  | "no-microphone"
  | "no-speech"
  | "unclear"
  | "network"
  | "service-unavailable"
  | "language-unsupported"
  | "rate-limited"
  | "start-failed";

type SpeechResultEventLike = {
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

type ActiveSession =
  | { id: number; kind: "pending" }
  | {
      id: number;
      kind: "native";
      recognition: BrowserSpeechRecognition;
      watchdog: number;
      resultSeen: boolean;
      errorSeen: boolean;
    }
  | {
      id: number;
      kind: "cloud";
      recorder: MediaRecorder;
      stream: MediaStream;
      timeout: number;
      chunks: Blob[];
      canceled: boolean;
    };

type UseVoiceInputOptions = {
  accessToken?: string;
  onAlternatives: (alternatives: VoiceAlternative[]) => void;
  onError: (code: VoiceInputErrorCode) => void;
};

const MAX_RECORDING_MS = 9_000;
const NATIVE_WATCHDOG_MS = 11_000;
let cloudAvailabilityPromise: Promise<boolean> | null = null;

export function useVoiceInput({
  accessToken,
  onAlternatives,
  onError,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const statusRef = useRef<VoiceInputStatus>("idle");
  const activeRef = useRef<ActiveSession | null>(null);
  const sessionCounterRef = useRef(0);
  const alternativesRef = useRef(onAlternatives);
  const errorRef = useRef(onError);

  useEffect(() => {
    alternativesRef.current = onAlternatives;
    errorRef.current = onError;
  }, [onAlternatives, onError]);

  const updateStatus = useCallback((next: VoiceInputStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const finishWithError = useCallback(
    (id: number, code: VoiceInputErrorCode) => {
      if (activeRef.current?.id !== id) return;
      activeRef.current = null;
      updateStatus("idle");
      errorRef.current(code);
    },
    [updateStatus],
  );

  const finishWithAlternatives = useCallback(
    (id: number, alternatives: VoiceAlternative[]) => {
      if (activeRef.current?.id !== id) return;
      activeRef.current = null;
      updateStatus("idle");
      alternativesRef.current(alternatives);
    },
    [updateStatus],
  );

  const cancel = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    sessionCounterRef.current += 1;
    updateStatus("idle");
    if (!active) return;

    if (active.kind === "native") {
      window.clearTimeout(active.watchdog);
      try {
        active.recognition.abort();
      } catch {
        // Safari can throw when the recognizer has already ended.
      }
    }
    if (active.kind === "cloud") {
      active.canceled = true;
      window.clearTimeout(active.timeout);
      stopTracks(active.stream);
      if (active.recorder.state !== "inactive") active.recorder.stop();
    }
  }, [updateStatus]);

  useEffect(() => cancel, [cancel]);

  const startCloud = useCallback(
    async (id: number) => {
      if (activeRef.current?.id !== id) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        finishWithError(id, "unsupported");
        return;
      }

      updateStatus("requesting");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (error) {
        finishWithError(id, microphoneErrorCode(error));
        return;
      }

      if (activeRef.current?.id !== id) {
        stopTracks(stream);
        return;
      }

      let recorder: MediaRecorder;
      try {
        const mimeType = preferredRecorderMimeType();
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        stopTracks(stream);
        finishWithError(id, "start-failed");
        return;
      }

      const chunks: Blob[] = [];
      const timeout = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_RECORDING_MS);
      const session: ActiveSession = {
        id,
        kind: "cloud",
        recorder,
        stream,
        timeout,
        chunks,
        canceled: false,
      };
      activeRef.current = session;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        window.clearTimeout(timeout);
        stopTracks(stream);
        finishWithError(id, "no-microphone");
      };
      recorder.onstart = () => updateStatus("listening");
      recorder.onstop = async () => {
        window.clearTimeout(timeout);
        stopTracks(stream);
        const current = activeRef.current;
        if (!current || current.id !== id || current.kind !== "cloud" || current.canceled) return;

        updateStatus("processing");
        try {
          const source = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
          if (source.size === 0) {
            finishWithError(id, "no-speech");
            return;
          }
          const wav = await recordingToPcmWav(source);
          if (activeRef.current?.id !== id) return;

          const response = await fetch("/api/speech", {
            method: "POST",
            headers: {
              "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: wav,
          });
          const payload = (await response.json()) as {
            alternatives?: VoiceAlternative[];
            error?: { code?: string };
          };
          if (!response.ok) {
            finishWithError(id, cloudErrorCode(payload.error?.code));
            return;
          }

          const alternatives = normalizeAlternatives(payload.alternatives ?? []);
          if (alternatives.length === 0) {
            finishWithError(id, "unclear");
            return;
          }
          finishWithAlternatives(id, alternatives);
        } catch {
          finishWithError(id, "service-unavailable");
        }
      };

      try {
        recorder.start(250);
      } catch {
        window.clearTimeout(timeout);
        stopTracks(stream);
        finishWithError(id, "start-failed");
      }
    },
    [accessToken, finishWithAlternatives, finishWithError, updateStatus],
  );

  const fallbackToCloud = useCallback(
    async (id: number, nativeError: VoiceInputErrorCode) => {
      if (activeRef.current?.id !== id) return;
      activeRef.current = { id, kind: "pending" };
      updateStatus("requesting");
      if (await cloudSpeechAvailable()) {
        if (activeRef.current?.id === id) await startCloud(id);
        return;
      }
      finishWithError(id, nativeError);
    },
    [finishWithError, startCloud, updateStatus],
  );

  const startNative = useCallback(
    (id: number, Recognition: SpeechRecognitionConstructor) => {
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 5;

      const watchdog = window.setTimeout(() => {
        const current = activeRef.current;
        if (!current || current.id !== id || current.kind !== "native") return;
        try {
          recognition.abort();
        } catch {
          // The watchdog still moves to the cloud path if Safari is stuck.
        }
        void fallbackToCloud(id, "service-unavailable");
      }, NATIVE_WATCHDOG_MS);

      const session: ActiveSession = {
        id,
        kind: "native",
        recognition,
        watchdog,
        resultSeen: false,
        errorSeen: false,
      };
      activeRef.current = session;

      recognition.onstart = () => updateStatus("listening");
      recognition.onaudiostart = () => updateStatus("listening");
      recognition.onresult = (event) => {
        const current = activeRef.current;
        if (!current || current.id !== id || current.kind !== "native") return;
        current.resultSeen = true;
        window.clearTimeout(current.watchdog);
        const result = event.results[event.results.length - 1];
        const alternatives = normalizeAlternatives(
          Array.from({ length: result.length }, (_, index) => ({
            transcript: result[index].transcript,
            confidence: result[index].confidence,
          })),
        );
        if (alternatives.length === 0) finishWithError(id, "unclear");
        else finishWithAlternatives(id, alternatives);
      };
      recognition.onerror = (event) => {
        const current = activeRef.current;
        if (!current || current.id !== id || current.kind !== "native") return;
        current.errorSeen = true;
        window.clearTimeout(current.watchdog);
        const code = nativeErrorCode(event.error);
        if (event.error === "network" || event.error === "service-not-allowed") {
          void fallbackToCloud(id, code);
        } else {
          finishWithError(id, code);
        }
      };
      recognition.onend = () => {
        const current = activeRef.current;
        if (!current || current.id !== id || current.kind !== "native") return;
        window.clearTimeout(current.watchdog);
        if (!current.resultSeen && !current.errorSeen) finishWithError(id, "no-speech");
      };

      try {
        recognition.start();
      } catch {
        window.clearTimeout(watchdog);
        void fallbackToCloud(id, "start-failed");
      }
    },
    [fallbackToCloud, finishWithAlternatives, finishWithError, updateStatus],
  );

  const start = useCallback(async () => {
    if (statusRef.current !== "idle" || activeRef.current) return;
    const id = ++sessionCounterRef.current;
    activeRef.current = { id, kind: "pending" };
    updateStatus("requesting");

    const browserWindow = window as SpeechRecognitionWindow;
    const Recognition =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    const preferCloud = isAppleBrowser() || !Recognition;

    if (preferCloud && (await cloudSpeechAvailable())) {
      if (activeRef.current?.id === id) await startCloud(id);
      return;
    }
    if (activeRef.current?.id !== id) return;
    if (!Recognition) {
      finishWithError(id, "unsupported");
      return;
    }
    startNative(id, Recognition);
  }, [finishWithError, startCloud, startNative, updateStatus]);

  const stop = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (active.kind === "native") {
      try {
        active.recognition.stop();
      } catch {
        finishWithError(active.id, "start-failed");
      }
    }
    if (active.kind === "cloud" && active.recorder.state === "recording") {
      active.recorder.stop();
    }
  }, [finishWithError]);

  return { status, start, stop, cancel };
}

async function cloudSpeechAvailable(): Promise<boolean> {
  cloudAvailabilityPromise ??= fetch("/api/speech", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) return false;
      const payload = (await response.json()) as { available?: boolean };
      return payload.available === true;
    })
    .catch(() => false)
    .then((available) => {
      if (!available) cloudAvailabilityPromise = null;
      return available;
    });
  return cloudAvailabilityPromise;
}

function isAppleBrowser(): boolean {
  const vendor = navigator.vendor.toLowerCase();
  const userAgent = navigator.userAgent;
  return vendor.includes("apple") || /iPad|iPhone|iPod/.test(userAgent);
}

function nativeErrorCode(value: string): VoiceInputErrorCode {
  switch (value) {
    case "not-allowed":
      return "blocked";
    case "audio-capture":
      return "no-microphone";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "service-not-allowed":
      return "service-unavailable";
    case "language-not-supported":
      return "language-unsupported";
    case "aborted":
      return "start-failed";
    default:
      return "unclear";
  }
}

function microphoneErrorCode(error: unknown): VoiceInputErrorCode {
  if (!(error instanceof DOMException)) return "no-microphone";
  if (error.name === "NotAllowedError" || error.name === "SecurityError") return "blocked";
  if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
    return "no-microphone";
  }
  return "no-microphone";
}

function cloudErrorCode(value: string | undefined): VoiceInputErrorCode {
  switch (value) {
    case "SPEECH_NO_SPEECH":
      return "no-speech";
    case "SPEECH_NO_MATCH":
    case "SPEECH_INVALID_AUDIO":
      return "unclear";
    case "SPEECH_RATE_LIMITED":
      return "rate-limited";
    case "SPEECH_TIMEOUT":
    case "SPEECH_UPSTREAM_UNAVAILABLE":
      return "network";
    default:
      return "service-unavailable";
  }
}

function normalizeAlternatives(values: VoiceAlternative[]): VoiceAlternative[] {
  const alternatives: VoiceAlternative[] = [];
  for (const value of values) {
    const transcript = normalizeVocabularyInput(value.transcript).slice(0, 160);
    if (!transcript || alternatives.some((item) => item.transcript === transcript)) continue;
    alternatives.push({ transcript, confidence: value.confidence });
    if (alternatives.length >= 5) break;
  }
  return alternatives;
}

function preferredRecorderMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm",
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value));
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

async function recordingToPcmWav(blob: Blob): Promise<ArrayBuffer> {
  const browserWindow = window as SpeechRecognitionWindow;
  const AudioContextConstructor = window.AudioContext ?? browserWindow.webkitAudioContext;
  const OfflineAudioContextConstructor =
    window.OfflineAudioContext ?? browserWindow.webkitOfflineAudioContext;
  if (!AudioContextConstructor || !OfflineAudioContextConstructor) {
    throw new Error("Audio conversion is unavailable.");
  }

  const context = new AudioContextConstructor();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }

  const sampleRate = 16_000;
  const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const offline = new OfflineAudioContextConstructor(1, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodePcmWav(rendered.getChannelData(0), sampleRate);
}

function encodePcmWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
