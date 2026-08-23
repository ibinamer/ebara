const PRONUNCIATION_PATH = "/api/pronunciation";
const VOICE_NAME = "en-US-Chirp3-HD-Charon";
const VOICE_LANGUAGE = "en-US";
const CACHE_VERSION = "v1";
const MAX_TERM_LENGTH = 80;
const TERM_PATTERN = /^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/;

type R2ObjectBodyLike = {
  body: ReadableStream;
  httpEtag?: string;
};

type R2BucketLike = {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

export interface PronunciationEnv {
  AUDIO?: R2BucketLike;
  GOOGLE_CLOUD_TTS_SERVICE_ACCOUNT_JSON?: string;
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedAccessToken = {
  clientEmail: string;
  token: string;
  expiresAt: number;
};

let cachedAccessToken: CachedAccessToken | null = null;

function jsonResponse(message: string, status: number): Response {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Pronunciation-Fallback": "browser",
      },
    },
  );
}

export function normalizePronunciationTerm(value: string): string | null {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    normalized.length > MAX_TERM_LENGTH ||
    !TERM_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function cacheKey(term: string): string {
  return `${CACHE_VERSION}/${VOICE_NAME}/${term.replaceAll(" ", "_")}.mp3`;
}

function audioResponse(
  body: BodyInit,
  cacheStatus: "HIT" | "MISS",
  etag?: string,
): Response {
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "X-Audio-Cache": cacheStatus,
  });
  if (etag) headers.set("ETag", etag);
  return new Response(body, { status: 200, headers });
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (
      typeof parsed.client_email !== "string" ||
      !parsed.client_email.trim() ||
      typeof parsed.private_key !== "string" ||
      !parsed.private_key.includes("BEGIN PRIVATE KEY")
    ) {
      return null;
    }
    return {
      client_email: parsed.client_email.trim(),
      private_key: parsed.private_key,
      token_uri:
        typeof parsed.token_uri === "string" && parsed.token_uri.startsWith("https://")
          ? parsed.token_uri
          : "https://oauth2.googleapis.com/token",
    };
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function privateKeyBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createSignedAssertion(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textToBase64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function getAccessToken(
  account: ServiceAccount,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (
    cachedAccessToken?.clientEmail === account.client_email &&
    cachedAccessToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedAccessToken.token;
  }

  const assertion = await createSignedAssertion(account);
  const response = await fetchImpl(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("Google OAuth rejected the service account.");

  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Google OAuth did not return an access token.");
  }
  const expiresIn =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 3600;
  cachedAccessToken = {
    clientEmail: account.client_email,
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return payload.access_token;
}

function decodeAudioContent(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function synthesizePronunciation(
  term: string,
  account: ServiceAccount,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const accessToken = await getAccessToken(account, fetchImpl);
  const response = await fetchImpl("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      input: { text: term },
      voice: { languageCode: VOICE_LANGUAGE, name: VOICE_NAME },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.9 },
    }),
  });
  if (!response.ok) throw new Error("Google Cloud Text-to-Speech rejected the request.");

  const payload = (await response.json()) as { audioContent?: unknown };
  if (typeof payload.audioContent !== "string" || !payload.audioContent) {
    throw new Error("Google Cloud Text-to-Speech returned no audio.");
  }
  return decodeAudioContent(payload.audioContent);
}

/**
 * Serves one shared Chirp 3 HD pronunciation per normalized English term.
 * Returning null lets the main Vinext handler process every unrelated route.
 */
export async function handlePronunciationRequest(
  request: Request,
  env: PronunciationEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PRONUNCIATION_PATH) return null;
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }

  const term = normalizePronunciationTerm(url.searchParams.get("word") ?? "");
  if (!term) return jsonResponse("Enter a valid English word or phrase.", 400);
  if (!env.AUDIO) return jsonResponse("Pronunciation storage is not configured.", 503);

  const key = cacheKey(term);
  const cached = await env.AUDIO.get(key);
  if (cached) return audioResponse(cached.body, "HIT", cached.httpEtag);

  const account = parseServiceAccount(env.GOOGLE_CLOUD_TTS_SERVICE_ACCOUNT_JSON ?? "");
  if (!account) return jsonResponse("Google Cloud Text-to-Speech is not configured.", 503);

  try {
    const audio = await synthesizePronunciation(term, account, fetchImpl);
    await env.AUDIO.put(key, audio, {
      httpMetadata: {
        contentType: "audio/mpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { term, voice: VOICE_NAME },
    });
    return audioResponse(audio, "MISS");
  } catch {
    return jsonResponse("The high-quality pronunciation is temporarily unavailable.", 503);
  }
}
