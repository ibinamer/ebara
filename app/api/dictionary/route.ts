import {
  AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS,
  AZURE_TRANSLATION_WARNING_CHARACTERS,
  reserveAzureTranslationCharacters,
} from "../../../db/azure-translation-usage";

export const runtime = "edge";

const FREE_DICTIONARY_BASE_URL =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";
const DATAMUSE_API_URL = "https://api.datamuse.com/words";
const WIKTIONARY_API_URL = "https://en.wiktionary.org/w/api.php";
// Wikimedia's robot policy requires a descriptive agent string on every request.
const WIKIMEDIA_USER_AGENT = "EBARA/1.0 (personal vocabulary app; dictionary lookup)";
const AZURE_TRANSLATOR_BASE_URL =
  "https://api.cognitive.microsofttranslator.com";
const MYMEMORY_API_URL = "https://api.mymemory.translated.net/get";
const MAX_BODY_BYTES = 2_048;
const MAX_WORD_LENGTH = 80;
const MAX_UPSTREAM_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 8_000;
const METADATA_TIMEOUT_MS = 2_500;
const AUTH_TIMEOUT_MS = 8_000;
// Every outbound call below is a single-shot request to a third-party service
// EBARA does not control. A transient blip there (a 5xx, a dropped
// connection, a slow response) used to fail the whole lookup outright, which
// is what made ordinary words intermittently "not translate" — retrying the
// same request once, after a short pause, clears the vast majority of these
// without meaningfully slowing down the common case where the first attempt
// just works.
const FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 350;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 2_000;
const SHARED_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const MAX_INPUT_LENGTH = 160;
const MAX_INPUT_WORDS = 12;

// A single orthographic word, optionally hyphenated or apostrophised.
const LATIN_WORD_SOURCE = String.raw`\p{Script=Latin}+(?:['\-\u2019]\p{Script=Latin}+)*`;
// A term is one such word, or several separated by single spaces \u2014 which is
// what lets set phrases like "catch up" or "look forward to" be looked up.
const LATIN_TERM_PATTERN = new RegExp(
  `^${LATIN_WORD_SOURCE}(?: ${LATIN_WORD_SOURCE})*$`,
  "u",
);
const LATIN_TOKEN_PATTERN = new RegExp(LATIN_WORD_SOURCE, "gu");
const ALLOWED_INPUT_PATTERN = /^[\p{Script=Latin}\s,'\-.!?]+$/u;
const ARABIC_CHARACTER_PATTERN = /\p{Script=Arabic}/u;

const SENTENCE_STARTERS = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "this",
  "that",
  "these",
  "those",
  "there",
  "let's",
]);
const SENTENCE_AUXILIARIES = new Set([
  "am",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "shall",
  "should",
  "may",
  "might",
  "must",
]);
const VOCABULARY_STOP_WORDS = new Set([
  ...SENTENCE_STARTERS,
  ...SENTENCE_AUXILIARIES,
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "to",
  "with",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "me",
  "him",
  "us",
  "them",
  "so",
  "very",
  "really",
  "just",
  "too",
  "not",
  "no",
  "yes",
]);

type ParsedVocabularyInput = {
  display: string;
  dictionaryTerm: string;
  cacheKey: string;
  wordCount: number;
};

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
  audio_url: string;
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

type RankedEnglishDictionaryData = {
  data: EnglishDictionaryData;
  order: number;
};

type TranslationBox = {
  gloss: string;
  arabicTerms: string[];
  languageCount: number;
  order: number;
};

type AzureTranslatorCredentials = {
  key: string;
  region: string | null;
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

  const input = parseWordPayload(payload);
  if (!input) {
    return errorResponse(
      "INVALID_PAYLOAD",
      "Send one English word, expression, or short sentence in the word field.",
      400,
      rate,
    );
  }
  const word = input.display;

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

  // Obvious short sentences do not benefit from three dictionary requests.
  // Translate them directly, then let the client offer their useful content
  // words as vocabulary candidates. Ambiguous expressions still continue to
  // the dictionaries so idioms such as "break a leg" are not translated
  // literally.
  if (looksLikeSentence(input)) {
    return translationOnlyResponse(input, rate, "sentence");
  }

  // Completed dictionary records contain no user data, so they can be shared
  // safely across accounts. This avoids paying for or waiting on the same
  // provider lookup again when another learner saves the same word.
  const sharedCached = await findSharedDictionaryEntry(request, input.cacheKey);
  if (sharedCached) {
    return Response.json(
      { ok: true as const, cached: true, data: sharedCached },
      { status: 200, headers: responseHeaders(rate) },
    );
  }

  // The dictionary, Wiktionary, and corpus-based part-of-speech metadata are
  // independent reads. Datamuse ranks parts of speech by popularity in Google
  // Books Ngrams, preventing rare senses such as the noun form of "high" from
  // appearing before the everyday adjective.
  const partOfSpeechRankingPromise = fetchPopularPartsOfSpeech(
    input.dictionaryTerm,
  );
  const [english, mainWikitext, partOfSpeechRanking] = await Promise.all([
    fetchEnglishDictionary(input.dictionaryTerm, partOfSpeechRankingPromise),
    fetchWiktionaryWikitext(input.dictionaryTerm),
    partOfSpeechRankingPromise,
  ]);

  // Wiktionary is the phrase authority even when Free Dictionary happens to
  // return the phrase. Free Dictionary mirrors source order, which can put a
  // rare literal sense before the everyday idiom (for example "catch up" as
  // "pick up suddenly"). Translation-table coverage lets the parser choose
  // the broadly documented sense instead.
  const fromWiktionary =
    mainWikitext.ok && mainWikitext.data &&
    (!english.ok || isMultiWordTerm(input.dictionaryTerm))
      ? await parseWiktionaryDefinition(
          mainWikitext.data,
          input.dictionaryTerm,
          partOfSpeechRanking,
        )
      : null;

  let englishData: EnglishDictionaryData;
  if (english.ok) {
    englishData =
      isMultiWordTerm(word) && fromWiktionary
        ? {
            ...fromWiktionary,
            pronunciation:
              english.data.pronunciation || fromWiktionary.pronunciation,
            audio_url: english.data.audio_url || fromWiktionary.audio_url,
            ipa: english.data.ipa || fromWiktionary.ipa,
            example_sentence:
              fromWiktionary.example_sentence || english.data.example_sentence,
          }
        : english.data;
  } else {
    // Wiktionary was already fetched in parallel and is a fully independent
    // source, so its wikitext can rescue this lookup no matter *why* Free
    // Dictionary failed — a clean 404 or a transient timeout/5xx.
    if (!fromWiktionary) {
      if (input.wordCount > 1) {
        return translationOnlyResponse(input, rate, "expression");
      }

      const suggestions =
        english.code === "DICTIONARY_NOT_FOUND"
          ? await fetchSpellingSuggestions(input.dictionaryTerm)
          : [];
      return lookupErrorResponse(english, rate, suggestions);
    }
    englishData = fromWiktionary;
  }

  // Anything spanning more than one word is filed as a phrase, so phrasal verbs
  // and idioms collect under a single browsable type rather than scattering
  // across the noun and verb buckets their head word happens to carry.
  if (isMultiWordTerm(englishData.word)) {
    englishData = { ...englishData, part_of_speech: "phrase" };
  }

  // meaning_ar is a short headword-level gloss, not a translated sentence.
  // Azure Dictionary Lookup is sense-aware and returns part-of-speech tags, so
  // it is tried first when configured. Wiktionary remains the curated fallback.
  const azureCredentials = getAzureTranslatorCredentials();
  const azureDictionaryMeaning = azureCredentials
    ? await fetchAzureDictionaryMeaning(
        englishData.word,
        englishData.part_of_speech,
        azureCredentials,
      )
    : null;
  let meaningAr = azureDictionaryMeaning?.ok
    ? azureDictionaryMeaning.data
    : mainWikitext.ok
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

  // Keep meaning_ar as a short lookup gloss. Phrases are translated as the
  // phrase itself; their selected, sense-aware dictionary definition is
  // translated separately into definition_ar below. This prevents a complete
  // explanatory sentence from leaking into the compact meaning field.
  const meaningLookupText = translationHeadwordContext(
    englishData.word,
    englishData.part_of_speech,
  );
  const shortMeaningPromise = meaningAr
    ? Promise.resolve<LookupDecision<string>>({ ok: true, data: meaningAr })
    : translateToArabic(meaningLookupText);

  const meaningDecision = await shortMeaningPromise;
  const needsArabicMeaning = !meaningDecision.ok;

  // Do not discard valid English dictionary data just because every automatic
  // Arabic source is temporarily unavailable. The client can ask the learner
  // for a short Arabic gloss and still save the completed dictionary record.
  if (needsArabicMeaning) {
    reportTranslationFailure("all", "manual-meaning-required");
  }

  // The English definition and short Arabic meaning are the core record. A
  // full Arabic rendering of the definition is useful, but an outage at a
  // translation provider must not make the whole word impossible to save.
  const definitionDecision = needsArabicMeaning
    ? null
    : await translateToArabic(englishData.definition_en);
  const data: DictionaryResult = {
    ...englishData,
    meaning_ar: meaningDecision.ok ? meaningDecision.data : "",
    definition_ar: definitionDecision?.ok ? definitionDecision.data : "",
  };

  if (definitionDecision && !definitionDecision.ok) {
    reportTranslationFailure("all", "optional-definition-translation-failed");
  }

  // Only complete automatic records are shared. Any manual gloss belongs to
  // the learner who entered it and is saved in that learner's own collection.
  if (!needsArabicMeaning) {
    await storeSharedDictionaryEntry(request, input.cacheKey, data);
  }

  return Response.json(
    {
      ok: true as const,
      cached: false,
      entry_kind: isMultiWordTerm(englishData.word) ? "phrase" : "word",
      vocabulary_suggestions: [] as string[],
      needs_arabic_meaning: needsArabicMeaning,
      data,
    },
    { status: 200, headers: responseHeaders(rate) },
  );
}

/** Uses the official Azure service when configured, then a free fallback. */
async function translateToArabic(text: string): Promise<LookupDecision<string>> {
  const credentials = getAzureTranslatorCredentials();
  if (credentials) {
    const azure = await fetchAzureArabicTranslation(text, credentials);
    if (azure.ok) return azure;
  }
  return fetchArabicTranslation(text);
}

function getAzureTranslatorCredentials(): AzureTranslatorCredentials | null {
  const key = getRuntimeString("AZURE_TRANSLATOR_KEY");
  if (!key) return null;
  return {
    key,
    region: getRuntimeString("AZURE_TRANSLATOR_REGION"),
  };
}

function translationHeadwordContext(word: string, partOfSpeech: string): string {
  const normalizedPart = partOfSpeech.toLocaleLowerCase("en");
  if (normalizedPart.includes("noun")) return `a ${word}`;
  if (normalizedPart.includes("verb")) return `to ${word}`;
  return word;
}

function azureTranslatorHeaders(
  credentials: AzureTranslatorCredentials,
): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": credentials.key,
  });
  if (credentials.region) {
    headers.set("Ocp-Apim-Subscription-Region", credentials.region);
  }
  return headers;
}

async function reserveAzureRequest(text: string): Promise<boolean> {
  const reservation = await reserveAzureTranslationCharacters(text);
  if (!reservation.allowed) {
    reportTranslationFailure("azure-translator", reservation.reason);
    return false;
  }

  if (reservation.warningJustReached) {
    console.warn(
      `[translation-usage] Monthly Azure usage reached ${reservation.charactersUsed} characters; warning threshold is ${AZURE_TRANSLATION_WARNING_CHARACTERS} and the hard stop is ${AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS}.`,
    );
  }
  return true;
}

async function fetchAzureArabicTranslation(
  text: string,
  credentials: AzureTranslatorCredentials,
): Promise<LookupDecision<string>> {
  const url = new URL("/translate", AZURE_TRANSLATOR_BASE_URL);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("from", "en");
  url.searchParams.set("to", "ar");

  const attempt = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: azureTranslatorHeaders(credentials),
      body: JSON.stringify([{ Text: text }]),
    },
    REQUEST_TIMEOUT_MS,
    () => reserveAzureRequest(text),
  );
  if (!attempt.ok) {
    reportTranslationFailure("azure-translator", "network-or-timeout");
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service is temporarily unavailable.",
      502,
    );
  }
  const response = attempt.response;

  if (!response.ok) {
    reportTranslationFailure("azure-translator", "http-error", response.status);
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service could not complete this lookup.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  const firstResult = json.ok && Array.isArray(json.data) ? json.data[0] : null;
  const translations = isRecord(firstResult) ? firstResult.translations : null;
  const firstTranslation = Array.isArray(translations) ? translations[0] : null;
  const translated = isRecord(firstTranslation)
    ? boundedString(firstTranslation.text, 1_500)
    : null;
  if (!translated || !ARABIC_CHARACTER_PATTERN.test(translated)) {
    reportTranslationFailure("azure-translator", "invalid-response");
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "No Arabic meaning was found for this word.",
      422,
    );
  }
  return { ok: true, data: translated };
}

async function fetchAzureDictionaryMeaning(
  term: string,
  partOfSpeech: string,
  credentials: AzureTranslatorCredentials,
): Promise<LookupDecision<string>> {
  const url = new URL("/dictionary/lookup", AZURE_TRANSLATOR_BASE_URL);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("from", "en");
  url.searchParams.set("to", "ar");

  const attempt = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: azureTranslatorHeaders(credentials),
      body: JSON.stringify([{ Text: term }]),
    },
    REQUEST_TIMEOUT_MS,
    () => reserveAzureRequest(term),
  );
  if (!attempt.ok) {
    reportTranslationFailure("azure-translator", "dictionary-network-or-timeout");
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic dictionary is temporarily unavailable.",
      502,
    );
  }

  if (!attempt.response.ok) {
    reportTranslationFailure(
      "azure-translator",
      "dictionary-http-error",
      attempt.response.status,
    );
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic dictionary could not complete this lookup.",
      502,
    );
  }

  const json = await readBoundedJson(attempt.response);
  const meaning = json.ok
    ? selectAzureDictionaryMeaning(json.data, term, partOfSpeech)
    : null;
  if (!meaning) {
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "No Arabic dictionary meaning was found for this word.",
      422,
    );
  }
  return { ok: true, data: meaning };
}

function selectAzureDictionaryMeaning(
  value: unknown,
  requestedTerm: string,
  partOfSpeech: string,
): string | null {
  if (!Array.isArray(value) || !isRecord(value[0])) return null;
  const translations = value[0].translations;
  if (!Array.isArray(translations)) return null;

  const expectedTag = azurePartOfSpeechTag(partOfSpeech);
  const candidates = translations.flatMap((translation, order) => {
    if (!isRecord(translation)) return [];
    const displayTarget = boundedString(translation.displayTarget, 512);
    if (!displayTarget || !ARABIC_CHARACTER_PATTERN.test(displayTarget)) return [];

    const posTag = boundedString(translation.posTag, 16)?.toUpperCase() ?? "";
    const confidence =
      typeof translation.confidence === "number" &&
      Number.isFinite(translation.confidence)
        ? Math.max(0, Math.min(1, translation.confidence))
        : 0;
    const exactBackTranslation = Array.isArray(translation.backTranslations)
      ? translation.backTranslations.some(
          (backTranslation) =>
            isRecord(backTranslation) &&
            boundedString(backTranslation.normalizedText, MAX_WORD_LENGTH)
              ?.toLocaleLowerCase("en") === requestedTerm.toLocaleLowerCase("en"),
        )
      : false;

    return [
      {
        displayTarget,
        posTag,
        order,
        score:
          (expectedTag && posTag === expectedTag ? 1_000 : 0) +
          (exactBackTranslation ? 100 : 0) +
          confidence * 10,
      },
    ];
  });
  if (candidates.length === 0) return null;

  const matchingPartOfSpeech = expectedTag
    ? candidates.filter((candidate) => candidate.posTag === expectedTag)
    : candidates;
  const ranked = matchingPartOfSpeech.length > 0
    ? matchingPartOfSpeech
    : candidates;
  ranked.sort((left, right) => right.score - left.score || left.order - right.order);
  return ranked[0]?.displayTarget ?? null;
}

function azurePartOfSpeechTag(partOfSpeech: string): string | null {
  const normalized = partOfSpeech.trim().toLocaleLowerCase("en");
  if (normalized.includes("adjective")) return "ADJ";
  if (normalized.includes("adverb")) return "ADV";
  if (normalized.includes("conjunction")) return "CONJ";
  if (normalized.includes("determiner")) return "DET";
  if (normalized.includes("noun")) return "NOUN";
  if (normalized.includes("preposition")) return "PREP";
  if (normalized.includes("pronoun")) return "PRON";
  if (normalized.includes("verb")) return "VERB";
  return null;
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
    reportTranslationFailure("mymemory", "network-or-timeout");
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service is temporarily unavailable.",
      502,
    );
  }
  const response = attempt.response;

  if (!response.ok) {
    reportTranslationFailure("mymemory", "http-error", response.status);
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "The Arabic translation service could not complete this lookup.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok || !isRecord(json.data) || !isRecord(json.data.responseData)) {
    reportTranslationFailure("mymemory", "invalid-response");
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
    reportTranslationFailure("mymemory", "no-arabic-result");
    return lookupFailure(
      "ARABIC_MEANING_NOT_FOUND",
      "No Arabic meaning was found for this word.",
      422,
    );
  }

  return { ok: true, data: translated };
}

type SharedDictionaryCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

function sharedDictionaryCache(): SharedDictionaryCache | null {
  const runtimeGlobal = globalThis as typeof globalThis & {
    caches?: { default?: SharedDictionaryCache };
  };
  return runtimeGlobal.caches?.default ?? null;
}

function sharedDictionaryCacheKey(request: Request, word: string): Request | null {
  try {
    const url = new URL(request.url);
    // Version the shared cache whenever provider selection or meaning quality
    // changes so older fallback translations cannot survive for 30 days.
    url.pathname = `/__ebara-cache/v2/dictionary/${encodeURIComponent(word)}`;
    url.search = "";
    url.hash = "";
    return new Request(url, { method: "GET" });
  } catch {
    return null;
  }
}

async function findSharedDictionaryEntry(
  request: Request,
  word: string,
): Promise<DictionaryResult | null> {
  const cache = sharedDictionaryCache();
  const key = sharedDictionaryCacheKey(request, word);
  if (!cache || !key) return null;

  try {
    const response = await cache.match(key);
    if (!response?.ok) return null;
    const json = await readBoundedJson(response);
    return json.ok ? parseCachedDictionaryResult(json.data) : null;
  } catch {
    return null;
  }
}

async function storeSharedDictionaryEntry(
  request: Request,
  word: string,
  data: DictionaryResult,
): Promise<void> {
  const cache = sharedDictionaryCache();
  const key = sharedDictionaryCacheKey(request, word);
  if (!cache || !key) return;

  try {
    await cache.put(
      key,
      Response.json(data, {
        headers: {
          "Cache-Control": `public, max-age=${SHARED_CACHE_MAX_AGE_SECONDS}`,
        },
      }),
    );
  } catch {
    // Cache availability must never block a dictionary lookup.
  }
}

function reportTranslationFailure(
  provider: "azure-translator" | "mymemory" | "all",
  reason: string,
  status?: number,
): void {
  // Never log the word, definition, API key, or user information.
  console.warn("Arabic translation provider failed", {
    provider,
    reason,
    ...(status ? { status } : {}),
  });
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
    "word,meaning_ar,definition_en,definition_ar,pronunciation,audio_url,ipa,part_of_speech,example_sentence",
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

  const partOfSpeech = boundedString(value.part_of_speech, 80);
  const translationOnly =
    partOfSpeech === "sentence" || partOfSpeech === "expression";
  const storedInput = optionalBoundedString(value.word, MAX_INPUT_LENGTH);
  const word = translationOnly
    ? storedInput && ALLOWED_INPUT_PATTERN.test(storedInput)
      ? storedInput
      : null
    : normalizeDictionaryWord(value.word);
  const meaningAr = boundedString(value.meaning_ar, 512);
  const definition = translationOnly
    ? optionalBoundedString(value.definition_en, 1_500)
    : boundedString(value.definition_en, 1_500);
  // definition_ar is optional at the cache layer, not required: rows saved
  // before this field existed have it as an empty string, and that must
  // still load successfully rather than erroring on every previously-saved
  // word until the user re-saves it.
  const definitionAr = optionalBoundedString(value.definition_ar, 1_500) ?? "";
  const pronunciation = optionalBoundedString(value.pronunciation, 160);
  const audioUrl = normalizeDictionaryAudioUrl(value.audio_url ?? "");
  const ipa = optionalBoundedString(value.ipa, 180);
  const example = optionalBoundedString(value.example_sentence, 1_000);

  if (
    !word ||
    !meaningAr ||
    !ARABIC_CHARACTER_PATTERN.test(meaningAr) ||
    definition === null ||
    pronunciation === null ||
    audioUrl === null ||
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
    audio_url: audioUrl,
    ipa,
    part_of_speech: partOfSpeech,
    example_sentence: example,
  };
}

function parseWordPayload(payload: unknown): ParsedVocabularyInput | null {
  if (!isRecord(payload)) return null;

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "word") return null;
  if (typeof payload.word !== "string") return null;

  const display = payload.word
    .normalize("NFKC")
    .replace(/[’]/gu, "'")
    .replace(/[–—]/gu, "-")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.!?])/gu, "$1");
  if (!display || display.length > MAX_INPUT_LENGTH) return null;
  if (!ALLOWED_INPUT_PATTERN.test(display)) return null;
  if (/\.{2,}|[!?]{2,}|[,!?]\s*[,!?]/u.test(display)) return null;

  const tokens = display.match(LATIN_TOKEN_PATTERN) ?? [];
  if (tokens.length === 0 || tokens.length > MAX_INPUT_WORDS) return null;

  const dictionaryTerm = display
    .replace(/[,.!?]+$/gu, "")
    .replace(/[,!?]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
  if (!dictionaryTerm || !LATIN_TERM_PATTERN.test(dictionaryTerm)) return null;

  return {
    display,
    dictionaryTerm,
    cacheKey: display.toLocaleLowerCase("en"),
    wordCount: tokens.length,
  };
}

function inputWords(value: string): string[] {
  return (value.match(LATIN_TOKEN_PATTERN) ?? []).map((word) =>
    word.toLocaleLowerCase("en"),
  );
}

function looksLikeSentence(input: ParsedVocabularyInput): boolean {
  if (input.wordCount < 3) return false;
  const words = inputWords(input.display);
  const first = words[0] ?? "";
  if (SENTENCE_STARTERS.has(first)) return true;
  if (words.some((word) => SENTENCE_AUXILIARIES.has(word))) return true;
  return words.some((word) => /^(?:i|you|he|she|it|we|they)'(?:m|re|ve|ll|d|s)$/u.test(word));
}

function vocabularySuggestions(value: string): string[] {
  const suggestions: string[] = [];
  for (const word of inputWords(value)) {
    if (
      word.length < 3 ||
      VOCABULARY_STOP_WORDS.has(word) ||
      suggestions.includes(word)
    ) {
      continue;
    }
    suggestions.push(word);
    if (suggestions.length === 4) break;
  }
  return suggestions;
}

async function translationOnlyResponse(
  input: ParsedVocabularyInput,
  rate: RateDecision,
  kind: "expression" | "sentence",
): Promise<Response> {
  const translation = await translateToArabic(input.display);
  if (!translation.ok) return lookupErrorResponse(translation, rate);

  const data: DictionaryResult = {
    word: input.display,
    meaning_ar: translation.data,
    definition_en: "",
    definition_ar: "",
    pronunciation: "",
    audio_url: "",
    ipa: "",
    part_of_speech: kind,
    example_sentence: "",
  };

  return Response.json(
    {
      ok: true as const,
      cached: false,
      entry_kind: kind,
      vocabulary_suggestions: vocabularySuggestions(input.display),
      needs_arabic_meaning: false,
      data,
    },
    { status: 200, headers: responseHeaders(rate) },
  );
}

async function fetchEnglishDictionary(
  word: string,
  partOfSpeechRankingPromise: Promise<string[]>,
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

  const parsed = parseFreeDictionaryResponse(
    json.data,
    word,
    await partOfSpeechRankingPromise,
  );
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
  partOfSpeechRanking: string[],
): EnglishDictionaryData | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const candidates: RankedEnglishDictionaryData[] = [];
  let order = 0;

  for (const entryValue of value) {
    if (!isRecord(entryValue)) continue;

    const canonicalWord =
      normalizeDictionaryWord(entryValue.word) ?? requestedWord;
    const phonetic = findPhoneticText(entryValue, value);
    const audioUrl = findPhoneticAudio(entryValue, value);
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

        candidates.push({
          order,
          data: {
            word: canonicalWord,
            definition_en: definition,
            pronunciation,
            audio_url: audioUrl ?? "",
            ipa: pronunciation ? `/${pronunciation}/` : "",
            part_of_speech: partOfSpeech,
            // No suggested example: the saved meaning is a translation of the
            // definition itself, not a usage sentence.
            example_sentence: "",
          },
        });
        order += 1;
        // The first definition within a part of speech is the dictionary's
        // primary sense for that grammatical category.
        break;
      }
    }
  }

  candidates.sort(
    (left, right) =>
      partOfSpeechRank(left.data.part_of_speech, partOfSpeechRanking) -
        partOfSpeechRank(right.data.part_of_speech, partOfSpeechRanking) ||
      left.order - right.order,
  );

  return candidates[0]?.data ?? null;
}

async function fetchPopularPartsOfSpeech(word: string): Promise<string[]> {
  const url = new URL(DATAMUSE_API_URL);
  url.searchParams.set("sp", word);
  url.searchParams.set("md", "p");
  url.searchParams.set("max", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const json = await readBoundedJson(response);
    if (!json.ok || !Array.isArray(json.data) || json.data.length === 0) return [];

    const first = json.data[0];
    if (!isRecord(first) || normalizeDictionaryWord(first.word) !== word) return [];
    if (!Array.isArray(first.tags)) return [];

    const parts = first.tags
      .map((tag) => datamusePartOfSpeech(tag))
      .filter((part): part is string => Boolean(part));
    return unique(parts);
  } catch {
    // Popularity metadata improves sense ordering but is never required for a
    // dictionary lookup to succeed.
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSpellingSuggestions(word: string): Promise<string[]> {
  const url = new URL(DATAMUSE_API_URL);
  url.searchParams.set("sp", word);
  url.searchParams.set("max", "5");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];

    const json = await readBoundedJson(response);
    if (!json.ok || !Array.isArray(json.data)) return [];

    return unique(
      json.data.flatMap((value) => {
        if (!isRecord(value)) return [];
        const candidate = normalizeDictionaryWord(value.word);
        return candidate && candidate !== word ? [candidate] : [];
      }),
    ).slice(0, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function datamusePartOfSpeech(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return (
    {
      n: "noun",
      v: "verb",
      adj: "adjective",
      adv: "adverb",
    } as Record<string, string>
  )[value] ?? null;
}

function partOfSpeechRank(
  partOfSpeech: string,
  ranking: string[],
): number {
  const normalized = partOfSpeech.trim().toLocaleLowerCase("en");
  const rank = ranking.indexOf(normalized);
  return rank >= 0 ? rank : ranking.length + 1;
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

function findPhoneticAudio(
  preferredEntry: Record<string, unknown>,
  allEntries: unknown[],
): string | null {
  const preferred = phoneticAudioCandidates(preferredEntry);
  for (const candidate of preferred) {
    const normalized = normalizeDictionaryAudioUrl(candidate);
    if (normalized) return normalized;
  }

  for (const entryValue of allEntries) {
    if (!isRecord(entryValue) || entryValue === preferredEntry) continue;
    for (const candidate of phoneticAudioCandidates(entryValue)) {
      const normalized = normalizeDictionaryAudioUrl(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

function phoneticAudioCandidates(entry: Record<string, unknown>): unknown[] {
  if (!Array.isArray(entry.phonetics)) return [];
  return entry.phonetics.flatMap((value) =>
    isRecord(value) ? [value.audio] : [],
  );
}

function normalizeDictionaryAudioUrl(value: unknown): string | null {
  const raw = optionalBoundedString(value, 1_024);
  if (raw === null) return null;
  if (!raw) return "";

  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const trustedHost =
      url.hostname === "api.dictionaryapi.dev" ||
      url.hostname === "ssl.gstatic.com";
    if (url.protocol !== "https:" || !trustedHost || !url.pathname) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
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

/**
 * Lets Wikimedia expand a template-only definition line using the same Lua
 * modules that render Wiktionary itself. This is deliberately a fallback: most
 * ordinary definitions clean up locally, while phrases such as "big guy" put
 * their entire first sense inside templates like `non-gloss` or `&lit`.
 */
async function expandWiktionaryDefinition(
  page: string,
  definitionWikitext: string,
): Promise<LookupDecision<string>> {
  const url = new URL(WIKTIONARY_API_URL);
  url.searchParams.set("action", "expandtemplates");
  url.searchParams.set("title", page);
  url.searchParams.set("text", definitionWikitext);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");

  const attempt = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
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
          "Wiktionary took too long to expand this definition.",
          504,
        )
      : lookupFailure(
          "WIKTIONARY_UNAVAILABLE",
          "Wiktionary could not expand this definition.",
          502,
        );
  }

  const response = attempt.response;
  if (response.status === 429) {
    return lookupFailure(
      "WIKTIONARY_RATE_LIMITED",
      "Wiktionary is busy. Please try again shortly.",
      429,
      safeRetryAfter(response.headers.get("retry-after")),
    );
  }
  if (!response.ok) {
    return lookupFailure(
      response.status >= 500
        ? "WIKTIONARY_UNAVAILABLE"
        : "WIKTIONARY_UPSTREAM_ERROR",
      "Wiktionary could not expand this definition.",
      502,
    );
  }

  const json = await readBoundedJson(response);
  if (!json.ok) {
    return lookupFailure(
      "WIKTIONARY_INVALID_RESPONSE",
      "Wiktionary returned an unreadable expanded definition.",
      502,
    );
  }

  const expanded = parseWiktionaryExpansionResponse(json.data);
  if (!expanded) {
    return lookupFailure(
      "WIKTIONARY_INVALID_RESPONSE",
      "Wiktionary returned an invalid expanded definition.",
      502,
    );
  }

  return { ok: true, data: expanded };
}

function parseWiktionaryExpansionResponse(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.expandtemplates)) return null;
  return boundedString(value.expandtemplates.wikitext, 10_000);
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
  const rankedBoxes = boxes
    .map((box) => ({
      ...box,
      score: translationGlossScore(box.gloss, definitionTokens),
    }))
    .sort(
      (left, right) => right.score - left.score || left.order - right.order,
    );

  const best = rankedBoxes[0];
  if (!best) return null;
  // When several senses exist, accepting a zero-overlap translation silently
  // chooses whichever table happens to appear first. That is how the common
  // adjective "high" became the unrelated slang Arabic meaning "مَسْطُول".
  if (rankedBoxes.length > 1 && best.score === 0) return null;
  return best.arabicTerms[0] ?? null;
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
async function parseWiktionaryDefinition(
  wikitext: string,
  term: string,
  partOfSpeechRanking: string[],
): Promise<EnglishDictionaryData | null> {
  const section = extractEnglishSection(wikitext);
  if (!section) return null;

  const translationBoxes = extractTranslationBoxes(section);

  const headings = [...section.matchAll(/^={3,}\s*([A-Za-z ]+?)\s*={3,}\s*$/gmu)];

  const rankedSections = headings
    .map((heading, index) => {
      const partOfSpeech = WIKTIONARY_PARTS_OF_SPEECH.get(
        (heading[1] ?? "").trim().toLowerCase(),
      );
      if (!partOfSpeech) return null;

      const bodyStart = (heading.index ?? 0) + heading[0].length;
      const bodyEnd = headings[index + 1]?.index ?? section.length;
      return {
        body: section.slice(bodyStart, bodyEnd),
        order: index,
        partOfSpeech,
      };
    })
    .filter(
      (
        item,
      ): item is { body: string; order: number; partOfSpeech: string } =>
        item !== null,
    )
    .sort(
      (left, right) =>
        partOfSpeechRank(left.partOfSpeech, partOfSpeechRanking) -
          partOfSpeechRank(right.partOfSpeech, partOfSpeechRanking) ||
        left.order - right.order,
    );

  const candidates: Array<{
    definition: string;
    languageCount: number;
    matchScore: number;
    order: number;
    partOfSpeech: string;
    sectionOrder: number;
  }> = [];

  for (const [sectionOrder, rankedSection] of rankedSections.entries()) {
    const lines = rankedSection.body.split(/\r?\n/u);

    for (let line = 0; line < lines.length; line += 1) {
      // Senses are `# ...`; `#*`, `#:` and `##` are citations and sub-senses.
      if (!/^#[^#*:]/u.test(lines[line] ?? "")) continue;

      const rawDefinition = (lines[line] ?? "").replace(/^#\s*/u, "");
      let definition = cleanWikitextText(rawDefinition, 1_500);

      // Template-only senses are valid definitions, not empty lines. Ask the
      // official MediaWiki expander to render them instead of maintaining an
      // incomplete, ever-growing list of Wiktionary templates in EBARA.
      if (!isMeaningfulDefinition(definition) && rawDefinition.includes("{{")) {
        const expanded = await expandWiktionaryDefinition(term, rawDefinition);
        if (expanded.ok) {
          definition = cleanWikitextText(expanded.data, 1_500);
        }
      }

      if (!isMeaningfulDefinition(definition)) continue;
      // A typo page is metadata about an invalid spelling, not a vocabulary
      // sense. Ignoring it lets the normal one-word miss path return useful
      // spelling suggestions instead of translating "Misspelling of …".
      if (isMisspellingDefinition(definition)) continue;

      const definitionTokens = significantEnglishTokens(definition);
      const matchingTranslation = translationBoxes
        .map((box) => ({
          languageCount: box.languageCount,
          score: translationGlossScore(box.gloss, definitionTokens),
        }))
        .filter((box) => box.score > 0)
        .sort(
          (left, right) =>
            right.languageCount - left.languageCount || right.score - left.score,
        )[0];

      candidates.push({
        definition,
        languageCount: matchingTranslation?.languageCount ?? 0,
        matchScore: matchingTranslation?.score ?? 0,
        order: line,
        partOfSpeech: rankedSection.partOfSpeech,
        sectionOrder,
      });
    }
  }

  const best = candidates.sort(
    (left, right) =>
      left.sectionOrder - right.sectionOrder ||
      right.languageCount - left.languageCount ||
      right.matchScore - left.matchScore ||
      left.order - right.order,
  )[0];
  if (!best) return null;

  return {
    word: term,
    definition_en: best.definition,
    pronunciation: "",
    audio_url: "",
    ipa: "",
    part_of_speech: best.partOfSpeech,
    // No suggested example: the saved meaning is a translation of the
    // definition itself, not a usage sentence.
    example_sentence: "",
  };
}

function isMeaningfulDefinition(value: string | null): value is string {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

function isMisspellingDefinition(value: string): boolean {
  return /^(?:a\s+)?(?:common\s+)?misspelling\s+of\b/iu.test(value.trim());
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
    /\{\{(?:trans-top-see|trans-top-also|checktrans-top|trans-top)(?=\||\}\})([^}]*)\}\}([\s\S]*?)\{\{trans-bottom\}\}/giu;

  for (const match of section.matchAll(boxPattern)) {
    const gloss = firstTemplateParameter(match[1] ?? "");
    const body = match[2] ?? "";
    const arabicTerms = extractArabicTerms(body);
    const languageCount = countTranslationLanguages(body);
    boxes.push({ gloss, arabicTerms, languageCount, order: boxes.length });
  }

  return boxes;
}

function countTranslationLanguages(translationBody: string): number {
  let count = 0;
  for (const line of translationBody.split(/\r?\n/u)) {
    if (/^[:#]*\*\s*\p{L}[^:\n]{0,80}:/u.test(line)) count += 1;
  }
  return count;
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
    .trim()
    // Some expanded Wiktionary templates leave wiki list punctuation around
    // otherwise clean prose (for example "!; Do your best!;").
    .replace(/^[!;,:.]+\s*/u, "")
    .replace(/;+\s*$/u, "")
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
  suggestions: string[] = [],
): Response {
  return errorResponse(
    failure.code,
    failure.message,
    failure.status,
    rate,
    failure.retryAfter ? { "Retry-After": failure.retryAfter } : undefined,
    suggestions.length > 0 ? { suggestions } : undefined,
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
  // nodejs_compat is enabled. Server-only translation credentials are read
  // here and are never included in the browser bundle.
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
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    {
      ok: false as const,
      error: { code, message },
      message,
      ...details,
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
  beforeAttempt?: () => Promise<boolean>,
  attempts: number = FETCH_ATTEMPTS,
): Promise<FetchAttempt> {
  let last: FetchAttempt = { ok: false, timedOut: false };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (beforeAttempt && !(await beforeAttempt())) return last;
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
