# Vocabulary Box

A minimal, private vocabulary vault built with Next.js, TypeScript, Tailwind CSS,
Supabase Auth, PostgreSQL, and Google Cloud Translation - Basic (v2).

Vocabulary Box does one thing: it saves an English word with its Arabic
translation so it can be found again. It does not add lessons, courses, games,
chat, or generated learning content.

## What it includes

- Supabase email/password sign up, login, logout, and password recovery
- Owner-only vocabulary records protected by PostgreSQL row-level security
- Instant English and Arabic search
- Typed input or short browser voice input
- English-to-Arabic translation through a server-only API route
- Responsive dark interface with focused add, detail, and delete flows

Voice capture uses the browser's speech-recognition support to turn a short
utterance into text. Availability and alternative spellings depend on the
browser and operating system; the selected text is then translated like typed
input. No separate audio transcription service is configured by this project.

## First-run local setup

1. Install dependencies with `npm install`.
2. Create a Supabase project, then run
   `supabase/migrations/20260801190000_initial_vocabulary_box.sql` in the
   Supabase SQL editor.
3. In Google Cloud, create or select a project, attach billing, and enable the
   **Cloud Translation API**.
4. Create an API key for Cloud Translation - Basic. Restrict the key to the
   Cloud Translation API and add application restrictions suitable for the
   deployed server.
5. Copy `.env.example` to `.env.local`, add the Supabase values, and set
   `GOOGLE_TRANSLATE_API_KEY`. This value is server-only and must never use a
   `NEXT_PUBLIC_` prefix.
6. Add the local and deployed URLs to the Supabase Auth redirect allow list.
7. Start the app with `npm run dev`.

The translation route sends plain English text to
`POST https://translation.googleapis.com/language/translate/v2` with `en` as
the source language and `ar` as the target language. Set Google Cloud quotas
and budget alerts before production use so usage remains predictable.

## Google attribution

Translations returned unchanged by Google must be shown with the required
Google Translate attribution. Keep the visible **Powered by Google Translate**
badge next to translated results and link it to <https://translate.google.com/>.
Review the current [Cloud Translation attribution requirements](https://cloud.google.com/translate/attribution)
before publishing because Google may update its branding rules.

The application description and user-facing help should also state that Google
Translate powers its translations. Do not include Google or Google Translate in
the product name.

## Preview mode

Without Supabase values, the app intentionally opens in a seeded preview mode so
the complete dashboard and interaction design can be reviewed locally. No preview
data is persisted and preview actions do not call Google Cloud Translation.

## Validation

- `npm run build`
- `npm run lint`
- `npm test`

## Data model

Supabase `auth.users` is the identity source. The migration adds private
`profiles` and `words` tables, owner-scoped RLS policies, a newest-first index,
case-insensitive duplicate protection, and English/Arabic search indexes. Each
word row stores only `id`, `user_id`, `word`, `meaning_ar`, and `created_at`.
