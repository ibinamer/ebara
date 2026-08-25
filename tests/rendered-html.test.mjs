import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function callDictionary(word, bindings = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dictionary-test", `${process.pid}-${Date.now()}-${word}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/api/dictionary", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ word }),
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...bindings,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function callSpeech(audio, bindings = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("speech-test", `${process.pid}-${Date.now()}-${audio.byteLength}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/api/speech", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      },
      body: audio,
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      ...bindings,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function createUsageDatabase(initialCharacters = 0) {
  const state = {
    charactersUsed: initialCharacters,
    warningEmitted: initialCharacters >= 1_800_000,
  };

  return {
    state,
    prepare(query) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async run() {
          assert.match(query, /CREATE TABLE IF NOT EXISTS azure_translation_usage/);
          return { success: true };
        },
        async first() {
          if (/INSERT INTO azure_translation_usage/.test(query)) {
            const characters = Number(values[1]);
            if (state.charactersUsed + characters > 1_900_000) return null;
            state.charactersUsed += characters;
            return { characters_used: state.charactersUsed };
          }
          if (/UPDATE azure_translation_usage/.test(query)) {
            if (state.charactersUsed < 1_800_000 || state.warningEmitted) return null;
            state.warningEmitted = true;
            return { characters_used: state.charactersUsed };
          }
          throw new Error(`Unexpected D1 statement: ${query}`);
        },
      };
    },
  };
}

function createSpeechUsageDatabase(initialMilliseconds = 0) {
  const state = {
    millisecondsUsed: initialMilliseconds,
    warningEmitted: initialMilliseconds >= 14_400_000,
  };

  return {
    state,
    prepare(query) {
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          return this;
        },
        async run() {
          assert.match(query, /CREATE TABLE IF NOT EXISTS azure_speech_usage/);
          return { success: true };
        },
        async first() {
          if (/INSERT INTO azure_speech_usage/.test(query)) {
            const milliseconds = Number(values[1]);
            if (state.millisecondsUsed + milliseconds > 16_200_000) return null;
            state.millisecondsUsed += milliseconds;
            return { milliseconds_used: state.millisecondsUsed };
          }
          if (/UPDATE azure_speech_usage/.test(query)) {
            if (state.millisecondsUsed < 14_400_000 || state.warningEmitted) return null;
            state.warningEmitted = true;
            return { milliseconds_used: state.millisecondsUsed };
          }
          throw new Error(`Unexpected speech D1 statement: ${query}`);
        },
      };
    },
  };
}

function createPcmWav(durationMilliseconds = 1_000) {
  const sampleRate = 16_000;
  const sampleCount = Math.round((sampleRate * durationMilliseconds) / 1_000);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  return buffer;
}

test("server-renders the EBARA preview or configured auth bootstrap", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>EBARA — Every word, never lost<\/title>/i);
  const rendersConfiguredAuth = /Opening your box/i.test(html);
  if (rendersConfiguredAuth) {
    assert.match(html, /role="status"/i);
  } else {
    assert.match(html, /EBARA/);
    assert.match(html, /perseverance/i);
    assert.match(html, /المثابرة/);
    assert.match(html, /Search words or Arabic meanings/);
    assert.match(html, /Add word/);
  }
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps auth, private persistence, and dictionary lookup in the product source", async () => {
  const [
    app,
    settings,
    route,
    migration,
    audioMigration,
    translationOnlyMigration,
    speech,
    voiceInput,
    speechRoute,
    usageMeter,
    speechUsageMeter,
    usageSchema,
    usageMigration,
    speechUsageMigration,
    hostingConfig,
    envExample,
    readme,
    packageJson,
    deleteAccount,
  ] = await Promise.all([
    readFile(new URL("../app/vocabulary-box.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SettingsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dictionary/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260801190000_initial_vocabulary_box.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260823195227_add_dictionary_audio_url.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260825034500_allow_translation_only_entries.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../lib/speech.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/use-voice-input.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/speech/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/azure-translation-usage.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/azure-speech-usage.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_azure_translation_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_azure_speech_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /signInWithPassword/);
  assert.match(app, /emailRedirectTo:\s*window\.location\.origin/);
  assert.match(app, /data:\s*\{\s*display_name:\s*normalizedDisplayName\s*\}/);
  assert.match(app, /auth\.updateUser\(\{[\s\S]*display_name:\s*normalized/);
  assert.match(settings, /settings\.displayName/);
  assert.match(app, /resetPasswordForEmail/);
  assert.match(app, /acceptedTerms/);
  assert.match(app, /functions\.invoke\(["']delete-account["']/);
  assert.match(app, /ebara-vocabulary-/);
  assert.match(settings, /settings\.deleteAccount/);
  assert.match(settings, /settings\.export/);
  assert.match(deleteAccount, /auth\.admin\.deleteUser\(user\.id\)/);
  assert.match(deleteAccount, /DELETE_MY_ACCOUNT/);
  assert.match(voiceInput, /webkitSpeechRecognition/);
  assert.match(voiceInput, /MediaRecorder/);
  assert.match(voiceInput, /NATIVE_WATCHDOG_MS/);
  assert.match(voiceInput, /service-not-allowed/);
  assert.match(voiceInput, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(speechRoute, /AZURE_SPEECH_KEY/);
  assert.match(speechRoute, /AZURE_SPEECH_REGION/);
  assert.match(speechRoute, /format", "detailed"/);
  assert.match(speechRoute, /MAX_BODY_BYTES = 350_000/);
  assert.doesNotMatch(voiceInput, /AZURE_SPEECH_KEY/);
  assert.match(app, /meaning_ar\.includes\(query\)/);
  assert.match(app, /fetch\(["']\/api\/dictionary["']/);
  assert.match(route, /https:\/\/api\.dictionaryapi\.dev\/api\/v2\/entries\/en\//);
  assert.match(route, /https:\/\/api\.datamuse\.com\/words/);
  assert.match(route, /https:\/\/en\.wiktionary\.org\/w\/api\.php/);
  assert.match(route, /https:\/\/api\.cognitive\.microsofttranslator\.com/);
  assert.match(route, /AZURE_TRANSLATOR_KEY/);
  assert.match(route, /AZURE_TRANSLATOR_REGION/);
  assert.match(route, /\/dictionary\/lookup/);
  assert.match(route, /reserveAzureTranslationCharacters\(text\)/);
  assert.match(usageMeter, /AZURE_TRANSLATION_WARNING_CHARACTERS = 1_800_000/);
  assert.match(usageMeter, /AZURE_TRANSLATION_HARD_LIMIT_CHARACTERS = 1_900_000/);
  assert.match(usageMeter, /Array\.from\(text\)\.length/);
  assert.match(usageMeter, /ON CONFLICT\(month_key\) DO UPDATE/);
  assert.match(usageMeter, /reason: "meter-unavailable"/);
  assert.match(speechUsageMeter, /AZURE_SPEECH_WARNING_MILLISECONDS = 14_400_000/);
  assert.match(speechUsageMeter, /AZURE_SPEECH_HARD_LIMIT_MILLISECONDS = 16_200_000/);
  assert.match(speechUsageMeter, /reason: "meter-unavailable"/);
  assert.match(usageSchema, /CREATE TABLE IF NOT EXISTS azure_translation_usage/);
  assert.match(usageSchema, /CREATE TABLE IF NOT EXISTS azure_speech_usage/);
  assert.match(usageMigration, /characters_used[^]*1900000/);
  assert.match(speechUsageMigration, /milliseconds_used[^]*16200000/);
  assert.match(hostingConfig, /"d1": "DB"/);
  assert.match(
    route,
    /definition_ar: definitionDecision\?\.ok \? definitionDecision\.data : ""/,
  );
  assert.match(route, /manual-meaning-required/);
  assert.match(app, /add\.manualMeaningPlaceholder/);
  assert.match(app, /apiCode === "DICTIONARY_NOT_FOUND"/);
  assert.match(route, /action", "expandtemplates"/);
  assert.match(route, /SHARED_CACHE_MAX_AGE_SECONDS/);
  assert.match(route, /\/__ebara-cache\/v3\/dictionary\//);
  assert.match(route, /normalizeDictionaryAudioUrl/);
  assert.match(route, /audio_url/);
  assert.doesNotMatch(route, /translation\.googleapis\.com/);
  assert.match(readme, /Free Dictionary API/);
  assert.match(readme, /MediaWiki Action API/);
  assert.match(speech, /bestEnglishVoice/);
  assert.match(speech, /api\.dictionaryapi\.dev/);
  assert.match(speech, /ssl\.gstatic\.com/);
  assert.doesNotMatch(speech, /Chirp|\/api\/pronunciation/);
  assert.match(audioMigration, /add column audio_url text not null default ''/i);
  assert.match(audioMigration, /api\[\.\]dictionaryapi\[\.\]dev/);
  assert.match(audioMigration, /ssl\[\.\]gstatic\[\.\]com/);
  assert.match(translationOnlyMigration, /char_length\(word\) between 1 and 160/i);
  assert.match(
    translationOnlyMigration,
    /char_length\(definition_en\) between 0 and 1500/i,
  );
  assert.match(route, /translationOnlyResponse/);
  assert.match(route, /vocabulary_suggestions/);
  assert.match(app, /add\.sentenceSuggestionTitle/);
  assert.match(speech, /normalizeVocabularyInput/);

  const duplicateGuardIndex = app.indexOf("const existingWord = savedWords.find");
  const dictionaryFetchIndex = app.search(/fetch\(["']\/api\/dictionary["']/);
  assert.ok(duplicateGuardIndex >= 0, "missing pre-lookup duplicate guard");
  assert.ok(
    duplicateGuardIndex < dictionaryFetchIndex,
    "saved words must be checked before dictionary lookup",
  );

  const serverCacheGuardIndex = route.indexOf(
    "const cached = await findCachedWord",
  );
  const externalLookupIndex = route.indexOf(
    "const [english, mainWikitext, partOfSpeechRanking] = await Promise.all",
  );
  assert.ok(serverCacheGuardIndex >= 0, "missing owner-scoped server cache guard");
  assert.ok(
    serverCacheGuardIndex < externalLookupIndex,
    "Supabase must be checked before external dictionaries",
  );
  assert.match(route, /cached: true/);
  assert.match(route, /\/rest\/v1\/words/);

  const appInsert = app.match(
    /\.from\(["']words["']\)[\s\S]*?\.insert\(\{([\s\S]*?)\}\)/,
  )?.[1];
  assert.ok(appInsert, "missing Supabase word insert");
  for (const column of [
    "user_id",
    "word",
    "meaning_ar",
    "definition_en",
    "pronunciation",
    "audio_url",
    "ipa",
    "part_of_speech",
    "example_sentence",
  ]) {
    assert.match(appInsert, new RegExp(`\\b${column}\\b`));
  }

  assert.match(migration, /alter table public\.words enable row level security/i);
  assert.match(migration, /alter table public\.words force row level security/i);
  assert.match(migration, /words_user_created_at_idx/);
  assert.match(migration, /words_user_word_unique_idx/);
  assert.match(migration, /words_word_search_idx/);
  assert.match(migration, /words_meaning_ar_search_idx/);
  const wordsTable = migration.match(
    /create table public\.words \(([\s\S]*?)\n\);/i,
  )?.[1];
  assert.ok(wordsTable);
  assert.deepEqual(
    [...wordsTable.matchAll(
      /^  ([a-z][a-z0-9_]*)\s+(?:uuid|text|timestamptz)\b/gim,
    )].map((match) => match[1]),
    [
      "id",
      "user_id",
      "word",
      "meaning_ar",
      "definition_en",
      "pronunciation",
      "ipa",
      "part_of_speech",
      "example_sentence",
      "created_at",
    ],
  );

  for (const column of [
    "word",
    "meaning_ar",
    "definition_en",
    "pronunciation",
    "ipa",
    "part_of_speech",
    "example_sentence",
    "created_at",
  ]) {
    assert.match(
      wordsTable,
      new RegExp(`^  ${column}\\s+(?:text|timestamptz)\\s+not null`, "im"),
    );
  }

  const insertGrant = migration.match(
    /grant insert \(([\s\S]*?)\) on public\.words to authenticated;/i,
  )?.[1];
  assert.ok(insertGrant);
  for (const column of [
    "user_id",
    "word",
    "meaning_ar",
    "definition_en",
    "pronunciation",
    "ipa",
    "part_of_speech",
    "example_sentence",
  ]) {
    assert.match(insertGrant, new RegExp(`\\b${column}\\b`));
  }

  assert.doesNotMatch(
    [app, route, migration, envExample, readme, packageJson].join("\n"),
    /OpenAI|Anthropic|Gemini|\bLLM\b|Google Translate|\bAI\b/i,
  );
  assert.match(envExample, /^AZURE_TRANSLATOR_KEY=/m);
  assert.match(envExample, /^AZURE_TRANSLATOR_REGION=/m);
  assert.match(envExample, /^AZURE_SPEECH_KEY=/m);
  assert.match(envExample, /^AZURE_SPEECH_REGION=/m);
  assert.doesNotMatch(envExample, /^NEXT_PUBLIC_AZURE_TRANSLATOR_KEY=/m);
  assert.doesNotMatch(envExample, /^NEXT_PUBLIC_AZURE_SPEECH_KEY=/m);
  assert.doesNotMatch(wordsTable, /^  (?:level|example1|example2)\s/gim);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/enrich/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/translate/route.ts", import.meta.url)));
  await access(new URL("../.env.example", import.meta.url));
  await access(new URL("../public/favicon.svg", import.meta.url));
  await assert.rejects(
    access(new URL("../public/google-translate-attribution.png", import.meta.url)),
  );
  await access(new URL("../supabase/migrations/20260801190000_initial_vocabulary_box.sql", import.meta.url));
  await access(new URL("../supabase/migrations/20260823195227_add_dictionary_audio_url.sql", import.meta.url));
  await access(
    new URL(
      "../supabase/migrations/20260825034500_allow_translation_only_entries.sql",
      import.meta.url,
    ),
  );
  await access(projectRoot);
});

test("transcribes a short PCM recording through the protected Azure Speech route", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AZURE_SPEECH_KEY;
  const originalRegion = process.env.AZURE_SPEECH_REGION;
  const database = createSpeechUsageDatabase();
  const audio = createPcmWav(1_000);
  let azureCalls = 0;

  process.env.AZURE_SPEECH_KEY = "test-server-only-speech-key";
  process.env.AZURE_SPEECH_REGION = "qatarcentral";
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname !== "qatarcentral.stt.speech.microsoft.com") {
      throw new Error(`Unexpected speech request: ${url}`);
    }
    azureCalls += 1;
    assert.equal(url.searchParams.get("language"), "en-US");
    assert.equal(url.searchParams.get("format"), "detailed");
    assert.equal(init?.headers["Ocp-Apim-Subscription-Key"], "test-server-only-speech-key");
    assert.match(String(init?.headers["Content-Type"]), /audio\/wav/);
    return Response.json({
      RecognitionStatus: "Success",
      NBest: [
        { Display: "Perseverance.", Confidence: 0.94 },
        { Display: "Perseverances.", Confidence: 0.52 },
      ],
    });
  };

  try {
    const response = await callSpeech(audio, { DB: database });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(payload.alternatives, [
      { transcript: "Perseverance.", confidence: 0.94 },
      { transcript: "Perseverances.", confidence: 0.52 },
    ]);
    assert.equal(azureCalls, 1);
    assert.equal(database.state.millisecondsUsed, 1_000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.AZURE_SPEECH_KEY;
    else process.env.AZURE_SPEECH_KEY = originalKey;
    if (originalRegion === undefined) delete process.env.AZURE_SPEECH_REGION;
    else process.env.AZURE_SPEECH_REGION = originalRegion;
  }
});

test("stops the cloud microphone fallback before the monthly speech ceiling", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AZURE_SPEECH_KEY;
  const originalRegion = process.env.AZURE_SPEECH_REGION;
  const database = createSpeechUsageDatabase(16_199_500);
  let azureCalls = 0;

  process.env.AZURE_SPEECH_KEY = "test-server-only-speech-key";
  process.env.AZURE_SPEECH_REGION = "qatarcentral";
  globalThis.fetch = async () => {
    azureCalls += 1;
    return Response.json({ RecognitionStatus: "Success", DisplayText: "word" });
  };

  try {
    const response = await callSpeech(createPcmWav(1_000), { DB: database });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "SPEECH_USAGE_LIMIT");
    assert.equal(azureCalls, 0);
    assert.equal(database.state.millisecondsUsed, 16_199_500);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.AZURE_SPEECH_KEY;
    else process.env.AZURE_SPEECH_KEY = originalKey;
    if (originalRegion === undefined) delete process.env.AZURE_SPEECH_REGION;
    else process.env.AZURE_SPEECH_REGION = originalRegion;
  }
});

test("selects Azure dictionary meanings by part of speech and meters every attempt", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  const originalAzureRegion = process.env.AZURE_TRANSLATOR_REGION;
  const originalWarn = console.warn;
  const database = createUsageDatabase(1_799_990);
  const azureInputs = [];
  const warnings = [];
  let firstDictionaryAttempt = true;

  process.env.AZURE_TRANSLATOR_KEY = "test-server-only-key";
  process.env.AZURE_TRANSLATOR_REGION = "global";
  console.warn = (...values) => warnings.push(values.join(" "));
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "meter",
          phonetic: "/ˈmiːtə/",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                { definition: "A device used to measure something." },
              ],
            },
          ],
        },
      ]);
    }
    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "meter", tags: ["n"] }]);
    }
    if (url.hostname === "en.wiktionary.org") {
      const page = url.searchParams.get("page") ?? "";
      if (page.endsWith("/translations")) {
        return Response.json({ error: { code: "missingtitle" } });
      }
      return Response.json({
        parse: {
          wikitext: "==English==\n===Noun===\n# A device used to measure something.",
        },
      });
    }
    if (url.hostname === "api.cognitive.microsofttranslator.com") {
      const requestBody = JSON.parse(String(init?.body));
      const text = requestBody[0].Text;
      azureInputs.push(text);
      assert.equal(init?.headers.get("Ocp-Apim-Subscription-Key"), "test-server-only-key");
      assert.equal(init?.headers.get("Ocp-Apim-Subscription-Region"), "global");

      if (url.pathname === "/dictionary/lookup") {
        if (firstDictionaryAttempt) {
          firstDictionaryAttempt = false;
          return Response.json({ error: "temporary" }, { status: 503 });
        }
        return Response.json([
          {
            normalizedSource: "meter",
            translations: [
              {
                displayTarget: "يَقيس",
                posTag: "VERB",
                confidence: 0.99,
                backTranslations: [{ normalizedText: "meter" }],
              },
              {
                displayTarget: "مِقياس",
                posTag: "NOUN",
                confidence: 0.7,
                backTranslations: [{ normalizedText: "meter" }],
              },
            ],
          },
        ]);
      }

      if (url.pathname === "/translate") {
        return Response.json([
          {
            translations: [
              { text: "جهاز يستخدم لقياس شيء ما.", to: "ar" },
            ],
          },
        ]);
      }

      throw new Error(`Unexpected Azure endpoint: ${url.pathname}`);
    }
    throw new Error(`Unexpected external request in usage-warning test: ${url}`);
  };

  try {
    const response = await callDictionary("meter", { DB: database });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.data.meaning_ar, "مِقياس");
    assert.equal(payload.data.definition_ar, "جهاز يستخدم لقياس شيء ما.");
    assert.deepEqual(azureInputs, [
      "meter",
      "meter",
      "A device used to measure something.",
    ]);
    assert.equal(
      database.state.charactersUsed,
      1_799_990 + azureInputs.reduce((total, value) => total + Array.from(value).length, 0),
    );
    assert.equal(database.state.warningEmitted, true);
    assert.equal(warnings.filter((message) => message.includes("warning threshold")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
    if (originalAzureRegion === undefined) {
      delete process.env.AZURE_TRANSLATOR_REGION;
    } else {
      process.env.AZURE_TRANSLATOR_REGION = originalAzureRegion;
    }
  }
});

test("hard-stops Azure before 1.9M characters and silently uses the fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  const database = createUsageDatabase(1_899_999);
  let azureCalls = 0;
  let fallbackCalls = 0;

  process.env.AZURE_TRANSLATOR_KEY = "test-server-only-key";
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "quota",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                { definition: "A limited or fixed number or amount." },
              ],
            },
          ],
        },
      ]);
    }
    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "quota", tags: ["n"] }]);
    }
    if (url.hostname === "en.wiktionary.org") {
      const page = url.searchParams.get("page") ?? "";
      if (page.endsWith("/translations")) {
        return Response.json({ error: { code: "missingtitle" } });
      }
      return Response.json({
        parse: {
          wikitext: "==English==\n===Noun===\n# A limited or fixed number or amount.",
        },
      });
    }
    if (url.hostname === "api.cognitive.microsofttranslator.com") {
      azureCalls += 1;
      throw new Error("Azure must not be called after the protected cap");
    }
    if (url.hostname === "api.mymemory.translated.net") {
      fallbackCalls += 1;
      const query = url.searchParams.get("q");
      return Response.json({
        responseData: {
          translatedText:
            query === "a quota" ? "حِصّة" : "عدد أو مقدار محدود أو ثابت.",
        },
      });
    }
    throw new Error(`Unexpected external request in hard-limit test: ${url}`);
  };

  try {
    const response = await callDictionary("quota", { DB: database });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.data.meaning_ar, "حِصّة");
    assert.equal(payload.data.definition_ar, "عدد أو مقدار محدود أو ثابت.");
    assert.equal(azureCalls, 0);
    assert.equal(fallbackCalls, 2);
    assert.equal(database.state.charactersUsed, 1_899_999);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("saves a dictionary word when only the optional Arabic definition translation fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "database",
          phonetic: "/ˈdeɪtəˌbeɪs/",
          phonetics: [
            {
              text: "/ˈdeɪtəˌbeɪs/",
              audio: "//ssl.gstatic.com/dictionary/static/sounds/database.mp3",
            },
          ],
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                {
                  definition:
                    "An organized collection of structured information stored electronically.",
                },
              ],
            },
          ],
        },
      ]);
    }

    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "database", tags: ["n"] }]);
    }

    if (url.hostname === "en.wiktionary.org") {
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Noun===",
            "# An organized collection of structured information.",
            "====Translations====",
            "{{trans-top|organized collection of information}}",
            "* Arabic: {{t|ar|قاعدة بيانات}}",
            "{{trans-bottom}}",
          ].join("\n"),
        },
      });
    }

    if (url.hostname === "api.mymemory.translated.net") {
      if (url.searchParams.get("q") === "a database") {
        return Response.json({
          responseData: { translatedText: "قاعدة بيانات" },
        });
      }
      return Response.json({ message: "unavailable" }, { status: 503 });
    }

    throw new Error(`Unexpected external request in dictionary test: ${url}`);
  };

  try {
    const response = await callDictionary("database");
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.data.word, "database");
    assert.equal(payload.data.meaning_ar, "قاعدة بيانات");
    assert.equal(payload.data.definition_ar, "");
    assert.equal(
      payload.data.audio_url,
      "https://ssl.gstatic.com/dictionary/static/sounds/database.mp3",
    );
    assert.match(payload.data.definition_en, /organized collection/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("uses corpus popularity to select the common adjective sense of high", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "high",
          phonetic: "/haɪ/",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                {
                  definition:
                    "A high point or position; an elevated place or superior region.",
                },
              ],
            },
            {
              partOfSpeech: "adjective",
              definitions: [
                {
                  definition:
                    "Very elevated; extending or being far above a base; tall; lofty.",
                },
              ],
            },
          ],
        },
      ]);
    }

    if (url.hostname === "api.datamuse.com") {
      return Response.json([
        { word: "high", tags: ["adj", "adv", "n", "v"] },
      ]);
    }

    if (url.hostname === "en.wiktionary.org") {
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Noun===",
            "# A high point or position.",
            "===Adjective===",
            "# Very elevated; far above a base.",
            "====Translations====",
            "{{trans-top|a high point or position}}",
            "* Arabic: {{t|ar|قمة}}",
            "{{trans-bottom}}",
            "{{trans-top|elevated; tall}}{{multitrans|data=",
            "* Arabic: {{qualifier|indefinite}} {{tt|ar|عَالٍ}}, {{tt+|ar|طَوِيل}}",
            "*: Egyptian Arabic: {{tt|arz|عالي}}",
            "*: Moroccan Arabic: {{t-needed|ary}}",
            "}}",
            "{{trans-bottom}}",
            "{{trans-top|slang: under the influence of drugs}}",
            "* Arabic: {{tt|ar|مَسْطُول}}",
            "{{trans-bottom}}",
          ].join("\n"),
        },
      });
    }

    if (url.hostname === "api.mymemory.translated.net") {
      return Response.json({ message: "unavailable" }, { status: 503 });
    }

    throw new Error(`Unexpected external request in high test: ${url}`);
  };

  try {
    const response = await callDictionary("high");
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.data.word, "high");
    assert.equal(payload.data.part_of_speech, "adjective");
    assert.equal(payload.data.meaning_ar, "عَالٍ");
    assert.match(payload.data.definition_en, /very elevated/i);
    assert.equal(payload.data.ipa, "/haɪ/");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("reads trans-top-see Arabic meanings without falling through to translation", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  let myMemoryCalls = 0;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "package",
          phonetic: "/ˈpækɪdʒ/",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [
                {
                  definition: "Something which is packed, a parcel, a box, an envelope.",
                },
              ],
            },
          ],
        },
      ]);
    }

    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "package", tags: ["n", "v"] }]);
    }

    if (url.hostname === "en.wiktionary.org") {
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Noun===",
            "# Something which is packed, a parcel, a box, an envelope.",
            "====Translations====",
            "{{trans-top-see|something which is packed|pack}}",
            "* Arabic: {{t|ar|صُرَّة|f}}, {{t+|ar|طَرْد|m}}, {{t|ar|حُزْمَة|f}}",
            "{{trans-bottom}}",
          ].join("\n"),
        },
      });
    }

    if (url.hostname === "api.mymemory.translated.net") {
      myMemoryCalls += 1;
      return Response.json({ message: "rate limited" }, { status: 429 });
    }

    throw new Error(`Unexpected external request in package test: ${url}`);
  };

  try {
    const response = await callDictionary("package");
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.needs_arabic_meaning, false);
    assert.equal(payload.data.meaning_ar, "صُرَّة");
    // One optional definition translation may still be attempted; the required
    // short meaning must already have come from Wiktionary.
    assert.equal(myMemoryCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("returns English dictionary facts for manual Arabic entry when translators fail", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "fallback",
          phonetic: "/ˈfɔːlbæk/",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [{ definition: "An alternative used when another option fails." }],
            },
          ],
        },
      ]);
    }

    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "fallback", tags: ["n"] }]);
    }

    if (url.hostname === "en.wiktionary.org") {
      return Response.json({ parse: { wikitext: "==English==\n===Noun===\n# An alternative." } });
    }

    if (url.hostname === "api.mymemory.translated.net") {
      return Response.json({ message: "rate limited" }, { status: 429 });
    }

    throw new Error(`Unexpected external request in fallback test: ${url}`);
  };

  try {
    const response = await callDictionary("fallback");
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.needs_arabic_meaning, true);
    assert.equal(payload.data.word, "fallback");
    assert.equal(payload.data.meaning_ar, "");
    assert.match(payload.data.definition_en, /alternative/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("expands template-only Wiktionary definitions for ordinary phrases", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  const expandedPages = [];

  const phraseDefinitions = new Map([
    [
      "big guy",
      {
        raw: "{{non-gloss|A term of [[endearment]], usually addressed toward an all-around good male person.}}",
        expanded:
          '<span class="use-with-mention">A term of [[:endearment#English|endearment]], usually addressed toward an all-around good male person.</span>',
        expected: /term of endearment/i,
      },
    ],
    [
      "by the book",
      {
        raw: "{{&lit|en|by|the|book}}",
        expanded:
          "Used other than figuratively or idiomatically: see [[by]], [[the]], [[book]].",
        expected: /used other than figuratively/i,
      },
    ],
    [
      "break a leg",
      {
        raw: "{{non-gloss|!; Do your best!;}}",
        expanded: "!; Do your best!;",
        expected: /^Do your best!$/,
      },
    ],
  ]);

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json({ title: "No Definitions Found" }, { status: 404 });
    }

    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ tags: ["n"] }]);
    }

    if (url.hostname === "en.wiktionary.org") {
      const action = url.searchParams.get("action");
      const page = url.searchParams.get("page") ?? url.searchParams.get("title") ?? "";
      if (action === "expandtemplates") {
        const phrase = phraseDefinitions.get(page);
        assert.ok(phrase, `Unexpected phrase expansion: ${page}`);
        expandedPages.push(page);
        return Response.json({ expandtemplates: { wikitext: phrase.expanded } });
      }

      if (page.endsWith("/translations")) {
        return Response.json({ error: { code: "missingtitle" } });
      }

      const phrase = phraseDefinitions.get(page);
      assert.ok(phrase, `Unexpected Wiktionary page: ${page}`);
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Noun===",
            `# ${phrase.raw}`,
          ].join("\n"),
        },
      });
    }

    if (url.hostname === "api.mymemory.translated.net") {
      return Response.json({ message: "rate limited" }, { status: 429 });
    }

    throw new Error(`Unexpected external request in phrase test: ${url}`);
  };

  try {
    for (const [phrase, expectation] of phraseDefinitions) {
      const response = await callDictionary(phrase);
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.ok, true);
      assert.equal(payload.needs_arabic_meaning, true);
      assert.equal(payload.data.word, phrase);
      assert.equal(payload.data.part_of_speech, "phrase");
      assert.match(payload.data.definition_en, expectation.expected);
    }
    assert.deepEqual(expandedPages.sort(), [...phraseDefinitions.keys()].sort());
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("keeps an Azure phrase meaning short and translates its definition separately", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  const azureInputs = [];

  process.env.AZURE_TRANSLATOR_KEY = "test-server-only-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json({ title: "No Definitions Found" }, { status: 404 });
    }
    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ tags: ["n"] }]);
    }
    if (url.hostname === "en.wiktionary.org") {
      const action = url.searchParams.get("action");
      const page = url.searchParams.get("page") ?? url.searchParams.get("title") ?? "";
      if (action === "expandtemplates") {
        return Response.json({
          expandtemplates: {
            wikitext:
              "A term of endearment, usually addressed toward an all-around good male person.",
          },
        });
      }
      if (page.endsWith("/translations")) {
        return Response.json({ error: { code: "missingtitle" } });
      }
      return Response.json({
        parse: {
          wikitext:
            "==English==\n===Noun===\n# {{non-gloss|A term of endearment, usually addressed toward an all-around good male person.}}",
        },
      });
    }
    if (url.hostname === "api.cognitive.microsofttranslator.com") {
      const text = JSON.parse(String(init?.body))[0].Text;
      azureInputs.push(text);
      if (url.pathname === "/dictionary/lookup") {
        return Response.json([{ normalizedSource: "big guy", translations: [] }]);
      }
      if (url.pathname === "/translate") {
        return Response.json([
          {
            translations: [
              {
                text:
                  text === "big guy"
                    ? "الرجل الكبير"
                    : "مصطلح محبة يوجّه عادةً إلى رجل طيب.",
                to: "ar",
              },
            ],
          },
        ]);
      }
    }
    throw new Error(`Unexpected external request in Azure phrase test: ${url}`);
  };

  try {
    const response = await callDictionary("big guy", {
      DB: createUsageDatabase(),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.data.meaning_ar, "الرجل الكبير");
    assert.equal(payload.data.definition_ar, "مصطلح محبة يوجّه عادةً إلى رجل طيب.");
    assert.deepEqual(azureInputs, [
      "big guy",
      "big guy",
      "A term of endearment, usually addressed toward an all-around good male person.",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("translates an obvious short sentence directly and suggests its useful word", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;
  const azureInputs = [];

  process.env.AZURE_TRANSLATOR_KEY = "test-server-only-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    assert.equal(url.hostname, "api.cognitive.microsofttranslator.com");
    assert.equal(url.pathname, "/translate");
    const text = JSON.parse(String(init?.body))[0].Text;
    azureInputs.push(text);
    return Response.json([
      { translations: [{ text: "إنه وسيم جدًا", to: "ar" }] },
    ]);
  };

  try {
    const response = await callDictionary("He is so handsome", {
      DB: createUsageDatabase(),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.entry_kind, "sentence");
    assert.deepEqual(payload.vocabulary_suggestions, ["handsome"]);
    assert.equal(payload.data.word, "He is so handsome");
    assert.equal(payload.data.meaning_ar, "إنه وسيم جدًا");
    assert.equal(payload.data.definition_en, "");
    assert.equal(payload.data.part_of_speech, "sentence");
    assert.deepEqual(azureInputs, ["He is so handsome"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("offers spelling suggestions for a missing single word instead of translating it", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json({ title: "Service unavailable" }, { status: 503 });
    }
    if (url.hostname === "en.wiktionary.org") {
      if (url.searchParams.get("action") === "expandtemplates") {
        return Response.json({
          expandtemplates: {
            wikitext: "Misspelling of [[perseverance]].",
          },
        });
      }
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Noun===",
            "# {{misspelling of|en|perseverance}}",
          ].join("\n"),
        },
      });
    }
    if (url.hostname === "api.datamuse.com") {
      return url.searchParams.get("max") === "5"
        ? Response.json([{ word: "perseverance", score: 998 }])
        : Response.json([]);
    }
    throw new Error(`Unexpected request in spelling suggestion test: ${url}`);
  };

  try {
    const response = await callDictionary("perserverance");
    const payload = await response.json();
    assert.equal(response.status, 404, JSON.stringify(payload));
    assert.equal(payload.error.code, "DICTIONARY_NOT_FOUND");
    assert.deepEqual(payload.suggestions, ["perseverance"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("uses translation coverage to prefer the broadly documented phrase sense", async () => {
  const originalFetch = globalThis.fetch;
  const originalAzureKey = process.env.AZURE_TRANSLATOR_KEY;

  delete process.env.AZURE_TRANSLATOR_KEY;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );

    if (url.hostname === "api.dictionaryapi.dev") {
      return Response.json([
        {
          word: "catch up",
          meanings: [
            {
              partOfSpeech: "verb",
              definitions: [
                { definition: "To pick up suddenly." },
                { definition: "To reach something that had been ahead." },
              ],
            },
          ],
        },
      ]);
    }
    if (url.hostname === "api.datamuse.com") {
      return Response.json([{ word: "catch up", tags: ["v"] }]);
    }
    if (url.hostname === "en.wiktionary.org") {
      const page = url.searchParams.get("page") ?? "";
      if (page.endsWith("/translations")) {
        return Response.json({ error: { code: "missingtitle" } });
      }
      return Response.json({
        parse: {
          wikitext: [
            "==English==",
            "===Verb===",
            "# {{lb|en|transitive}} To [[pick up]] [[suddenly]].",
            "# {{lb|en|ambitransitive}} To [[reach]] something that had been [[ahead]].",
            "====Translations====",
            "{{trans-top|to pick up suddenly}}",
            "* Bulgarian: {{t|bg|грабвам}}",
            "* Turkish: {{t|tr|yakalamak}}",
            "{{trans-bottom}}",
            "{{trans-top|to reach something that had been ahead}}",
            "* Arabic: {{t|ar|لَحِقَ}}",
            "* French: {{t|fr|rattraper}}",
            "* German: {{t|de|einholen}}",
            "* Italian: {{t|it|raggiungere}}",
            "* Japanese: {{t|ja|追い付く}}",
            "* Spanish: {{t|es|alcanzar}}",
            "{{trans-bottom}}",
          ].join("\n"),
        },
      });
    }
    if (url.hostname === "api.mymemory.translated.net") {
      return Response.json({ message: "rate limited" }, { status: 429 });
    }
    throw new Error(`Unexpected external request in phrase-sense test: ${url}`);
  };

  try {
    const response = await callDictionary("catch up");
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.match(payload.data.definition_en, /reach something that had been ahead/i);
    assert.equal(payload.data.meaning_ar, "لَحِقَ");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAzureKey === undefined) {
      delete process.env.AZURE_TRANSLATOR_KEY;
    } else {
      process.env.AZURE_TRANSLATOR_KEY = originalAzureKey;
    }
  }
});

test("server-renders bilingual legal pages", async () => {
  for (const pathname of ["/privacy", "/terms"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /EBARA/);
    assert.match(html, pathname === "/privacy" ? /Privacy notice/ : /Terms of use/);
    assert.match(
      html,
      pathname === "/privacy"
        ? /Last updated: 25 August 2026/
        : /Last updated: 24 August 2026/,
    );
    if (pathname === "/privacy") {
      assert.match(html, /short sentence/);
      assert.match(html, /Datamuse/);
    }
  }
});
