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
  const [app, route, migration, envExample, readme, packageJson] = await Promise.all([
    readFile(new URL("../app/vocabulary-box.tsx", import.meta.url), "utf8"),
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
  ]);

  assert.match(app, /signInWithPassword/);
  assert.match(app, /resetPasswordForEmail/);
  assert.match(app, /webkitSpeechRecognition/);
  assert.match(app, /meaning_ar\.includes\(query\)/);
  assert.match(app, /fetch\(["']\/api\/dictionary["']/);
  assert.match(route, /https:\/\/api\.dictionaryapi\.dev\/api\/v2\/entries\/en\//);
  assert.match(route, /https:\/\/en\.wiktionary\.org\/w\/api\.php/);
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
  assert.doesNotMatch(envExample, /(?:DICTIONARY|WIKTIONARY|TRANSLATE).*API_KEY/i);
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
