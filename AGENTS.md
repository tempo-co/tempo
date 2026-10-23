# Tempo API Agent Instructions

Tempo API is a NestJS backend for personal-finance accounts, authentication, Enable Banking bank connections, synchronized bank accounts, balances, and transactions, base-currency conversion, and spending categorization. It runs on Node.js 22.x and uses PostgreSQL, Redis/BullMQ, Mailpit, and optional Enable Banking and Claude-backed integrations.

## Product direction and workflow

- Tempo is personal-use-first, not a public multi-tenant SaaS. A private self-hosted production deployment exists; do not assume managed cloud services or public SaaS behavior.
- The intended deployment model is a self-hosted 24/7 instance using real bank data fetched through Enable Banking, with access from other devices. Keep that separate from local development and test environments.
- Do not push directly to `main`; use a pull request with passing CI. Use Conventional Commit-style messages such as `feat: ...` and `fix: ...`.
- The adjacent frontend repository is `../tempo-web`; in task descriptions, “frontend” means `tempo-web` and “backend” means this `tempo-api`. For cross-repo work, inspect both repositories and their `AGENTS.md` files.
- CI publishes `ghcr.io/tempo-co/tempo-api:pr-<n>` for every same-repo PR and, after tests pass on `main`, tags that commit's image `:main`, which production deploys. Frontend E2E uses `:main`, or `:pr-<n>` when the web PR body contains `Depends-on: tempo-api#<n>`; coordinate API contract changes with frontend E2E coverage.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs, images) are public. Tempo handles real bank data, so none of it may appear there.

- Never put real personal data in code, tests, fixtures, docs, commits, PR descriptions or comments: names, emails, addresses, locations, transaction details (merchants, amounts, dates, references), IBANs or card numbers, host names, IPs or home-directory paths.
- Use obviously fake values: `user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`.
- Build fixtures from scratch; never copy a real payload. Refer to production rows by UUID only.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Dev environment

- Prerequisites: Node.js 22.x and Docker Engine 28.0.0 or later. Install the locked dependencies with `npm ci`.
- Development: `npm run start:dev`. This starts `docker-compose.dev.yml` with `.env.development`, then starts Nest in watch mode. The stack includes PostgreSQL, Redis, RedisInsight, Mailpit, and pgAdmin; published development and test ports bind only to host loopback, and pgAdmin requires login.
- Development Swagger is at `http://localhost:3000/docs` when `PORT=3000`.
- Configuration is validated by `src/app/core/config/config.schema.ts`. `NODE_ENV` selects `.env.development`, `.env.test`, or `.env.production`; the corresponding `.local` file takes precedence for Nest configuration.
- `src/app/core/config/config.schema.ts` is the source of truth for required and optional environment variables. Use `.env.development` plus `.env.development.local` for local secrets, and keep credentials out of Git.
- Optional AI categorization configuration is `AI_CATEGORIZATION_ENABLED` (default `false`), `AI_CATEGORIZATION_PROVIDER` (`claude` only), `AI_CATEGORIZATION_MODEL` (default `claude-sonnet-5-5`) and `AI_CATEGORIZATION_EFFORT` (default `high`). The subscription bridge accepts only the models and efforts listed in `ops/claude-bridge/contract.json`. Enabled categorization requires `ANTHROPIC_API_KEY`, `AI_CATEGORIZATION_SUBSCRIPTION_SOCKET`, or both. The Anthropic API is tried first, then the local subscription bridge. Keep credentials in the deployment secret/environment path, never in Git.
- `AI_CATEGORIZATION_WEB_SEARCH_ENABLED` (default `false`) enables one merchant search for unresolved results. The search tries the API first, then the subscription bridge, whose hook allows only that one search with the supplied query. Persist actual result provider/model metadata (`claude-api` or `claude-subscription`); when both routes are unavailable, leave rows pending; the categorize job retries after 1, 2, 5, 10 and 20 minutes, then hourly reconciliation takes over, while preserving manual/hash guards and same-input categories.
- Banking configuration: `BANKING_INTEGRATION_ENABLED` (default `true`) gates the Enable Banking integration. When enabled, configure exactly one of `ENABLE_BANKING_PRIVATE_KEY_B64` or `ENABLE_BANKING_PRIVATE_KEY_PATH` alongside the other `ENABLE_BANKING_*` values and `BANKING_SESSION_ENCRYPTION_KEY_B64`. Background sync timing uses `BANKING_SYNC_INTERVAL`, `BANKING_SYNC_DISPATCH_INTERVAL`, and `BANKING_SYNC_RUNNING_TIMEOUT`.

## Build, lint, format, and test

- Size local verification to the change: run relevant static checks and focused tests, including regression proof where appropriate. Let PR CI run the full suite on fresh services. Run the full suite locally for cross-cutting changes, gaps in CI, or failures requiring reproduction. A complete passing CI run on the current head is the delivery gate.

- Build: `npm run build` (clears `dist`, then runs `nest build`).
- CI-equivalent checks: `npm run lint:check` and `npm run format:check`.
- Auto-fixing variants: `npm run lint` and `npm run format` modify files.
- Unit Jest: `npm run test` or `npm run test:cov`.
- E2E Jest: `npm run test:e2e` or `npm run test:e2e:cov`. These first run `npm run docker:test:down`, then `npm run docker:test:up`, clear `dist`, and run `test/jest-e2e.json` serially with `--runInBand`.
- Direct test-container commands are `npm run docker:test:up` and `npm run docker:test:down`.
- Jest unit tests match `src/**/*.spec.ts`; E2E tests match `test/**/*.e2e.spec.ts`. A spec named any other way (for example `*.spec.ts.ts`, or a `test/` file without `.e2e.`) silently never runs. E2E setup creates the Nest app, applies the global validation pipe, and seeds accounts.
- CI runs `npm ci`, lint/format checks, `npm run build`, `npm run test`, and `npm run test:e2e:cov`.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Test helpers

Reuse these instead of re-creating setup inline:

- `test/setup/e2e.setup.ts`: `getApp()`, `loginAgent(httpServer, email, password)`, `getSessionCookie(response)`, and `enableAiCategorizationE2e()` / `enableAiCategorizationWebSearchE2e()` (call at module scope, before the app boots).
- `test/utils/auth-utils.ts`: `createAccountCredentials()`, `createVerifiedAccount(httpServer, mailpitApiUrl)` (signs up, verifies through Mailpit, returns a logged-in agent), and `expectValidationMessage(response, pattern)` for `ValidationPipe` 400s.
- `test/utils/email-utils.ts`: `EmailUtils.getVerificationCode(recipient, apiUrl)` / `getToken(recipient, apiUrl)` fetch and validate a code or token from Mailpit; `findEmailByRecipient` and the `get*EmailBody` builders check full email content.
- `scripts/seed-data/seed.constants.ts`: seeded accounts. Use the one dedicated to a flow when a test changes account data (`PW_CHANGE`, `PW_RESET`, `EMAIL_CHANGE`, `SESSION_TEST`), not the shared `VERIFIED` account. `UNVERIFIED` covers email-verification cases.
- `scripts/seed-data/banking-fixtures.ts`: `new BankingFixtures(app)` persists connections, bank accounts, sync runs, balances, and transactions with valid defaults, including the derived display description; pass only the fields a test depends on. It also exposes the repositories (`fixtures.transactions`, etc.).
- `scripts/seed-data/seed-banking-data.ts`: `seedBankingData(app, {accountEmail})` seeds the full dev dataset (connection, account, sync run, 2 balances, 13 transactions) for one account. It is also used by `npm run db:seed`, so don't assert on its exact contents in specs that need stable data; build those rows with `BankingFixtures`.
- `test/fixtures/bank-transaction.fixture.ts`: `createBankTransaction(overrides)` is an in-memory `BankTransaction` for unit tests. It lives outside `src/` so it stays out of the build.
- Route authentication (401 unauthenticated, 403 `EMAIL_NOT_VERIFIED`) is covered once in `test/e2e/auth/auth-guard.e2e.spec.ts`. Add new protected routes to its tables instead of repeating those checks per spec.
- For unit tests of services with many constructor dependencies, follow the named-dependency builders in `banking.service.spec.ts` and `banking-sync.service.spec.ts` rather than positional `{} as never` lists. Use `it.each` tables for validation cases.

## Layout and conventions

- `src/main.ts` bootstraps the app; `src/app.module.ts` imports global infrastructure from `src/app/core` and features from `src/app/modules`.
- Core modules cover config, database, email, health, pagination, queues, rate limiting, Redis, and sessions. Feature modules are `account`, `auth`, and `banking`.
- Feature controllers and most DTOs live under `api/` (or `api/dtos/`); entities and the main feature service live at the feature root. In `banking`, supporting services, processors, and the Enable Banking client live under `services/`, and AI categorization lives under `categorization/` with provider implementations in `categorization/providers/`. Shared banking helpers belong in `banking.utils.ts`.
- Use the observed aliases `@core/*` and `@modules/*` for cross-feature imports; use relative imports inside a feature. The import sorter groups third-party imports, aliases, then relative imports with blank-line separation.
- TypeScript uses tabs, 4-space tab width, single quotes, trailing commas, LF endings, and a 120-column print width. Prettier also sorts imports and specifiers.
- DTOs use `class-validator`; the app applies `ValidationPipe({whitelist: true, transform: true})`. Entities use TypeORM decorators and `class-transformer` `@Expose`/`@Exclude` for response serialization.
- Services use injected TypeORM repositories and Nest HTTP exceptions (`NotFoundException`, `ConflictException`, `UnauthorizedException`, `BadRequestException`, or `UnprocessableEntityException`) for validated failure paths. Account-owned queries include the account ID.
- BullMQ processors handle background work: email delivery, bank connection sync, transaction categorization, and base-currency amount conversion. Add or change queue behavior in the relevant `core/queue` constants/module and feature processor/service together.
- For external integrations, prefer E2E/integration coverage against the local Docker services over mocks.

## Pitfalls

- Test mode configures TypeORM with `dropSchema: true`; E2E setup seeds accounts before tests. `.env.test` must satisfy the full config schema and its host ports must be free. The runtime image ships no env files (the image smoke check fails the build if one appears); tempo-web E2E passes its own synthetic config when it runs the image with `NODE_ENV=test`.
- `npm run test:e2e*` deliberately removes test containers/volumes via `docker compose ... down -v --remove-orphans`. Do not point `.env.test` at a development database.
- `npm run db:seed` truncates and recreates the PostgreSQL `public` schema before seeding; run it only against the intended database.
- Compose uses fixed container names and environment-interpolated host ports, so stale containers or overlapping ports can block startup.
- `dist/` and `coverage/` are generated. Email `.hbs` files belong under `src/app/core/email/templates`; Nest copies them to `dist/src` via `nest-cli.json`.
