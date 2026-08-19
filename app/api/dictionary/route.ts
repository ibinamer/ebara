export const runtime = "edge";

const FREE_DICTIONARY_BASE_URL =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";
const WIKTIONARY_API_URL = "https://en.wiktionary.org/w/api.php";
// Wikimedia's robot policy requires a descriptive agent string on every request.
const WIKIMEDIA_USER_AGENT = "EBARA/1.0 (personal vocabulary app; dictionary lookup)";
const GOOGLE_TRANSLATE_PUBLIC_URL =
  "https://translate.googleapis.com/translate_a/single";
const MYMEMORY_API_URL = "https://api.mymemory.translated.net/get";
const MAX_BODY_BYTES = 2_048;
const MAX_WORD_LENGTH = 80;
const MAX_UPSTREAM_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 8_000;
// Every outbound call below is a single-shot request to a third-party service
// EBARA does not control. A transient blip there (a 5xx, a dropped
// connection, a slow response) used to fail the whole lookup outright, which
// is what made ordinary words intermittently "not translate" — retrying the
// same request once, after a short pause, clears the vast majority of these
// without meaningfully slowing down the common case where the first attempt
// just works.
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 350;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2_000;

const MAX_TERM_WORDS = 6;

// A single orthographic word, optionally hyphenated or apostrophised.
const LATIN_WORD_SOURCE = String.raw`\p{Script=Latin}+(?:['\-\u2019]\p{Script=Latin}+)*`;
// A term is one such word, or several separated by single spaces \u2014 which is
// what lets set phrases like "catch up" or "look forward to" be looked up.
const LATIN_TERM_PATTERN = new RegExp(
  `^${LATIN_WORD_SOURCE}(?: ${LATIN_WORD_SOURCE})*$`,
  "u",
);
const ARABIC_CHARACTER_PATTERN = /\p{Script=Arabic}/u;

function isMultiWordTerm(value: string): boolean {
  return value.trim().includes(" ");
}

export type DictionaryResult = {
  word: string;
  // A short headword-level gloss (e.g. "بكاء"), sourced from Wiktionary's own
  // translation tables when it has one, machine-translated as a fallback.
  meaning_ar: string;
  definition_en: string;
  // A full Arabic translation of definition_en itself — a distinct field
  // from meaning_ar, always machine-translated since no dictionary source
  // publishes ready-made definition translations.
  definition_ar: string;
  pronunciation: string;
  ipa: string;
  part_of_speech: string;
  example_sentence: string;
};

export type DictionaryErrorCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_UNAVAILABLE"
  | "AUTH_CONFIGURATION_ERROR"
  | "CACHE_TIMEOUT"
  | "CACHE_UNAVAILABLE"
  | "CACHE_RATE_LIMITED"
  | "CACHE_UPSTREAM_ERROR"
  | "CACHE_INVALID_RESPONSE"
  | "DICTIONARY_NOT_FOUND"
  | "DICTIONARY_TIMEOUT"
  | "DICTIONARY_UNAVAILABLE"
  | "DICTIONARY_RATE_LIMITED"
  | "DICTIONARY_UPSTREAM_ERROR"
  | "DICTIONARY_INVALID_RESPONSE"
  | "WIKTIONARY_TIMEOUT"
  | "WIKTIONARY_UNAVAILABLE"
  | "WIKTIONARY_RATE_LIMITED"
  | "WIKTIONARY_UPSTREAM_ERROR"
  | "WIKTIONARY_INVALID_RESPONSE"
  | "ARABIC_MEANING_NOT_FOUND";

type RateBucket = {
  count: number;
  resetAt: number;
};

type RateDecision = RateBucket & {
  allowed: boolean;
  remaining: number;
};

type AuthFailureCode = Extract<
  DictionaryErrorCode,
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_UNAVAILABLE"
  | "AUTH_CONFIGURATION_ERROR"
>;

type AuthDecision =
  | {
      ok: true;
      userId: string;
      token: string;
      supabaseUrl: string;
      supabaseApiKey: string;
    }
  | {
      ok: false;
      code: AuthFailureCode;
      message: string;
      status: number;
      retryAfter?: string;
    };

type LookupFailure = {
  ok: false;
  code: DictionaryErrorCode;
  message: string;
  status: number;
  retryAfter?: string;
};

type LookupSuccess<T> = { ok: true; data: T };
type LookupDecision<T> = LookupSuccess<T> | LookupFailure;

type EnglishDictionaryData = Omit<DictionaryResult, "meaning_ar" | "definition_ar">;

type TranslationBox = {
  gloss: string;
  arabicTerms: string[];
  order: number;
};

const rateBuckets = new Map<string, RateBucket>();

export async function POST(request: Request): Promise<Response> {
  const rate = consumeRateLimit(clientKey(request), Date.now());
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000));
    return errorResponse(
      "RATE_LIMITED",
      "Too many dictionary requests. Please try again shortly.",
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
      "Send exactly one English word in the word field.",
      400,
      rate,
    );
  }

  const hasBearerToken = /^Bearer\s+\S+$/iu.test(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (hasBearerToken) {
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

    const cached = await findCachedWord(auth, word);
    if (!cached.ok) return lookupErrorResponse(cached, rate);
    if (cached.data) {
      return Response.json(
        { ok: true as const, cached: true, data: cached.data },
        { status: 200, headers: responseHeaders(rate) },
      );
    }
  }

  // Both sources are ordinary published dictionaries. Starting the independent
  // reads together keeps the save interaction fast without generating content.
  const [english, mainWikitext] = await Promise.all([
    fetchEnglishDictionary(word),
    fetchWiktionaryWikitext(word),
  ]);

  let englishData: EnglishDictionaryData;
  if (english.ok) {
    englishData = english.data;
  } else {
    // Wiktionary was already fetched in parallel and is a fully independent
    // source, so its wikitext can rescue this lookup no matter *why* Free
    // Dictionary failed — a clean 404 (it has no entry for some ordinary set
    // phrases), or a transient timeout/5xx that had nothing to do with the
    // word itself. Gating this to 404 only used to mean a Free Dictionary
    // blip failed the whole lookup even when Wiktionary had the word right
    // there.
    const fromWiktionary =
      mainWikitext.ok && mainWikitext.data
        ? parseWiktionaryDefinition(mainWikitext.data, word)
        : null;
    if (!fromWiktionary) return lookupErrorResponse(english, rate);
    englishData = fromWiktionary;
  }

  // Anything spanning more than one word is filed as a phrase, so phrasal verbs
  // and idioms collect under a single browsable type rather than scattering
  // across the noun and verb buckets their head word happens to carry.
  if (isMultiWordTerm(englishData.word)) {
    englishData = { ...englishData, part_of_speech: "phrase" };
  }

  // meaning_ar: a short headword-level gloss. Wiktionary's own translation
  // tables give a real, curated dictionary answer when they have one; only
  // fall back to machine-translating the bare word when they don't.
  let meaningAr = mainWikitext.ok
    ? findArabicMeaning(mainWikitext.data, englishData.definition_en)
    : null;

  if (!meaningAr) {
    // Large Wiktionary entries sometimes move translation tables to a
    // dedicated subpage. This is still a direct dictionary lookup, not
    // machine translation.
    const translationSubpage = await fetchWiktionaryWikitext(`${englishData.word}/translations`);
    if (translationSubpage.ok) {
      meaningAr = findArabicMeaning(translationSubpage.data, englishData.definition_en);
    }
  }

  // definition_ar is a different field entirely: a full Arabic translation
  // of the definition sentence, not a short gloss. No dictionary source
  // publishes ready-made definition translations, so this is always machine
  // translation. It runs alongside whichever meaning_ar step is still
  // outstanding rather than after it, since the two are independent.
  const shortMeaningPromise: Promise<LookupDecision<string>> = meaningAr
    ? Promise.resolve({ ok: true as const, data: meaningAr })
    : translateToArabic(
        englishData.part_of_speech.toLocaleLowerCase("en").includes("noun")
          ? `a ${englishData.word}`
          : englishData.word,
      );

  const [meaningDecision, definitionDecision] = await Promise.all([
    shortMeaningPromise,
    translateToArabic(englishData.definition_en),
  ]);

  if (!meaningDecision.ok) return lookupErrorResponse(meaningDecision, rate);
  if (!definitionDecision.ok) return lookupErrorResponse(definitionDecision, rate);

  return Response.json(
    {
      ok: true as const,
      cached: false,
      data: {
        ...englishData,
        meaning_ar: meaningDecision.data,
        definition_ar: definitionDecision.data,
      } satisfies DictionaryResult,
    },
    { status: 200, headers: responseHeaders(rate) },
  );
}

/** Tries Google's translation endpoint first, MyMemory as the fallback. */
async function translateToArabic(text: string): Promise<LookupDecision<string>> {
  const google = await fetchGoogleArabicTranslation(text);
  if (google.ok) return google;
  return fetchArabicTranslation(text);
}

async function fetchGoogleArabicTranslation(
  text: string,
): Promise<LookupDecision<string>> {
  const url = new URL(GOOGLE_TRANSLATE_PUBLIC_URL);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", "ar");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const attempt = await fetchWithRetry(url, {}, REQUEST_TIMEOUT_MS);
  if (!attempt.ok) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service is temporarily unavailable.",
      502,
    );
  }
  const response = attempt.response;

  if (!response.ok) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service could not complete this lookup.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  const responseData = json.ok ? json.data : null;
  // A short word translates as a single segment, but Google's endpoint
  // splits a full sentence definition into several — `responseData[0]` is an
  // array of `[translatedChunk, originalChunk, ...]` tuples, one per clause.
  // Reading only the first entry, as a single-word lookup safely could, would
  // silently truncate any definition with more than one clause or sentence.
  const segments = Array.isArray(responseData) ? responseData[0] : null;
  const translated = Array.isArray(segments)
    ? boundedString(
        segments
          .map((segment) => (Array.isArray(segment) ? segment[0] : null))
          .filter((piece): piece is string => typeof piece === "string")
          .join(""),
        512,
      )
    : null;
  if (!translated || !ARABIC_CHARACTER_PATTERN.test(translated)) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "No Arabic meaning was found for this word.",
      422,
    );
  }
  return { ok: true, data: translated };
}

async function fetchArabicTranslation(
  text: string,
): Promise<LookupDecision<string>> {
  const url = new URL(MYMEMORY_API_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|ar");

  const attempt = await fetchWithRetry(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    REQUEST_TIMEOUT_MS,
  );
  if (!attempt.ok) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service is temporarily unavailable.",
      502,
    );
  }
  const response = attempt.response;

  if (!response.ok) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service could not complete this lookup.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok || !isRecord(json.data) || !isRecord(json.data.responseData)) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service returned an unreadable response.",
      502,
    );
  }

  const translated = boundedString(
    json.data.responseData.translatedText,
    512,
  );
  if (!translated || !ARABIC_CHARACTER_PATTERN.test(translated)) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "No Arabic meaning was found for this word.",
      422,
    );
  }

  return { ok: true, data: translated };
}

async function findCachedWord(
  auth: Extract<AuthDecision, { ok: true }>,
  word: string,
): Promise<LookupDecision<DictionaryResult | null>> {
  const url = supabaseWordsEndpoint(auth.supabaseUrl);
  if (!url) {
    return lookupFailure(
      "CACHE_UPSTREAM_ERROR",
      "The saved-word lookup is not configured correctly on this server.",
      503,
    );
  }

  url.searchParams.set(
    "select",
    "word,meaning_ar,definition_en,definition_ar,pronunciation,ipa,part_of_speech,example_sentence",
  );
  // The explicit owner filter complements RLS and keeps the query indexable.
  // Input validation excludes ILIKE wildcard characters, so this is an exact,
  // case-insensitive comparison rather than a pattern search.
  url.searchParams.set("user_id", `eq.${auth.userId}`);
  url.searchParams.set("word", `ilike.${word}`);
  url.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: auth.supabaseApiKey,
        Authorization: `Bearer ${auth.token}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    return isAbortError(error)
      ? lookupFailure(
          "CACHE_TIMEOUT",
          "Your saved words took too long to load. Please try again.",
          504,
        )
      : lookupFailure(
          "CACHE_UNAVAILABLE",
          "Your saved words are temporarily unavailable.",
          503,
        );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    return lookupFailure(
      "AUTH_INVALID",
      "Your session has expired. Please log in again.",
      401,
    );
  }

  if (response.status === 429) {
    return lookupFailure(
      "CACHE_RATE_LIMITED",
      "Your saved words are busy. Please try again shortly.",
      429,
      safeRetryAfter(response.headers.get("retry-after")),
    );
  }

  if (response.status >= 500) {
    return lookupFailure(
      "CACHE_UNAVAILABLE",
      "Your saved words are temporarily unavailable.",
      503,
    );
  }

  if (!response.ok) {
    return lookupFailure(
      "CACHE_UPSTREAM_ERROR",
      "Your saved words could not be checked.",
      503,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok || !Array.isArray(json.data) || json.data.length > 1) {
    return lookupFailure(
      "CACHE_INVALID_RESPONSE",
      "Your saved words returned data in an unexpected shape.",
      503,
    );
  }

  if (json.data.length === 0) return { ok: true, data: null };

  const record = parseCachedDictionaryResult(json.data[0]);
  if (!record) {
    return lookupFailure(
      "CACHE_INVALID_RESPONSE",
      "Your saved words returned data in an unexpected shape.",
      503,
    );
  }

  return { ok: true, data: record };
}

function parseCachedDictionaryResult(value: unknown): DictionaryResult | null {
  if (!isRecord(value)) return null;

  const word = normalizeDictionaryWord(value.word);
  const meaningAr = boundedString(value.meaning_ar, 512);
  const definition = boundedString(value.definition_en, 1_500);
  // definition_ar is optional at the cache layer, not required: rows saved
  // before this field existed have it as an empty string, and that must
  // still load successfully rather than erroring on every previously-saved
  // word until the user re-saves it.
  const definitionAr = optionalBoundedString(value.definition_ar, 1_500) ?? "";
  const pronunciation = optionalBoundedString(value.pronunciation, 160);
  const ipa = optionalBoundedString(value.ipa, 180);
  const partOfSpeech = boundedString(value.part_of_speech, 80);
  const example = optionalBoundedString(value.example_sentence, 1_000);

  if (
    !word ||
    !meaningAr ||
    !ARABIC_CHARACTER_PATTERN.test(meaningAr) ||
    !definition ||
    pronunciation === null ||
    ipa === null ||
    !partOfSpeech ||
    example === null
  ) {
    return null;
  }

  return {
    word,
    meaning_ar: meaningAr,
    definition_en: definition,
    definition_ar: definitionAr,
    pronunciation,
    ipa,
    part_of_speech: partOfSpeech,
    example_sentence: example,
  };
}

function parseWordPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "word") return null;
  if (typeof payload.word !== "string") return null;

  const word = payload.word
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
  if (!word || word.length > MAX_WORD_LENGTH) return null;
  if (word.split(" ").length > MAX_TERM_WORDS) return null;
  if (!LATIN_TERM_PATTERN.test(word)) return null;

  return word;
}

async function fetchEnglishDictionary(
  word: string,
): Promise<LookupDecision<EnglishDictionaryData>> {
  const url = `${FREE_DICTIONARY_BASE_URL}${encodeURIComponent(word)}`;
  const attempt = await fetchWithRetry(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    REQUEST_TIMEOUT_MS,
  );

  if (!attempt.ok) {
    return attempt.timedOut
      ? lookupFailure(
          "DICTIONARY_TIMEOUT",
          "The dictionary took too long to respond. Please try again.",
          504,
        )
      : lookupFailure(
          "DICTIONARY_UNAVAILABLE",
          "The dictionary is temporarily unavailable.",
          502,
        );
  }
  const response = attempt.response;

  if (response.status === 404) {
    return lookupFailure(
      "DICTIONARY_NOT_FOUND",
      "That English word was not found in the dictionary.",
      404,
    );
  }

  if (response.status === 429) {
    return lookupFailure(
      "DICTIONARY_RATE_LIMITED",
      "The dictionary is busy. Please try again shortly.",
      429,
      safeRetryAfter(response.headers.get("retry-after")),
    );
  }

  if (response.status >= 500) {
    return lookupFailure(
      "DICTIONARY_UNAVAILABLE",
      "The dictionary is temporarily unavailable.",
      502,
    );
  }

  if (!response.ok) {
    return lookupFailure(
      "DICTIONARY_UPSTREAM_ERROR",
      "The dictionary lookup could not be completed.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok) {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The dictionary returned an unreadable response.",
      502,
    );
  }

  const parsed = parseFreeDictionaryResponse(json.data, word);
  if (!parsed) {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The dictionary returned data in an unexpected shape.",
      502,
    );
  }

  return { ok: true, data: parsed };
}

function parseFreeDictionaryResponse(
  value: unknown,
  requestedWord: string,
): EnglishDictionaryData | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  // The API publishes entries, meanings, and definitions in dictionary order.
  // Choosing the first complete definition makes the primary/common sense
  // deterministic instead of inventing a frequency ranking.
  for (const entryValue of value) {
    if (!isRecord(entryValue)) continue;

    const canonicalWord =
      normalizeDictionaryWord(entryValue.word) ?? requestedWord;
    const phonetic = findPhoneticText(entryValue, value);
    if (!Array.isArray(entryValue.meanings)) continue;

    for (const meaningValue of entryValue.meanings) {
      if (!isRecord(meaningValue)) continue;
      const partOfSpeech = boundedString(meaningValue.partOfSpeech, 80);
      if (!partOfSpeech || !Array.isArray(meaningValue.definitions)) continue;

      for (const definitionValue of meaningValue.definitions) {
        if (!isRecord(definitionValue)) continue;
        const definition = boundedString(definitionValue.definition, 1_500);
        if (!definition) continue;

        const pronunciation = phonetic ? stripIpaDelimiters(phonetic) : "";

        return {
          word: canonicalWord,
          definition_en: definition,
          pronunciation,
          ipa: pronunciation ? `/${pronunciation}/` : "",
          part_of_speech: partOfSpeech,
          // No suggested example: the saved meaning is a translation of the
          // definition itself, not a usage sentence.
          example_sentence: "",
        };
      }
    }
  }

  return null;
}

function normalizeDictionaryWord(value: unknown): string | null {
  const word = boundedString(value, MAX_WORD_LENGTH)
    ?.replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
  if (!word || !LATIN_TERM_PATTERN.test(word)) return null;
  return word;
}

function findPhoneticText(
  preferredEntry: Record<string, unknown>,
  allEntries: unknown[],
): string | null {
  const preferred = phoneticCandidates(preferredEntry);
  for (const candidate of preferred) {
    const normalized = normalizePhonetic(candidate);
    if (normalized) return normalized;
  }

  for (const entryValue of allEntries) {
    if (!isRecord(entryValue) || entryValue === preferredEntry) continue;
    for (const candidate of phoneticCandidates(entryValue)) {
      const normalized = normalizePhonetic(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

function phoneticCandidates(entry: Record<string, unknown>): unknown[] {
  const candidates: unknown[] = [entry.phonetic];
  if (!Array.isArray(entry.phonetics)) return candidates;

  for (const value of entry.phonetics) {
    if (isRecord(value)) candidates.push(value.text);
  }
  return candidates;
}

function normalizePhonetic(value: unknown): string | null {
  const phonetic = boundedString(value, 160);
  if (!phonetic) return null;
  const stripped = stripIpaDelimiters(phonetic);
  return stripped && stripped.length <= 150 ? stripped : null;
}

function stripIpaDelimiters(value: string): string {
  return value
    .replace(/^[\/\[]+|[\/\]]+$/gu, "")
    .normalize("NFC")
    .trim();
}

async function fetchWiktionaryWikitext(
  page: string,
): Promise<LookupDecision<string | null>> {
  const url = new URL(WIKTIONARY_API_URL);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("redirects", "1");

  const attempt = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Wikimedia rejects requests without a descriptive `User-Agent` with a
        // 403 (see phabricator T400119). `Api-User-Agent` alone is not enough
        // outside a browser, and without this every Wiktionary lookup failed
        // silently and fell through to the translation services.
        "User-Agent": WIKIMEDIA_USER_AGENT,
        "Api-User-Agent": WIKIMEDIA_USER_AGENT,
      },
    },
    REQUEST_TIMEOUT_MS,
  );

  if (!attempt.ok) {
    return attempt.timedOut
      ? lookupFailure(
          "WIKTIONARY_TIMEOUT",
          "Wiktionary took too long to respond. Please try again.",
          504,
        )
      : lookupFailure(
          "WIKTIONARY_UNAVAILABLE",
          "Wiktionary is temporarily unavailable.",
          502,
        );
  }
  const response = attempt.response;

  if (response.status === 404) return { ok: true, data: null };

  if (response.status === 429) {
    return lookupFailure(
      "WIKTIONARY_RATE_LIMITED",
      "Wiktionary is busy. Please try again shortly.",
      429,
      safeRetryAfter(response.headers.get("retry-after")),
    );
  }

  if (response.status >= 500) {
    return lookupFailure(
      "WIKTIONARY_UNAVAILABLE",
      "Wiktionary is temporarily unavailable.",
      502,
    );
  }

  if (!response.ok) {
    return lookupFailure(
      "WIKTIONARY_UPSTREAM_ERROR",
      "The Arabic dictionary lookup could not be completed.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok) {
    return lookupFailure(
      "WIKTIONARY_INVALID_RESPONSE",
      "Wiktionary returned an unreadable response.",
      502,
    );
  }

  const wikitext = parseWiktionaryResponse(json.data);
  if (wikitext === undefined) {
    return lookupFailure(
      "WIKTIONARY_INVALID_RESPONSE",
      "Wiktionary returned data in an unexpected shape.",
      502,
    );
  }

  return { ok: true, data: wikitext };
}

function parseWiktionaryResponse(value: unknown): string | null | undefined {
  if (!isRecord(value)) return undefined;

  if (isRecord(value.error)) {
    return value.error.code === "missingtitle" ? null : undefined;
  }

  if (!isRecord(value.parse)) return undefined;
  const rawWikitext = value.parse.wikitext;
  const wikitext =
    typeof rawWikitext === "string"
      ? rawWikitext
      : isRecord(rawWikitext)
        ? rawWikitext["*"]
        : undefined;

  return typeof wikitext === "string" ? wikitext : undefined;
}

function findArabicMeaning(
  wikitext: string | null,
  definition: string,
): string | null {
  if (!wikitext) return null;

  const english = extractEnglishSection(wikitext);
  if (!english) return null;

  const boxes = extractTranslationBoxes(english).filter(
    (box) => box.arabicTerms.length > 0,
  );
  if (boxes.length === 0) return null;

  const definitionTokens = significantEnglishTokens(definition);
  boxes.sort((left, right) => {
    const scoreDifference =
      translationGlossScore(right.gloss, definitionTokens) -
      translationGlossScore(left.gloss, definitionTokens);
    return scoreDifference || left.order - right.order;
  });

  return boxes[0]?.arabicTerms[0] ?? null;
}

const WIKTIONARY_PARTS_OF_SPEECH = new Map<string, string>([
  ["noun", "noun"],
  ["verb", "verb"],
  ["adjective", "adjective"],
  ["adverb", "adverb"],
  ["pronoun", "pronoun"],
  ["preposition", "preposition"],
  ["conjunction", "conjunction"],
  ["interjection", "interjection"],
  ["determiner", "determiner"],
  ["article", "article"],
  ["numeral", "numeral"],
  ["phrase", "phrase"],
  ["proverb", "phrase"],
  ["prepositional phrase", "phrase"],
  ["verb phrase", "phrase"],
  ["noun phrase", "phrase"],
]);

/**
 * Reads the first published sense out of a Wiktionary entry.
 *
 * The Free Dictionary API is organised around single words and simply has no
 * record of some perfectly ordinary set phrases — "get it" returns 404 there.
 * Wiktionary does document them, and its wikitext has already been fetched for
 * the Arabic translation, so this reuses it rather than failing the lookup.
 * It is still a published dictionary entry, not generated text.
 */
function parseWiktionaryDefinition(
  wikitext: string,
  term: string,
): EnglishDictionaryData | null {
  const section = extractEnglishSection(wikitext);
  if (!section) return null;

  const headings = [...section.matchAll(/^={3,}\s*([A-Za-z ]+?)\s*={3,}\s*$/gmu)];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const partOfSpeech = WIKTIONARY_PARTS_OF_SPEECH.get(
      (heading[1] ?? "").trim().toLowerCase(),
    );
    if (!partOfSpeech) continue;

    const bodyStart = (heading.index ?? 0) + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? section.length;
    const lines = section.slice(bodyStart, bodyEnd).split(/\r?\n/u);

    for (let line = 0; line < lines.length; line += 1) {
      // Senses are `# ...`; `#*`, `#:` and `##` are citations and sub-senses.
      if (!/^#[^#*:]/u.test(lines[line] ?? "")) continue;

      const definition = cleanWikitextText(
        (lines[line] ?? "").replace(/^#\s*/u, ""),
        1_500,
      );
      if (!definition) continue;

      return {
        word: term,
        definition_en: definition,
        pronunciation: "",
        ipa: "",
        part_of_speech: partOfSpeech,
        // No suggested example: the saved meaning is a translation of the
        // definition itself, not a usage sentence.
        example_sentence: "",
      };
    }
  }

  return null;
}

function extractEnglishSection(wikitext: string): string | null {
  const englishHeading = /^==\s*English\s*==\s*$/gim;
  const heading = englishHeading.exec(wikitext);
  if (!heading) return null;

  const sectionStart = heading.index + heading[0].length;
  const remaining = wikitext.slice(sectionStart);
  const nextLanguage = /^==\s*[^=\n]+\s*==\s*$/m.exec(remaining);
  return nextLanguage ? remaining.slice(0, nextLanguage.index) : remaining;
}

function extractTranslationBoxes(section: string): TranslationBox[] {
  const boxes: TranslationBox[] = [];
  const boxPattern =
    /\{\{(?:trans-top|trans-top-also|checktrans-top)\b([^}]*)\}\}([\s\S]*?)\{\{trans-bottom\}\}/giu;

  for (const match of section.matchAll(boxPattern)) {
    const gloss = firstTemplateParameter(match[1] ?? "");
    const body = match[2] ?? "";
    const arabicTerms = extractArabicTerms(body);
    boxes.push({ gloss, arabicTerms, order: boxes.length });
  }

  return boxes;
}

function firstTemplateParameter(value: string): string {
  const raw = value.replace(/^\|/u, "").split("|")[0] ?? "";
  return cleanWikitextText(raw, 500) ?? "";
}

function extractArabicTerms(translationBody: string): string[] {
  const lines = translationBody.split(/\r?\n/u);
  const candidates: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    // `multitrans` rows on large translation subpages are prefixed with a
    // MediaWiki definition-list colon (for example `:* Arabic:`), while older
    // tables use `* Arabic:` directly. Both represent the same language row.
    const match = /^[:#]*\*\s*Arabic\s*:\s*(.*)$/iu.exec(
      lines[index] ?? "",
    );
    if (!match) continue;

    let arabicBlock = match[1] ?? "";
    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const nested = lines[nestedIndex] ?? "";
      if (!/^[:#]*\*[:*]/u.test(nested)) break;
      arabicBlock += `\n${nested}`;
      index = nestedIndex;
    }

    candidates.push(...extractArabicTemplateTerms(arabicBlock));
  }

  return unique(candidates).slice(0, 5);
}

function extractArabicTemplateTerms(value: string): string[] {
  if (/please add|translation needed|t-needed/iu.test(value)) return [];

  const terms: string[] = [];
  const templatePattern =
    /\{\{(?:t\+?|t-check|t\+check|tt\+?|tt-check|tt\+check|l)\|ar\|([^|{}]+)(?:\|[^{}]*)?\}\}/giu;

  for (const match of value.matchAll(templatePattern)) {
    const term = cleanArabicTerm(match[1] ?? "");
    if (term) terms.push(term);
  }

  if (terms.length > 0) return terms;

  // A small number of old translation rows use plain wiki links.
  for (const match of value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu)) {
    const term = cleanArabicTerm(match[1] ?? "");
    if (term) terms.push(term);
  }

  return terms;
}

function cleanArabicTerm(value: string): string | null {
  const cleaned = value
    .replace(/<!--([\s\S]*?)-->/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/'{2,}/gu, "")
    .normalize("NFC")
    .trim();

  if (!cleaned || cleaned.length > 160) return null;
  if (!ARABIC_CHARACTER_PATTERN.test(cleaned)) return null;
  return cleaned;
}

function cleanWikitextText(value: string, maxLength: number): string | null {
  const cleaned = value
    .replace(/\{\{[^{}]*\}\}/gu, " ")
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/'{2,}/gu, "")
    .replace(/\s+/gu, " ")
    .normalize("NFC")
    .trim();

  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function significantEnglishTokens(value: string): Set<string> {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "used",
    "with",
  ]);

  return new Set(
    value
      .toLocaleLowerCase("en")
      .match(/[a-z]+/gu)
      ?.filter((token) => token.length > 2 && !stopWords.has(token)) ?? [],
  );
}

function translationGlossScore(
  gloss: string,
  definitionTokens: Set<string>,
): number {
  let score = 0;
  for (const token of significantEnglishTokens(gloss)) {
    if (definitionTokens.has(token)) score += 1;
  }
  return score;
}

async function readBoundedJson(
  response: Response,
): Promise<LookupDecision<unknown>> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_BYTES) {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The upstream response was unexpectedly large.",
      502,
    );
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The upstream response could not be read.",
      502,
    );
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_UPSTREAM_BYTES) {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The upstream response was unexpectedly large.",
      502,
    );
  }

  try {
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch {
    return lookupFailure(
      "DICTIONARY_INVALID_RESPONSE",
      "The upstream response was not valid JSON.",
      502,
    );
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function lookupFailure(
  code: DictionaryErrorCode,
  message: string,
  status: number,
  retryAfter?: string,
): LookupFailure {
  return { ok: false, code, message, status, retryAfter };
}

function lookupErrorResponse(
  failure: LookupFailure,
  rate: RateDecision,
): Response {
  return errorResponse(
    failure.code,
    failure.message,
    failure.status,
    rate,
    failure.retryAfter ? { "Retry-After": failure.retryAfter } : undefined,
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
      message: "Log in before looking up a word.",
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

    return {
      ok: true,
      userId: user.id.trim(),
      token,
      supabaseUrl,
      supabaseApiKey: supabaseAnonKey,
    };
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

function supabaseWordsEndpoint(value: string): URL | null {
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

  url.pathname = "/rest/v1/words";
  url.search = "";
  url.hash = "";
  return url;
}

function getRuntimeString(name: string): string | null {
  // Vinext's Workers config exposes text variables through process.env when
  // nodejs_compat is enabled. No service keys are needed for either dictionary.
  const runtimeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const processValue = runtimeGlobal.process?.env?.[name]?.trim();
  return processValue || null;
}

function errorResponse(
  code: DictionaryErrorCode,
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

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  return normalized.length <= maxLength ? normalized : null;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchAttempt =
  | { ok: true; response: Response }
  | { ok: false; timedOut: boolean };

/**
 * Fetches with a per-attempt timeout, retrying on the failure modes that are
 * usually transient: a network error, a timeout, or a 5xx from the upstream.
 * A clean 4xx (404, 400, ...) is a real, stable answer and is returned
 * immediately without burning retries on it.
 */
async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  attempts: number = FETCH_ATTEMPTS,
): Promise<FetchAttempt> {
  let last: FetchAttempt = { ok: false, timedOut: false };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.status >= 500 && attempt < attempts) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { ok: true, response };
    } catch (error) {
      last = { ok: false, timedOut: isAbortError(error) };
      if (attempt < attempts) await sleep(RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeout);
    }
  }

  return last;
}

function safeRetryAfter(value: string | null): string | undefined {
  if (!value) return undefined;
  const retryAfter = value.trim();
  return /^\d{1,6}$/.test(retryAfter) ? retryAfter : undefined;
}
