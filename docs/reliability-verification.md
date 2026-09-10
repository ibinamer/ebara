# EBARA reliability verification — 10 September 2026

## Changes

- Bound dictionary requests to six seconds; optional translations and cache operations have smaller budgets and cannot discard an already resolved word.
- Read nested Wiktionary senses, preserve section-linked words and taxonomic names, and avoid expanding unrelated rare senses. Version shared caches to invalidate older meanings.
- Retain the local improvements for durable dictionary caching, shared request limits, guest-word transfer, recoverable save/load errors, and cancellation.
- Guest transfer uses only columns the authenticated role can insert; creation timestamps are assigned by the database.
- Add GitHub checks for lint, TypeScript, production build, and route regressions.

## Verified

- Production build, lint, TypeScript, and 22 automated tests passed.
- The stalled optional-translation regression returns a usable word in under two seconds and cancels the upstream request.
- Live provider checks in local preview returned `high` and `resilient` with Arabic meanings in approximately 3.4 seconds. Local Azure credentials are not configured, so some expressions still require manual Arabic input.
- Restored the paused existing Supabase project. After restoration completed, the original tables were present; no replacement schema was applied.
- A transaction against the actual database verified authenticated save/read, case-insensitive duplicate rejection, and isolation from another user. The transaction rolled back all test records.

## Follow-up verification

- Arabic definition translation now runs alongside short-meaning resolution. A stalled Wiktionary translation subpage no longer prevents the text translator from running; the winning result cancels outstanding work.
- Primary English provider gets one bounded attempt before the already-running Wiktionary fallback is used.
- Browser test on localhost with isolated guest storage passed add, reload, edit note, reload, delete, and reload. Only the synthetic test word was removed; the published site's existing guest words were untouched.
- Full authenticated browser, guest-transfer, and password-recovery roundtrip remain unverified. Automatic approval review rejected creating a persistent synthetic account directly in production auth tables; no account was created. These require an approved test account.

## Deployment

The user authorized publishing to the existing public site and updating GitHub main. Publish the validated follow-up and verify live dictionary responses; local timing is not production timing.
