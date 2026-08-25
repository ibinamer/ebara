import { reserveAzureSpeechMilliseconds } from "../../../db/azure-speech-usage";

export const runtime = "edge";

const MAX_BODY_BYTES = 350_000;
const MAX_AUDIO_MILLISECONDS = 10_000;
const REQUEST_TIMEOUT_MS = 12_000;
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2_000;

type RateBucket = { count: number; resetAt: number };
type SpeechAlternative = { transcript: string; confidence: number };

const rateBuckets = new Map<string, RateBucket>();

export async function GET(): Promise<Response> {
  return Response.json(
    { available: Boolean(getSpeechConfiguration()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const rate = takeRateLimit(clientKey(request));
  if (!rate.allowed) {
    return errorResponse("SPEECH_RATE_LIMITED", "Too many voice attempts.", 429, rate);
  }

  const configuration = getSpeechConfiguration();
  if (!configuration) {
    return errorResponse(
      "SPEECH_NOT_CONFIGURED",
      "Cloud speech recognition is not configured.",
      503,
      rate,
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("audio/wav")) {
    return errorResponse(
      "SPEECH_UNSUPPORTED_MEDIA",
      "Voice input must be a PCM WAV recording.",
      415,
      rate,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse("SPEECH_TOO_LARGE", "The recording is too long.", 413, rate);
  }

  const audio = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!audio) {
    return errorResponse("SPEECH_TOO_LARGE", "The recording is too long.", 413, rate);
  }

  const metadata = inspectPcmWav(audio);
  if (!metadata) {
    return errorResponse(
      "SPEECH_INVALID_AUDIO",
      "The microphone recording is invalid.",
      400,
      rate,
    );
  }
  if (metadata.durationMilliseconds > MAX_AUDIO_MILLISECONDS) {
    return errorResponse("SPEECH_TOO_LARGE", "The recording is too long.", 413, rate);
  }

  const reservation = await reserveAzureSpeechMilliseconds(metadata.durationMilliseconds);
  if (!reservation.allowed) {
    return errorResponse(
      reservation.reason === "hard-limit-reached"
        ? "SPEECH_USAGE_LIMIT"
        : "SPEECH_METER_UNAVAILABLE",
      "Cloud speech recognition is temporarily unavailable.",
      503,
      rate,
    );
  }

  if (reservation.warningJustReached) {
    console.warn("[speech-usage] Azure Speech warning threshold reached");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = new URL(
      `https://${configuration.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
    );
    url.searchParams.set("language", "en-US");
    url.searchParams.set("format", "detailed");
    url.searchParams.set("profanity", "raw");

    const azureBody = new Uint8Array(audio).buffer;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Ocp-Apim-Subscription-Key": configuration.key,
      },
      body: azureBody,
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return errorResponse(
        "SPEECH_CONFIGURATION_ERROR",
        "Cloud speech recognition is configured incorrectly.",
        503,
        rate,
      );
    }
    if (response.status === 429) {
      return errorResponse(
        "SPEECH_RATE_LIMITED",
        "Cloud speech recognition is busy.",
        429,
        rate,
      );
    }
    if (!response.ok) {
      return errorResponse(
        "SPEECH_UPSTREAM_UNAVAILABLE",
        "Cloud speech recognition is unavailable.",
        503,
        rate,
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = parseAzureSpeechResult(payload);
    if (!parsed.ok) {
      return errorResponse(parsed.code, parsed.message, 422, rate);
    }

    return Response.json(
      { ok: true as const, alternatives: parsed.alternatives },
      { headers: responseHeaders(rate) },
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error && error.name === "AbortError"
        ? "SPEECH_TIMEOUT"
        : "SPEECH_UPSTREAM_UNAVAILABLE",
      "Cloud speech recognition is unavailable.",
      503,
      rate,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function getSpeechConfiguration(): { key: string; region: string } | null {
  const key = getRuntimeString("AZURE_SPEECH_KEY");
  const region = getRuntimeString("AZURE_SPEECH_REGION")?.toLowerCase();
  if (!key || !region || !/^[a-z0-9-]{2,40}$/.test(region)) return null;
  return { key, region };
}

function getRuntimeString(name: string): string | null {
  const runtimeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtimeGlobal.process?.env?.[name]?.trim() || null;
}

async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function inspectPcmWav(bytes: Uint8Array): { durationMilliseconds: number } | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;

  let offset = 12;
  let format: { channels: number; sampleRate: number; blockAlign: number; bits: number } | null = null;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > bytes.byteLength) return null;

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = view.getUint16(chunkStart, true);
      format = {
        channels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        blockAlign: view.getUint16(chunkStart + 12, true),
        bits: view.getUint16(chunkStart + 14, true),
      };
      if (audioFormat !== 1) return null;
    }
    if (chunkId === "data") dataSize = chunkSize;

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (
    !format ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bits !== 16 ||
    format.blockAlign !== 2 ||
    dataSize <= 0
  ) {
    return null;
  }

  return {
    durationMilliseconds: Math.ceil((dataSize / (format.sampleRate * format.blockAlign)) * 1_000),
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parseAzureSpeechResult(
  value: unknown,
):
  | { ok: true; alternatives: SpeechAlternative[] }
  | { ok: false; code: string; message: string } {
  if (!isRecord(value)) {
    return { ok: false, code: "SPEECH_INVALID_RESPONSE", message: "Invalid speech response." };
  }

  const status = typeof value.RecognitionStatus === "string" ? value.RecognitionStatus : "";
  if (status !== "Success") {
    const noSpeech = status === "InitialSilenceTimeout" || status === "BabbleTimeout";
    return {
      ok: false,
      code: noSpeech ? "SPEECH_NO_SPEECH" : "SPEECH_NO_MATCH",
      message: noSpeech ? "No speech was detected." : "Speech could not be recognized.",
    };
  }

  const candidates = Array.isArray(value.NBest) ? value.NBest : [];
  const alternatives: SpeechAlternative[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.Display !== "string") continue;
    const transcript = candidate.Display.trim().slice(0, 160);
    if (!transcript || alternatives.some((item) => item.transcript === transcript)) continue;
    alternatives.push({
      transcript,
      confidence: typeof candidate.Confidence === "number" ? candidate.Confidence : 0,
    });
    if (alternatives.length >= 5) break;
  }

  if (alternatives.length === 0 && typeof value.DisplayText === "string") {
    const transcript = value.DisplayText.trim().slice(0, 160);
    if (transcript) alternatives.push({ transcript, confidence: 0 });
  }

  if (alternatives.length === 0) {
    return { ok: false, code: "SPEECH_NO_MATCH", message: "Speech could not be recognized." };
  }
  return { ok: true, alternatives };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim();
  if (ip) return ip.slice(0, 128);
  return `unknown:${request.headers.get("user-agent")?.slice(0, 160) ?? "unknown"}`;
}

function takeRateLimit(key: string): RateBucket & { allowed: boolean; remaining: number } {
  const now = Date.now();
  pruneRateBuckets(now);
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
    return { ...bucket, allowed: true, remaining: RATE_LIMIT - 1 };
  }
  if (current.count >= RATE_LIMIT) {
    return { ...current, allowed: false, remaining: 0 };
  }
  const bucket = { ...current, count: current.count + 1 };
  rateBuckets.set(key, bucket);
  return { ...bucket, allowed: true, remaining: RATE_LIMIT - bucket.count };
}

function pruneRateBuckets(now: number): void {
  if (rateBuckets.size < MAX_RATE_BUCKETS) return;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
  while (rateBuckets.size >= MAX_RATE_BUCKETS) {
    const oldestKey = rateBuckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    rateBuckets.delete(oldestKey);
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  rate: RateBucket & { remaining: number },
): Response {
  return Response.json(
    { ok: false as const, error: { code, message } },
    { status, headers: responseHeaders(rate) },
  );
}

function responseHeaders(rate: RateBucket & { remaining: number }): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.set("X-RateLimit-Limit", String(RATE_LIMIT));
  headers.set("X-RateLimit-Remaining", String(rate.remaining));
  headers.set("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1_000)));
  return headers;
}
