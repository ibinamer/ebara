export const runtime = "edge";

const GOOGLE_TRANSLATE_URL =
  "https://translation.googleapis.com/language/translate/v2";
const MAX_BODY_BYTES = 2_048;
const MAX_WORD_LENGTH = 80;
const MAX_WORDS = 8;
const REQUEST_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 8_000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2_000;

const LATIN_WORD_PATTERN =
  /^\p{Script=Latin}+(?:[ '\-\u2019]\p{Script=Latin}+)*$/u;

export type TranslationResult = {
  word: string;
  meaning_ar: string;
};

export type TranslateErrorCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_UNAVAILABLE"
  | "AUTH_CONFIGURATION_ERROR"
  | "GOOGLE_TRANSLATE_API_KEY_MISSING"
  | "GOOGLE_TRANSLATE_TIMEOUT"
  | "GOOGLE_TRANSLATE_UNAVAILABLE"
  | "GOOGLE_TRANSLATE_RATE_LIMITED"
  | "GOOGLE_TRANSLATE_AUTH_ERROR"
  | "GOOGLE_TRANSLATE_UPSTREAM_ERROR"
  | "GOOGLE_TRANSLATE_INVALID_RESPONSE";

type RateBucket = {
  count: number;
  resetAt: number;
};

type RateDecision = RateBucket & {
  allowed: boolean;
  remaining: number;
};

type AuthFailureCode = Extract<
  TranslateErrorCode,
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_UNAVAILABLE"
  | "AUTH_CONFIGURATION_ERROR"
>;

type AuthDecision =
  | { ok: true }
  | {
      ok: false;
      code: AuthFailureCode;
      message: string;
      status: number;
      retryAfter?: string;
    };

const rateBuckets = new Map<string, RateBucket>();

export async function POST(request: Request): Promise<Response> {
  const rate = consumeRateLimit(clientKey(request), Date.now());
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000));
    return errorResponse(
      "RATE_LIMITED",
      "Too many translation requests. Please try again shortly.",
      429,
      rate,
      { "Retry-After": String(retryAfter) },
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return errorResponse(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
      415,
      rate,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse(
      "PAYLOAD_TOO_LARGE",
      "The request body is too large.",
      413,
      rate,
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse(
      "INVALID_JSON",
      "The request body could not be read as JSON.",
      400,
      rate,
    );
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse(
      "PAYLOAD_TOO_LARGE",
      "The request body is too large.",
      413,
      rate,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse(
      "INVALID_JSON",
      "The request body must contain valid JSON.",
      400,
      rate,
    );
  }

  const word = parseWordPayload(payload);
  if (!word) {
    return errorResponse(
      "INVALID_PAYLOAD",
      "Send exactly one short English word or phrase in the word field.",
      400,
      rate,
    );
  }

  const auth = await authenticateSupabaseRequest(request);
  if (!auth.ok) {
    return errorResponse(
      auth.code,
      auth.message,
      auth.status,
      rate,
      auth.retryAfter ? { "Retry-After": auth.retryAfter } : undefined,
    );
  }

  const apiKey = getRuntimeString("GOOGLE_TRANSLATE_API_KEY");
  if (!apiKey) {
    return errorResponse(
      "GOOGLE_TRANSLATE_API_KEY_MISSING",
      "Translation is not configured on this server.",
      503,
      rate,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream: Response;

  try {
    upstream = await fetch(GOOGLE_TRANSLATE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q: word,
        source: "en",
        target: "ar",
        format: "text",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return errorResponse(
        "GOOGLE_TRANSLATE_TIMEOUT",
        "Translation took too long. Please try again.",
        504,
        rate,
      );
    }

    return errorResponse(
      "GOOGLE_TRANSLATE_UNAVAILABLE",
      "Translation is temporarily unavailable.",
      502,
      rate,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    if (upstream.status === 429) {
      const retryAfter = safeRetryAfter(upstream.headers.get("retry-after"));
      return errorResponse(
        "GOOGLE_TRANSLATE_RATE_LIMITED",
        "Translation is busy. Please try again shortly.",
        429,
        rate,
        retryAfter ? { "Retry-After": retryAfter } : undefined,
      );
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return errorResponse(
        "GOOGLE_TRANSLATE_AUTH_ERROR",
        "Translation is not authorized on this server.",
        502,
        rate,
      );
    }

    if (upstream.status >= 500) {
      return errorResponse(
        "GOOGLE_TRANSLATE_UNAVAILABLE",
        "Translation is temporarily unavailable.",
        502,
        rate,
      );
    }

    return errorResponse(
      "GOOGLE_TRANSLATE_UPSTREAM_ERROR",
      "Translation could not be completed.",
      502,
      rate,
    );
  }

  let googleResponse: unknown;
  try {
    googleResponse = await upstream.json();
  } catch {
    return errorResponse(
      "GOOGLE_TRANSLATE_INVALID_RESPONSE",
      "Translation returned an unreadable response.",
      502,
      rate,
    );
  }

  const meaning = parseTranslatedText(googleResponse);
  if (!meaning) {
    return errorResponse(
      "GOOGLE_TRANSLATE_INVALID_RESPONSE",
      "Translation returned data in an unexpected shape.",
      502,
      rate,
    );
  }

  return Response.json(
    {
      ok: true as const,
      data: { word, meaning_ar: meaning } satisfies TranslationResult,
    },
    { status: 200, headers: responseHeaders(rate) },
  );
}

function parseWordPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "word") return null;
  if (typeof payload.word !== "string") return null;

  const word = payload.word.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!word || word.length > MAX_WORD_LENGTH) return null;
  if (word.split(" ").length > MAX_WORDS) return null;
  if (!LATIN_WORD_PATTERN.test(word)) return null;

  return word;
}

function parseTranslatedText(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  if (!Array.isArray(value.data.translations)) return null;
  if (value.data.translations.length !== 1) return null;

  const translation = value.data.translations[0];
  if (!isRecord(translation)) return null;

  const translatedText = boundedString(translation.translatedText, 1_000);
  return translatedText ? decodeHtmlEntities(translatedText) : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#39|#x27|#\d{1,7}|#x[\da-f]{1,6});/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
      };
      const known = named[entity.toLowerCase()];
      if (known) return known;

      const numeric = entity.match(/^&#(x?)([\da-f]+);$/i);
      if (!numeric) return entity;

      const codePoint = Number.parseInt(numeric[2], numeric[1] ? 16 : 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function consumeRateLimit(key: string, now: number): RateDecision {
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
  return {
    ...bucket,
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT - bucket.count),
  };
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

function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim();

  if (ip) return ip.slice(0, 128);

  const userAgent = request.headers.get("user-agent")?.slice(0, 160) ?? "unknown";
  return `unknown:${userAgent}`;
}

async function authenticateSupabaseRequest(
  request: Request,
): Promise<AuthDecision> {
  const supabaseUrl =
    getRuntimeString("SUPABASE_URL") ??
    getRuntimeString("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey =
    getRuntimeString("SUPABASE_ANON_KEY") ??
    getRuntimeString("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      code: "AUTH_CONFIGURATION_ERROR",
      message: "Authentication is not configured correctly on this server.",
      status: 503,
    };
  }

  const userEndpoint = supabaseUserEndpoint(supabaseUrl);
  if (!userEndpoint) {
    return {
      ok: false,
      code: "AUTH_CONFIGURATION_ERROR",
      message: "Authentication is not configured correctly on this server.",
      status: 503,
    };
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = bearerMatch?.[1]?.trim();
  if (!token || token.length > 8_192) {
    return {
      ok: false,
      code: "AUTH_REQUIRED",
      message: "Log in before translating a word.",
      status: 401,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(userEndpoint, {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: "AUTH_INVALID",
        message: "Your session has expired. Please log in again.",
        status: 401,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: "AUTH_UNAVAILABLE",
        message: "Your session could not be verified. Please try again.",
        status: 503,
        retryAfter: safeRetryAfter(response.headers.get("retry-after")),
      };
    }

    let user: unknown;
    try {
      user = await response.json();
    } catch {
      return {
        ok: false,
        code: "AUTH_UNAVAILABLE",
        message: "Your session could not be verified. Please try again.",
        status: 503,
      };
    }

    if (!isRecord(user) || typeof user.id !== "string" || !user.id.trim()) {
      return {
        ok: false,
        code: "AUTH_UNAVAILABLE",
        message: "Your session could not be verified. Please try again.",
        status: 503,
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      code: "AUTH_UNAVAILABLE",
      message: "Your session could not be verified. Please try again.",
      status: 503,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function supabaseUserEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1");
  if (url.protocol !== "https:" && !isLocalHttp) return null;

  url.pathname = "/auth/v1/user";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getRuntimeString(name: string): string | null {
  // Vinext's Workers config exposes text variables and secrets through
  // process.env when nodejs_compat is enabled. Avoid importing Node modules so
  // this route remains importable in edge and render-test runtimes.
  const runtimeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const processValue = runtimeGlobal.process?.env?.[name]?.trim();
  return processValue || null;
}

function errorResponse(
  code: TranslateErrorCode,
  message: string,
  status: number,
  rate: RateDecision,
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code, message },
      message,
    },
    { status, headers: responseHeaders(rate, extraHeaders) },
  );
}

function responseHeaders(
  rate: RateDecision,
  extraHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("X-RateLimit-Limit", String(RATE_LIMIT));
  headers.set("X-RateLimit-Remaining", String(rate.remaining));
  headers.set("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1_000)));
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function safeRetryAfter(value: string | null): string | undefined {
  if (!value) return undefined;
  const retryAfter = value.trim();
  return /^\d{1,6}$/.test(retryAfter) ? retryAfter : undefined;
}
