# Pre-ship checklist

> Run through this before saying "done" on any feature, fix, or refactor. If any box is unchecked, the work is not shipped.

## Auth & authz

- [ ] Every new or modified route has `requireAuth` (or is explicitly commented `// PUBLIC: <reason>`).
- [ ] Every admin-only route has `requireRole('admin')` (or equivalent) in addition to auth.
- [ ] Every route that acts on user-owned data checks ownership in the service, not only in the route.
- [ ] No secret keys, tokens, or passwords appear in API responses, logs, or client bundles.
- [ ] For Stripe/payment routes: webhook signatures verified; secret keys read from env only.

## Input validation

- [ ] Every new route has a Zod schema for body / query / params as applicable.
- [ ] Strings have `.min()` and `.max()`; numbers have bounds; IDs match a format.
- [ ] Enums are `z.enum()`, not free-text strings.
- [ ] Money is integer cents, never floats.
- [ ] Invalid input returns 400 with a structured error, not a 500.

## Unhappy paths (try to break it)

- [ ] I sent an empty body — got 400, not 500.
- [ ] I sent a body with extra fields — handled predictably (stripped or rejected).
- [ ] I sent the wrong types — got 400.
- [ ] I called without a token — got 401.
- [ ] I called with a valid token but am not the owner — got 403.
- [ ] I requested a non-existent resource — got 404.
- [ ] I created a duplicate — got 409 or a clear error.
- [ ] I killed the DB connection mid-request — got a clean 5xx, no crash, no hang.

## Output

- [ ] Responses do not leak `passwordHash`, `stripeCustomerId`, internal IDs, or other private fields.
- [ ] Error responses do not include stack traces in production.

## TypeScript

- [ ] No new `any` without a comment explaining why.
- [ ] Types for external input come from Zod via `z.infer`.
- [ ] `tsc --noEmit` passes.

## Tests

- [ ] At least one integration test exists for the new/changed route: happy path + one auth failure + one validation failure.
- [ ] Full test suite passes locally.

## Docs

- [ ] If I added an env var, it's in `.env.example` with a one-line description.
- [ ] If I added a script, it's in the README.
- [ ] If I added a new concept (entity, pattern, middleware), it's documented in a comment or in the README.

## Git & review

- [ ] Work is on a feature branch, not `main`.
- [ ] Commits are small and have imperative-mood messages.
- [ ] PR description answers: what changed, why, how to test, follow-ups.
- [ ] I re-read my own diff top-to-bottom as if a stranger wrote it.

## Secrets & config

- [ ] No `.env` committed.
- [ ] No hard-coded secret, API key, or credential in source.
- [ ] `config.ts` boots successfully with only the vars listed in `.env.example`.

## Observability

- [ ] Every log line for this feature has a request id and a user id (when authenticated).
- [ ] No `console.log` left behind.
- [ ] No PII or secrets in logs.

## Final gut check

- [ ] If this shipped to a paying customer tonight and broke at 3am, could the on-call engineer understand what happened from the logs alone?
- [ ] If an attacker found this endpoint tomorrow, is there anything here that would let them read/modify data they shouldn't?
- [ ] Would I be comfortable if my fellow developer reviewed this again and wrote another feedback doc?

If all three answers are yes, it ships.
