# EBARA reliability verification — 10 September 2026

## Changes

- Bound dictionary requests to six seconds; optional translations and cache operations have smaller budgets and cannot discard an already resolved word.
- Read nested Wiktionary senses, preserve section-linked words and taxonomic names, and avoid expanding unrelated rare senses. Version shared caches to invalidate older meanings.
- Retain the local improvements for durable dictionary caching, shared request limits, guest-word transfer, recoverable save/load errors, and cancellation.
- Guest transfer uses only columns the authenticated role can insert; creation timestamps are assigned by the database.
- Add GitHub checks for lint, TypeScript, production build, and route regressions.

## Verified

- Production build, lint, TypeScript, and 21 automated tests passed.
- The stalled optional-translation regression returns a usable word in under two seconds and cancels the upstream request.
- Live provider checks in local preview returned `high` and `resilient` with Arabic meanings in approximately 3.4 seconds. Local Azure credentials are not configured, so some expressions still require manual Arabic input.
- Restored the paused existing Supabase project. After restoration completed, the original tables were present; no replacement schema was applied.
- A transaction against the actual database verified authenticated save/read, case-insensitive duplicate rejection, and isolation from another user. The transaction rolled back all test records.

## Deployment

The existing site is public. Save the validated version before requesting public deployment approval. Its new D1 migration must be applied by Sites during deployment. Verify dictionary responses on the published version afterward; local checks do not establish production performance or a complete browser login flow.
