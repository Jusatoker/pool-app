# CLAUDE.md — Engineering Rules (Company-Grade)

> **Read this file in full before writing or modifying any code in this repo.**
> These rules are binding. If you believe a rule should be broken for a specific case, STOP and ask the user for an explicit override using the syntax at the bottom of this file.

---

## 0. Non-negotiables (the "never let this ship" list)

These rules are absolute. Violating any of them is a bug, regardless of whether tests pass or the feature works on the happy path.

1. **Every HTTP route is authenticated by default.** Public routes must be explicitly whitelisted in code with a comment explaining why. No route ships without either `requireAuth` (or equivalent) *or* an explicit `// PUBLIC: <reason>` comment.
2. **Every route that accepts input validates that input server-side.** Client-side checks do not count. The server is the gatekeeper.
3. **Secrets never live in source code or in the repo.** Not in `config.js`, not in a JSON file, not "just for dev." They live in environment variables, and `.env` is gitignored.
4. **Payment, billing, secrets, and admin routes get an extra role/permission check on top of authentication.** Being logged in is not enough to change Stripe keys or read other users' data.
5. **Error paths are implemented, not TODO'd.** Every API route handles: missing auth, bad input, not-found, conflict, and internal error. No `try { ... } catch (e) { console.log(e) }` and moving on.
6. **No committing to `main` directly.** Every change goes through a feature branch and a pull request, even for solo work.
7. **If I (Claude) am uncertain about a security-relevant decision, I stop and ask.** Paranoia beats a breach.

---

## 1. Project shape and structure

### 1.1 Frontend

- **Do not write large single-file HTML apps with inline `<script>` blocks.** If the app has more than ~3 screens or ~200 lines of JS, it needs a component-based structure.
- **Default framework choice for new projects: React + Vite + TypeScript.** Rationale: largest job-market surface area, best AI-assist tooling, most documentation. Swap only with an explicit user decision.
- **Components live in their own files.** One component per file, named the same as the component. No 500-line files.
- **State management:** start with React Context + `useState`. Introduce a store (Zustand, Redux Toolkit) only when multiple unrelated components need the same state.
- **CSS:** Tailwind for new projects unless told otherwise. No inline styles except for one-off dynamic values.

### 1.2 Backend

- **Default stack for new projects: Node + Express (or Fastify) + TypeScript + Zod + Prisma (or Drizzle) + Postgres.** Swap only with an explicit user decision.
- **Folder layout:**
  ```
  backend/
    src/
      routes/          # Express routers, thin — delegate to services
      services/        # Business logic
      middleware/      # auth, error handler, request logger, rate limit
      schemas/         # Zod schemas for every input and output
      db/              # Prisma client, migrations
      lib/             # shared utilities
      config.ts        # reads + validates env vars with Zod
      server.ts        # wires everything together
    tests/
  ```
- **Routes are thin.** A route handler parses input (Zod), calls a service, returns a response. No business logic in routes.
- **One service per domain.** `auth.service.ts`, `equipment.service.ts`, etc.

### 1.3 Repo layout

- Monorepo (`/frontend`, `/backend`, `/shared`) is fine for small teams. `/shared` holds types and Zod schemas consumed by both sides.
- Root `README.md` is required (see §5).
- Root `.env.example` is required and lists **every** env var with a one-line description.
- `.gitignore` excludes: `node_modules/`, `.env`, `.env.*` (except `.env.example`), `dist/`, `build/`, `coverage/`, `.DS_Store`, IDE folders.

---

## 2. Authentication and authorization (the rule that most often gets skipped)

### 2.1 The default is "locked"

Every route is **private** until proven public. Concretely:

- At the router level, apply `requireAuth` globally: `app.use('/api', requireAuth, apiRouter)`.
- Routes that must be reachable without auth (login, register, password reset request, health check, webhooks) are explicitly moved *above* that line or are mounted on a separate public router. Each public route gets a comment:
  ```ts
  // PUBLIC: login endpoint — users cannot auth before they have a token
  publicRouter.post('/auth/login', loginHandler)
  ```

### 2.2 Roles and permissions

- `requireAuth` proves *who* the caller is. It does not prove *what they are allowed to do*.
- Admin-only routes (settings, billing config, user management, feature flags) get an additional `requireRole('admin')` middleware.
- Routes that act on a specific user's data check ownership: "the authenticated user id must match the resource's owner id" — enforce this in the service, not only in the route.

### 2.3 Stripe and other payment integrations

Treat payment integrations as hostile territory. For any Stripe-related work:

- Secret keys (`sk_live_*`, `sk_test_*`) are read from env vars only. Never logged. Never returned in an API response. Never stored in the database in plaintext — if they *must* be stored (multi-tenant SaaS with per-tenant keys), they are encrypted at rest with a key from a secrets manager and redacted in all logs.
- Webhook endpoints verify the Stripe signature on every request. No signature, no processing.
- Any route that reads or writes Stripe config requires `requireAuth` + `requireRole('admin')`.
- Stripe customer/subscription IDs are never trusted from the client — always look them up server-side against the authenticated user.

### 2.4 JWTs and sessions

- JWT secret is a long random string from env. Rotate-able.
- Tokens have a short expiry (≤ 1 hour for access tokens). Use refresh tokens for longer sessions.
- On logout, revoke server-side if using session tokens; for stateless JWTs, keep expiries short and provide a deny-list for compromised tokens.
- Never put sensitive data in a JWT payload — it is readable by anyone who has the token.

### 2.5 Passwords

- Hash with `bcrypt` (cost ≥ 12) or `argon2id`. Never `md5`, `sha1`, `sha256`, or "my own hashing."
- Password minimums: length ≥ 12, no composition rules (per NIST).
- Never log passwords. Never email passwords. Reset flows use time-limited single-use tokens.

---

## 3. Input validation (server-side is the only validation that matters)

### 3.1 Use Zod

- Every API route that accepts a body, query, or params defines a Zod schema for each.
- Schemas live in `src/schemas/` (or `/shared/schemas/` in a monorepo) and are imported by the route.
- Validation happens via middleware (`validate(schema)`) or at the top of the handler. On failure: respond `400` with a structured error body, do not continue.

### 3.2 Shape of a validated route

```ts
// schemas/equipment.ts
export const createEquipmentSchema = z.object({
  name: z.string().min(1).max(200),
  serialNumber: z.string().regex(/^[A-Z0-9-]+$/).max(64),
  purchasedAt: z.coerce.date(),
  costCents: z.number().int().nonnegative().max(10_000_000),
})
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>

// routes/equipment.ts
router.post('/equipment',
  requireAuth,
  validateBody(createEquipmentSchema),
  async (req, res, next) => {
    try {
      const equipment = await equipmentService.create(req.user.id, req.body)
      res.status(201).json(equipment)
    } catch (err) { next(err) }
  }
)
```

### 3.3 Rules of thumb for schemas

- **Strings:** always `.min(1)` and a sensible `.max()`. Unbounded strings invite abuse.
- **Numbers:** always bound `.min` and `.max`. No "just trust it."
- **IDs:** validate format (UUID, cuid, numeric) — don't accept arbitrary strings.
- **Enums:** use `z.enum([...])` for anything that is one of a fixed set. Never free-text.
- **Dates:** use `z.coerce.date()` so strings parse consistently; reject invalid dates.
- **Money:** store as integer cents. Never floats.
- **Unknown fields:** schemas default to stripping unknown keys. For admin inputs, use `.strict()` and reject unknown keys.

### 3.4 Output validation too (when it matters)

- For any response that returns user-generated data to another user, explicitly select the fields you return — never `res.json(user)` where `user` includes `passwordHash`, `stripeCustomerId`, etc. Define a `publicUser` Zod schema and map to it.

---

## 4. Error handling and "unhappy paths"

### 4.1 Every route handles the standard failure modes

For every route I write, I explicitly think through and handle:

1. Missing or invalid auth → 401
2. Authenticated but not authorized → 403
3. Malformed input → 400 (Zod handles this)
4. Resource not found → 404
5. Conflict (duplicate, already exists) → 409
6. Upstream failure (DB, Stripe, external API) → 502/503 with retry guidance if applicable
7. Unhandled exception → 500 via a centralized error handler that does not leak stack traces in production

### 4.2 Central error handler

- Every Express app has a final error-handling middleware that:
  - Logs the full error server-side (with request id, user id if known, route).
  - Returns a sanitized JSON body to the client: `{ error: { code, message } }`. No stack traces. No SQL. No internal paths.
- Log levels: `error` for 5xx, `warn` for 4xx that indicate abuse (repeated 401s from same IP), `info` for normal requests.

### 4.3 The "try to break it yourself" rule

Before declaring any endpoint done, I ask: *what happens if…*
- …the user sends no body?
- …the user sends a body with extra fields?
- …the user sends a string where a number is expected?
- …the user sends a 10 MB payload?
- …the user is not logged in?
- …the user is logged in but is not the owner?
- …the database is down?
- …the request is sent 100 times in a second?

If any of those produces a 500, a stack trace, or unintended behavior, the endpoint is not done.

---

## 5. Documentation (the README is not optional)

### 5.1 Root `README.md` must contain

1. **What this project is** — one or two sentences.
2. **Tech stack** — one line: "Node 20, Express, TypeScript, Postgres, Prisma, React, Vite, Tailwind."
3. **Quick start** — the exact commands to go from `git clone` to a running app, in order. Including `cp .env.example .env`, installing deps, running migrations, seeding, starting dev servers.
4. **Environment variables** — a table or list pointing at `.env.example` with a one-line description of each variable and whether it is required.
5. **Scripts** — every useful `npm run` command and when to use it.
6. **Architecture map** — one paragraph: "requests come in through Express, routes call services, services use Prisma to talk to Postgres; the React frontend under `/frontend` talks to the API under `/api`."
7. **Testing** — how to run tests, where they live.
8. **Deployment** — even a TODO is better than nothing.

### 5.2 Inline documentation

- Every service function has a one-line JSDoc comment describing what it does and any non-obvious side effects.
- Every Zod schema with non-obvious rules has a comment explaining *why* (e.g., `// max 200 because the UI truncates beyond that`).
- No commented-out code in committed files.

---

## 6. TypeScript rules

- New projects are TypeScript from day one. Existing JS projects migrate file-by-file; new files are `.ts`.
- `tsconfig.json` has: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`.
- `any` is banned except with a `// eslint-disable-next-line` comment explaining why. Prefer `unknown` and narrow.
- Types for external input (request bodies, query params, third-party API responses) come from Zod schemas via `z.infer`. Never hand-write a type that duplicates a runtime schema.

---

## 7. Testing

- New features ship with at least one test. "No tests yet" is an acceptable *project state* (greenfield); "I added a feature and wrote no tests" is not.
- Priorities, in order:
  1. **Integration tests for API routes** — spin up the app, hit the route with `supertest` or similar, assert on auth and validation behavior. One test per standard failure mode (401, 403, 400, 404, happy path).
  2. **Unit tests for services** with non-trivial logic.
  3. **E2E tests** for critical flows (login, signup, checkout) via Playwright.
- Tests run in CI on every PR. A PR with failing tests does not merge.

---

## 8. Git workflow (even solo)

- `main` is protected in spirit — no direct commits.
- Branch naming: `<type>/<short-description>`, e.g., `feat/equipment-validation`, `fix/auth-header-case`, `chore/update-deps`, `docs/readme`.
- Commits are small and focused. Each commit message answers "what and why," not "what." Imperative mood: "Add Zod validation to equipment routes," not "added zod."
- Every change lands via a PR. PR description includes: what changed, why, how to test, and any follow-ups.
- Review the diff line-by-line before merging — read it like a stranger wrote it.

---

## 9. Secrets and environment

- `.env.example` is committed and complete. Every env var the app reads appears there.
- `.env` is gitignored. Period.
- At app boot, env vars are parsed and validated with Zod (`src/config.ts`). If a required var is missing, the app refuses to start with a clear error.
- Never log env vars. Never return them in API responses. Never put them in client-side JavaScript (the browser can see everything the frontend bundle contains).
- For production secrets: use the platform's secrets manager (Vercel envs, Fly secrets, AWS Secrets Manager, Doppler). Rotate anything that may have leaked.

---

## 10. Logging and observability

- Use a structured logger (`pino`) — not `console.log` in production.
- Every request gets a request ID (generated or taken from `X-Request-Id`) and it appears in every log line for that request.
- Never log: passwords, tokens, API keys, full credit card numbers, full SSNs. Redact.
- Log enough to debug a production incident at 3am: method, path, status, duration, user id, request id, error stack (server-side only).

---

## 11. Dependencies

- Before adding a dependency, check: is it maintained (commit in last 12 months)? Is it widely used (weekly downloads)? Does it have known CVEs (`npm audit`)?
- Pin versions in `package.json` (no leading `^` or `~` in a production app without a lockfile review policy).
- Run `npm audit` before every release. Address `high` and `critical` advisories or document why they are accepted.

---

## 12. AI-assisted coding specifics (rules for Claude working on this repo)

These are rules for **me** (Claude) when the user asks me to write or modify code here:

1. **I do not claim a task is done until I have mentally walked through the unhappy paths from §4.3 and confirmed they are handled.**
2. **I do not add a new API route without adding its Zod schema and `requireAuth` in the same change.** If the user says "just add the route, we'll add auth later," I push back once and, if the user insists, I add a `// TODO(security): auth required before this ships to users` comment and flag it in my summary.
3. **I do not edit files under `routes/`, `middleware/`, `config.ts`, or anything Stripe-related without re-reading this file first.** These are high-risk areas.
4. **I do not commit to `main`. I create a feature branch and open a PR.**
5. **I read the existing code before adding a new pattern.** If the repo already has a validation helper, an auth middleware, or an error shape, I use it. I do not invent a parallel pattern.
6. **I surface risk explicitly.** If a change I am making has a security or data-integrity implication, I say so in my PR description and in my response to the user, not as a footnote.
7. **I prefer small, reviewable changes.** If the user asks for "everything at once" and the change touches >5 files or >300 lines, I propose splitting it into multiple PRs.

---

## 13. Override syntax (when a rule must be broken)

If the user tells me to skip a rule, I do the following:

1. Restate the rule and the concrete risk of skipping it.
2. Ask for confirmation with exactly this phrasing: *"To confirm: you want me to ship this without <rule>, accepting <specific risk>. Proceed?"*
3. If the user confirms, proceed — and add a code comment at the site of the skip:
   ```
   // RULE-OVERRIDE: <rule name> skipped on 2026-04-18 at user request.
   // Risk accepted: <one-line risk>. Revisit: <follow-up task or date>.
   ```
4. Add a `TODO.md` entry in the repo so the skipped rule surfaces again at review time.

Overrides are never silent. Overrides are never implied. Overrides are always written down.

---

## 14. When in doubt

- Secrets, money, or personal data involved? Assume worse. Ask before acting.
- Rule feels like it's getting in the way? That's usually the rule working. Re-read §0.
- Feature "works but feels wrong"? Walk through §4.3 again.

End of rules.
