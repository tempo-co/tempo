# Tempo API Agent Instructions

NestJS backend for Tempo, a personal-finance app that syncs real bank data through Enable Banking. Paths below are relative to `apps/api` unless they start at the repository root. Repo-wide rules (product direction, workflow, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- `src/app/modules/banking/` (authorization, sync, deletion, identity, own transfers, exchanges, totals): `docs/banking-invariants.md`.
- `src/app/modules/banking/categorization/` or `claude-bridge/`: `docs/categorization.md`.
- `src/app/modules/banking/merchant-logos/` (identification, icon choice, brand trust rules, site fetcher, image route): `docs/merchant-logos.md`. Display only: categories, merchant keys and recurring payments never read it.
- Anything calling Enable Banking or Claude, or tests that mock them: `docs/provider-testing.md`.
- E2E setup, seeds, Compose stacks, `NODE_ENV`, image consumers: `docs/e2e-and-seeding.md`.
- `Dockerfile`, migrations: `docs/migrations-and-image.md`. CI workflows and release tags: root `docs/ci-and-images.md`.
- Deploy scripts, host units and staging: root `ops/README.md`.
- Local MCP package: `mcp/README.md`.

## Commands

- Setup: Node.js 26.x, Docker Engine 28+, `npm ci`. Development: `npm run start:dev` (starts `docker-compose.dev.yml`, then Nest in watch mode).
- `src/app/core/config/config.schema.ts` is the source of truth for environment variables. Local secrets go in `.env.<env>.local`, never in Git.
- Checks: `npm run lint:check`, `npm run format:check`, `npm run build`. `lint` and `format` rewrite files. Run Prettier only on files you changed; edit Markdown by hand.
- Unit: `npm run test`. E2E: `npm run test:e2e` (serial, recreates the test containers). Bridge: `node --test claude-bridge/*.test.mjs`. MCP: `npm --prefix mcp test`.
- CI publishes `ghcr.io/tempo-co/api:pr-<n>` for every same-repo PR that changes `apps/api` and, after tests pass on `main`, tags that commit's image `:main`, which production deploys. The same run's web E2E uses that image, so an API contract change needs web E2E coverage in the same PR.
- Jest unit tests match `src/**/*.spec.ts`; E2E tests match `test/**/*.e2e.spec.ts`. A spec named any other way (for example `*.spec.ts.ts`, or a `test/` file without `.e2e.`) silently never runs.

## Test conventions

- E2E first: prove ownership, cascades, locking, delivery and queue behavior against real PostgreSQL, Redis and Mailpit. Unit tests are for ordering invariants before side effects, fault injection and pure functions over provider payloads; drop mocked wiring tests once E2E covers the property.
- Reuse `test/setup/e2e.setup.ts` (`getApp`, `loginAgent`, `enableAiCategorizationE2e()` or `enableMerchantLogosE2e()` at module scope), `test/utils/wait-utils.ts` (`waitFor` until background workers finish), `test/utils/auth-utils.ts` (`createVerifiedAccount`, `expectValidationMessage`), `test/utils/email-utils.ts` (Mailpit), `scripts/seed-data/banking-fixtures.ts` (`BankingFixtures` with valid defaults; pass only the fields a test depends on) and `test/fixtures/bank-transaction.fixture.ts` for unit tests.
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
- The runtime image ships no env files and `NODE_ENV=production`; the image smoke check fails the build if an env file appears. Web E2E (`apps/web/docker-compose.e2e.yml`) passes its own synthetic config when it runs the image with `NODE_ENV=test`.
- Changing `claude-bridge/contract.json` changes the fingerprint the bridge checks; an un-reinstalled bridge then refuses every fallback call. See `docs/categorization.md` before editing it.
- `dist/` and `coverage/` are generated.
