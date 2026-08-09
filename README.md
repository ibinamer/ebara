# EBARA

A minimal, private vocabulary vault built with Next.js, TypeScript, Tailwind CSS,
Supabase Auth, PostgreSQL, the Free Dictionary API, and Wiktionary.

EBARA does one thing: it saves English words with their dictionary
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
- Full English and Arabic interface with automatic LTR/RTL switching
- Light, dark, and system themes, each tuned separately rather than inverted
- Dashboard figures derived from stored columns: total words, words added in the
  last seven days, current daily streak, and the number of word types
- Word-type filters and newest/oldest/alphabetical sorting
- Responsive interface with focused add, detail, delete, and settings flows

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 App Router, served by `vinext` |
| Runtime | Cloudflare Workers (`workerd`) locally and in production |
| UI | React 19, TypeScript 5.9 |
| Styling | Tailwind CSS v4 plus a token layer in `app/globals.css` |
| Auth & data | Supabase Auth and PostgreSQL with row-level security |
| Build tooling | Vite 8, Wrangler |
| Dictionary sources | Free Dictionary API, Wiktionary via the MediaWiki Action API |
| Fonts | Playfair Display, IBM Plex Sans Arabic, IBM Plex Mono — self-hosted |

No component library, no state-management library, no icon font. The only
runtime dependencies are `@supabase/supabase-js`, `lucide-react`, `next`,
`react` and `react-dom`.

## Requirements

- Node.js **22.13.0 or newer** (declared in `package.json` → `engines`)
- npm 10 or newer

## Quick start

```bash
npm install
```

Copy the environment template (`copy .env.example .env.local` on Windows):

```bash
cp .env.example .env.local
```

Fill in the two Supabase values, then start the dev server:

```bash
npm run dev
```

The app runs at **http://localhost:3000**.

Without Supabase values the app still starts, in preview mode with seeded
records — useful for reviewing the interface, but nothing is saved.

## Environment variables

Both are public, browser-exposed values. There are no server-side secrets in
this project, and no service-role key is used anywhere.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | For accounts | Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For accounts | Supabase anon/publishable key |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are accepted as fallbacks for hosts that
do not forward `NEXT_PUBLIC_` variables.

Find both under **Project Settings → API** in the Supabase dashboard. Never
commit `.env.local`; `.gitignore` already excludes it.

## Database setup

1. Create a Supabase project.
2. Open the SQL editor and run
   `supabase/migrations/20260801190000_initial_vocabulary_box.sql`. It creates
   the `profiles` and `words` tables, owner-scoped row-level-security policies,
   and the search and duplicate-guard indexes.
3. Under **Authentication → URL Configuration**, add
   `http://localhost:3000` and your deployed URL to the redirect allow list, so
   email confirmation and password recovery links return to the app.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 3000 |
| `npm run build` | Production build into `dist/` |
| `npm start` | Serves the production build |
| `npm run lint` | ESLint across the project |
| `npm test` | Runs `build`, then the rendered-output tests |

`npm test` builds first by design — the tests import the built worker and assert
against real rendered HTML.

`run-dev.cmd` is an optional Windows helper that prepends the default Node
install path before calling `npm run dev`. It is not required on any other
platform, and `npm run dev` works directly once Node is on your `PATH`.

## Typography

Playfair Display sets the Latin interface and the vocabulary itself; IBM Plex
Sans Arabic sets the Arabic; IBM Plex Mono is used only for phonetic notation.
All are self-hosted from `public/fonts` and declared in `app/fonts.css`, so no
request leaves the app and the pairing renders the same in development and
production. Playfair is loaded as a variable face across 400–900 plus a true
italic, since a synthesised oblique on a serif this high-contrast looks broken.

Each face keeps its `unicode-range`, which is what makes one font stack serve
both scripts: Latin characters resolve to Playfair and Arabic characters to Plex
Arabic, even within a single line such as «sight» inside an Arabic sentence.

Sizes, weights and line heights come from one scale in `app/globals.css`
(`.type-display` through `.type-label`, plus the component classes). Two sets of
compensations live beside those rules:

- **For Playfair**, letter-spacing stays near zero — a contrast serif collides
  with itself under the tight negative tracking a grotesque can take — and
  Latin body and small text sit at weight 500 rather than 400, because the
  hairlines thin out badly below about 16px. Uppercase micro-labels go to 700.
- **For Arabic**, Latin letter-spacing is removed entirely, since negative
  tracking breaks the joins between letters; line height goes up; and the weight
  bump above is pulled back down, because Plex Arabic is low-contrast and sets
  heavier than Playfair at the same numeric weight.

## Art direction

The collection is presented as a glossary, not a dashboard. That decision
drives most of the interface:

- **Entries are ruled rows, not cards.** A vocabulary collection is a list, and
  a printed dictionary is the form that has always suited it: headword and its
  part of speech, the Arabic, then the date in the margin. Rows carry no border,
  radius or shadow of their own — the hairline between them is the only
  structure, and it is what gives the page its rhythm.
- **The figures are a colophon, not tiles.** Total, weekly count, streak and
  type count are set as one line of type beside the heading. Same numbers, but
  they caption the collection rather than competing with it.
- **Filters are a line of words.** Section navigation is marked with a rule
  under the current item, the way a magazine does it, rather than a tray of
  pills.
- **Search is a ruled line**, sharing the hairline vocabulary of the list below
  so the two read as one page. Focus thickens that rule instead of drawing a box
  around the field.
- **Orange is punctuation.** It appears three times: the primary action, the
  active filter, and the rule marking where the glossary begins. Everywhere else
  the page is ink on paper.

Corners are 2px, surfaces are flat, and there are no gradients. The only
shadows left are on the two elements that genuinely float — the modal and the
toast.

## Interface language and theme

The language switch (English or العربية) changes interface text only; stored
vocabulary is never rewritten. Selecting Arabic flips the document to RTL,
mirrors directional icons, and switches numbers and dates to Arabic formatting,
while English words and phonetic notation stay left-to-right.

The Arabic copy is written in Saudi Arabic rather than translated from the
English: conversational where the app addresses the learner ("وش تعلمت اليوم؟",
"ما لقينا شيء"), short and plain for controls and labels. System and error
messages stay clear and professional. The learner's collection is always
"مكتبتك".

Both the language and the theme are stored in `localStorage` under
`ebara:locale` and `ebara:theme`, and a small script in the document head
applies them before first paint so the page never flashes the wrong palette or
direction.

## Words and phrases

A saved entry can be a single word or a short set phrase — "catch up", "get it",
"look forward to" — up to six words. Anything spanning more than one word is
filed under the `phrase` type, so phrasal verbs and idioms collect in one
browsable filter instead of scattering across the noun and verb buckets their
head word happens to carry.

The Free Dictionary API is organised around single words and has no entry for
some ordinary phrases ("get it" returns 404 there). When that happens the server
reads the first published sense from the Wiktionary entry it has already
fetched for the Arabic translation. That is still a dictionary lookup, not
generated text.

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
browser and operating system. EBARA does not write voice recordings to
Supabase; only the selected word and its completed dictionary record are stored.

## Preview mode

Without Supabase values, the app intentionally opens with seeded dictionary
records so the complete dashboard and interactions can be reviewed locally.
Preview data is not persisted, and preview actions do not call external
dictionary services.

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

Everything the dashboard shows is computed from these columns. Word types are
the stored `part_of_speech` values, and the streak and weekly count come from
`created_at`. Progress states such as CEFR level, synonyms, antonyms, or a
learned/review flag are deliberately absent: the schema does not carry them, and
inventing them would show the learner numbers that are not real.

## Project layout

- `app/vocabulary-box.tsx` — the stateful container: auth, collection loading,
  search, saving, and the add-word capture flow
- `app/components/` — presentational, reusable pieces shared across screens
- `lib/i18n.tsx` — locale provider, English and Arabic dictionaries, formatting
- `lib/theme.tsx` — theme provider resolving light, dark, and system
- `lib/words.ts` — the word record type and derived collection statistics
- `app/globals.css` — design tokens, the type scale, and component classes
- `app/fonts.css` — self-hosted `@font-face` declarations
- `public/fonts/` — the woff2 subsets those declarations point at
