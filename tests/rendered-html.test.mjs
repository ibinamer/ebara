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

test("server-renders the Vocabulary Box dashboard preview", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Vocabulary Box — Every word, never lost<\/title>/i);
  assert.match(html, /My Vocabulary/);
  assert.match(html, /perseverance/i);
  assert.match(html, /المثابرة/);
  assert.match(html, /Search words or Arabic meanings/);
  assert.match(html, /Add word/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps auth, persistence, and Google translation in the product source", async () => {
  const [app, route, migration, envExample, readme, packageJson] = await Promise.all([
    readFile(new URL("../app/vocabulary-box.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/translate/route.ts", import.meta.url), "utf8"),
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
  assert.match(app, /fetch\(["']\/api\/translate["']/);
  assert.match(app, /google-translate-attribution\.png/);
  assert.match(app, /THIS SERVICE MAY CONTAIN TRANSLATIONS POWERED BY GOOGLE/);
  assert.match(route, /https:\/\/translation\.googleapis\.com\/language\/translate\/v2/);
  assert.match(route, /GOOGLE_TRANSLATE_API_KEY/);
  assert.match(envExample, /^GOOGLE_TRANSLATE_API_KEY=/m);
  assert.match(readme, /Powered by Google Translate/);
  assert.match(migration, /alter table public\.words enable row level security/i);
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
    ["id", "user_id", "word", "meaning_ar", "created_at"],
  );
  assert.doesNotMatch(
    [app, route, migration, envExample, readme].join("\n"),
    /OpenAI|\bAI\b/i,
  );
  assert.doesNotMatch(
    wordsTable,
    /^  (?:definition_en|part_of_speech|level|pronunciation|ipa|example1|example2)\s/gim,
  );
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/enrich/route.ts", import.meta.url)));
  await access(new URL("../.env.example", import.meta.url));
  await access(new URL("../public/favicon.svg", import.meta.url));
  await access(new URL("../public/google-translate-attribution.png", import.meta.url));
  await access(new URL("../supabase/migrations/20260801190000_initial_vocabulary_box.sql", import.meta.url));
  await access(projectRoot);
});
