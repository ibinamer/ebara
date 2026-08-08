# Vocabulary Box

A minimal, private vocabulary vault built with Next.js, TypeScript, Tailwind CSS,
Supabase Auth, PostgreSQL, the Free Dictionary API, and Wiktionary.

Vocabulary Box does one thing: it saves English words with their dictionary
information so they can be found again. It does not add lessons, courses,
games, streaks, chat, or other learning-platform features.

## What it includes

- Supabase email/password sign up, login, logout, and password recovery
- Owner-only vocabulary records protected by PostgreSQL row-level security
- Instant English and Arabic search
- Typed input or short browser voice input
- English definitions, pronunciation, IPA, part of speech, and an available
  example from the Free Dictionary API
- Arabic dictionary meanings from Wiktionary through the MediaWiki Action API
- Permanent Supabase storage for every completed word record
- Responsive dark interface with focused add, detail, and delete flows

## Dictionary lookup and save flow

1. The browser normalizes the recognized or typed English word and checks the
   owner's already-loaded collection first.
2. The authenticated server route repeats an owner-scoped Supabase lookup. If
   the word is already saved, it returns that stored record and makes no
   external dictionary request. This also covers stale tabs and other devices.
3. For a genuinely new word, the server retrieves the primary English entry
   from `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`. The first
   primary meaning and definition are treated as the most common result.
4. The server retrieves a matching Arabic dictionary meaning from English
   Wiktionary through `https://en.wiktionary.org/w/api.php`.
5. The completed record is inserted once into the owner's Supabase collection.
   A case-insensitive unique database index is the race-safe duplicate guard.

No generated fallback is substituted when a word or Arabic dictionary meaning
cannot be found. The user receives a clear error and can try another spelling.
The dictionary endpoints used by the server do not require project API keys.

## Voice privacy

Voice capture uses the browser's speech-recognition support to turn a short
utterance into English text. Availability and suggested spellings depend on the
browser and operating system. Vocabulary Box does not write voice recordings to
Supabase; only the selected word and its completed dictionary record are stored.

## First-run local setup

1. Install dependencies with `npm install`.
2. Create a Supabase project, then run
   `supabase/migrations/20260801190000_initial_vocabulary_box.sql` in the
   Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and add the Supabase project values.
4. Add the local and deployed URLs to the Supabase Auth redirect allow list.
5. Start the app with `npm run dev`.

## Preview mode

Without Supabase values, the app intentionally opens with seeded dictionary
records so the complete dashboard and interactions can be reviewed locally.
Preview data is not persisted, and preview actions do not call external
dictionary services.

## Validation

- `npm run build`
- `npm run lint`
- `npm test`

## Data model

Supabase `auth.users` is the identity source. The migration adds private
`profiles` and `words` tables, owner-scoped RLS policies, a newest-first index,
case-insensitive duplicate protection, and English/Arabic search indexes.

Each `words` row stores:

- `id`
- `user_id`
- `word`
- `meaning_ar`
- `definition_en`
- `pronunciation`
- `ipa`
- `part_of_speech`
- `example_sentence`
- `created_at`

All dictionary columns are present on every row. When the provider has no
pronunciation, IPA, or example sentence, the corresponding value is stored as
an empty string. The English definition, part of speech, and Arabic meaning must
be non-empty.
