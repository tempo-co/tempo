# Tempo API Agent Instructions

NestJS backend for Tempo, a personal-finance app that syncs real bank data through Enable Banking.

## Product direction and workflow

- Tempo is personal-use-first, not a public multi-tenant SaaS. A private self-hosted production deployment exists; do not assume managed cloud services or public SaaS behavior.
- The intended deployment model is a self-hosted 24/7 instance using real bank data fetched through Enable Banking, with access from other devices. Keep that separate from local development and test environments.
- Do not push directly to `main`; use a pull request with passing CI. Use Conventional Commit-style messages such as `feat: ...` and `fix: ...`.
- The adjacent frontend repository is `../tempo-web`; in task descriptions, “frontend” means `tempo-web` and “backend” means this `tempo-api`. For cross-repo work, inspect both repositories and their `AGENTS.md` files.
- CI publishes `ghcr.io/tempo-co/tempo-api:pr-<n>` for every same-repo PR and, after tests pass on `main`, tags that commit's image `:main`, which production deploys. Frontend E2E uses `:main`, or `:pr-<n>` when the web PR body contains `Depends-on: tempo-api#<n>`; coordinate API contract changes with frontend E2E coverage.
- Personal-use-first is not permission for person-specific behavior. Automatic features use general, tested rules over stored transaction evidence, never hidden merchant or account exception lists. Owner actions (category corrections, confirm/dismiss choices) are legitimate inputs.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs, images) are public. Tempo handles real bank data, so none of it may appear there.

- Never put real personal data in code, tests, fixtures, docs, commits, PR descriptions or comments: names, emails, addresses, locations, transaction details (merchants, amounts, dates, references), IBANs or card numbers, host names, IPs or home-directory paths.
- Use obviously fake values: `user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`.
- Build fixtures from scratch; never copy a real payload. Refer to production rows by UUID only.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Read before touching

- `src/app/modules/banking/` (authorization, sync, deletion, identity, own transfers, exchanges, totals): `docs/banking-invariants.md`.
- `src/app/modules/banking/categorization/` or `ops/claude-bridge/`: `docs/categorization.md`.
- Anything calling Enable Banking or Claude, or tests that mock them: `docs/provider-testing.md`.
- E2E setup, seeds, Compose stacks, `NODE_ENV`, image consumers: `docs/e2e-and-seeding.md`.
- `.github/workflows/`, `Dockerfile`, migrations, release tags: `docs/ci-and-images.md`.
- Deploy scripts, host units and staging: `ops/README.md`.
- Local MCP package: `mcp/README.md`.

## Commands

- Setup: Node.js 22.x, Docker Engine 28+, `npm ci`. Development: `npm run start:dev` (starts `docker-compose.dev.yml`, then Nest in watch mode).
- `src/app/core/config/config.schema.ts` is the source of truth for environment variables. Local secrets go in `.env.<env>.local`, never in Git.
- Checks: `npm run lint:check`, `npm run format:check`, `npm run build`. `lint` and `format` rewrite files. Run Prettier only on files you changed; edit Markdown by hand.
- Unit: `npm run test`. E2E: `npm run test:e2e` (serial, recreates the test containers). Bridge: `node --test ops/claude-bridge/*.test.mjs`. MCP: `npm --prefix mcp test`.
- Size local verification to the change: run relevant static checks and focused tests, including regression proof where appropriate. Let PR CI run the full suite on fresh services. Run the full suite locally for cross-cutting changes, gaps in CI, or failures requiring reproduction. A complete passing CI run on the current head is the delivery gate.
- Jest unit tests match `src/**/*.spec.ts`; E2E tests match `test/**/*.e2e.spec.ts`. A spec named any other way (for example `*.spec.ts.ts`, or a `test/` file without `.e2e.`) silently never runs.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Test conventions

- E2E first: prove ownership, cascades, locking, delivery and queue behavior against real PostgreSQL, Redis and Mailpit. Unit tests are for ordering invariants before side effects, fault injection and pure functions over provider payloads; drop mocked wiring tests once E2E covers the property.
- Reuse `test/setup/e2e.setup.ts` (`getApp`, `loginAgent`, `enableAiCategorizationE2e()` at module scope), `test/utils/auth-utils.ts` (`createVerifiedAccount`, `expectValidationMessage`), `test/utils/email-utils.ts` (Mailpit), `scripts/seed-data/banking-fixtures.ts` (`BankingFixtures` with valid defaults; pass only the fields a test depends on) and `test/fixtures/bank-transaction.fixture.ts` for unit tests.
- Use the seeded account dedicated to a flow (`PW_CHANGE`, `PW_RESET`, `EMAIL_CHANGE`, `SESSION_TEST`) when a test changes account data, not the shared `VERIFIED` account. Don't assert on `seedBankingData` contents.
- Route authentication (401, 403 `EMAIL_NOT_VERIFIED`, token-readable routes) is covered once in `test/e2e/auth/auth-guard.e2e.spec.ts`; add new protected routes to its tables.
- Unit tests of services with many dependencies use the named-dependency builders in `banking.service.spec.ts` and `banking-sync.service.spec.ts`, not positional `{} as never` lists. Use `it.each` tables for validation cases.
- A TypeORM `select: false` column is `undefined` on every plain find, so asserting it is `undefined` proves nothing; assert a selected companion column or `addSelect` it.
- Compare database read-backs, not the object `save` returned: `numeric` columns change string scale on the first read.

## Code rules

- No `forwardRef`. When two modules need each other, extract a leaf module around the shared dependency (as `BankingAuthorizationStateModule` does) and delegate to the owning service instead of duplicating its logic.
- When a service moves into `core`, move the smallest shared contract (response type, error code, message constant) down with it; don't leave `core` importing a feature's DTOs or message constants. Keep the HTTP shape and messages unchanged and type-check test files too, since the Nest build (`tsconfig.build.json`) excludes them.
- Use `@core/*` and `@modules/*` across features and relative imports inside one.
- Expected races and refusals use the module's typed error codes (e.g. `BankingAuthorizationStateError('state_superseded')`) or Nest HTTP exceptions with a stated status, never a bare `Error`.
- Every account-owned query includes the owner's account id.
- Bearer-token requests are told apart by `isBearerRequest` both in `session.module.ts` (session middleware skipped) and in `auth.guard.ts`. A new auth path needs the same discriminator at both, or token requests read and refresh sessions.
- Personal access tokens are revoked by revoke-all-other-sessions, password change/reset and account deletion; ordinary logout and single-session revocation keep them. Extend those flow tests when changing either side.
- Queue changes touch the `core/queue` constants/module and the feature processor/service together. Jobs carry ids, never financial payloads.
- Email templates live under `src/app/core/email/templates`; `nest-cli.json` copies them to `dist/`.

## Pitfalls

- `NODE_ENV=test` drops and recreates the schema on every boot (`dropSchema`). Anything seeded before a test-mode API is up gets wiped.
- `npm run test:e2e*` runs `docker compose ... down -v --remove-orphans` on the test project. Never point `.env.test` at a database you care about.
- `npm run db:seed` truncates and recreates the `public` schema. Run it only against a disposable database.
- Compose files use fixed container names and env-interpolated host ports; stale containers or another worktree's stack block startup. Check `docker compose ls --all` before starting or tearing anything down.
- Process environment overrides the env files, so an inherited `NODE_ENV` or `DB_*` silently retargets tests and seeds. Prefix with `NODE_ENV=test` when unsure.
- The runtime image ships no env files and `NODE_ENV=production`; the image smoke check fails the build if an env file appears. tempo-web E2E passes its own synthetic config when it runs the image with `NODE_ENV=test`.
- Changing `ops/claude-bridge/contract.json` changes the fingerprint the bridge checks; an un-reinstalled bridge then refuses every fallback call. See `docs/categorization.md` before editing it.
- `dist/` and `coverage/` are generated.
