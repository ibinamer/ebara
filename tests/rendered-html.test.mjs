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

async function callDictionary(word) {
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
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
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
  const [app, settings, route, migration, envExample, readme, packageJson, deleteAccount] = await Promise.all([
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
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /signInWithPassword/);
  assert.match(app, /emailRedirectTo:\s*window\.location\.origin/);
  assert.match(app, /resetPasswordForEmail/);
  assert.match(app, /acceptedTerms/);
  assert.match(app, /functions\.invoke\(["']delete-account["']/);
  assert.match(app, /ebara-vocabulary-/);
  assert.match(settings, /settings\.deleteAccount/);
  assert.match(settings, /settings\.export/);
  assert.match(deleteAccount, /auth\.admin\.deleteUser\(user\.id\)/);
  assert.match(deleteAccount, /DELETE_MY_ACCOUNT/);
  assert.match(app, /webkitSpeechRecognition/);
  assert.match(app, /meaning_ar\.includes\(query\)/);
  assert.match(app, /fetch\(["']\/api\/dictionary["']/);
  assert.match(route, /https:\/\/api\.dictionaryapi\.dev\/api\/v2\/entries\/en\//);
  assert.match(route, /https:\/\/en\.wiktionary\.org\/w\/api\.php/);
  assert.match(route, /https:\/\/translation\.googleapis\.com\/language\/translate\/v2/);
  assert.match(route, /GOOGLE_CLOUD_TRANSLATE_API_KEY/);
  assert.match(route, /definition_ar: definitionDecision\.ok \? definitionDecision\.data : ""/);
  assert.match(route, /SHARED_CACHE_MAX_AGE_SECONDS/);
  assert.doesNotMatch(route, /translate\.googleapis\.com\/translate_a\/single/);
  assert.match(readme, /Free Dictionary API/);
  assert.match(readme, /MediaWiki Action API/);

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
    "const [english, mainWikitext] = await Promise.all",
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
  assert.match(envExample, /^GOOGLE_CLOUD_TRANSLATE_API_KEY=/m);
  assert.doesNotMatch(envExample, /^NEXT_PUBLIC_GOOGLE_CLOUD_TRANSLATE_API_KEY=/m);
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
  await access(projectRoot);
});

test("saves a dictionary word when only the optional Arabic definition translation fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalGoogleKey = process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY;

  delete process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY;
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
          ].join("\\n"),
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
    assert.match(payload.data.definition_en, /organized collection/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGoogleKey === undefined) {
      delete process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY;
    } else {
      process.env.GOOGLE_CLOUD_TRANSLATE_API_KEY = originalGoogleKey;
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
    assert.match(html, /Last updated: 19 August 2026/);
  }
});
