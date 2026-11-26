# E2E environments and seeding

## Environment selection

- `NODE_ENV` picks the env files (`src/app/core/config/config.module.ts`): `.env.<env>.local` first, then `.env.<env>`. Variables already in the process environment win over both, so an inherited `NODE_ENV=production` or exported `DB_*`/`ENABLE_BANKING_*` values silently retarget jest, `db:seed` or `build`. Prefix test commands with `NODE_ENV=test` when the shell may carry other values, and never `export` a one-off env file into a long-lived shell.
- `test/setup/e2e.setup.ts` sets `NODE_ENV=test` and the AI flags before importing `AppModule`.

## Schema behavior per environment

From `src/app/core/database/database.module.ts`:

| `NODE_ENV` | Schema |
|---|---|
| `test` | `dropSchema: true` on every boot, then synchronize from entities |
| `development` | synchronize when `DB_SYNCHRONIZE=true`, no drop |
| `production` | migrations only (`migrationsRun`), never synchronize |

Consequences:

- Anything seeded before a `NODE_ENV=test` API finishes booting is wiped. Seeds for a long-lived test API must run after it reports healthy, and data must be rechecked after boot. The symptom is every seeded login failing with 401 while the seed itself logged success.
- For a long-lived API used by browser tests against a disposable database, seed first and then run the API in development mode with `DB_SYNCHRONIZE=true`; never point that at real data.
- `npm run db:seed` truncates and recreates `public` before seeding; `db:schema` creates tables from entities without data. Production has no baseline migration, so a fresh production database needs `node dist/scripts/schema.js` first.
- Synchronize creates tables and indexes, not triggers or SQL functions. A migration that installs anything beyond entities must be safe to rerun, return early while its tables do not exist (a fresh production database runs migrations before `dist/scripts/schema.js` synchronizes), and be listed in `SCHEMA_EXTRA_MIGRATIONS` (`src/app/core/database/synchronized-schema-extras.ts`). `installSchemaExtras` runs that list after every synchronize: at boot when the schema is synchronized, and in `db:schema` and `db:seed`. Otherwise tests pass on a schema production does not have.

## Disposable stacks

`npm run test:e2e*` runs Jest through `scripts/e2e-stack.mjs`. It starts `docker-compose.test.yml` as a project named after the checkout's path (`tempo-api-test-<hash>`, printed as `E2E stack: ...`), lets Docker pick free host ports on `127.0.0.1`, passes them to Jest as `DB_PORT`, `REDIS_URL`, `EMAIL_PORT` and `EMAIL_UI_PORT` (these win over `.env.test` and `.env.test.local`), and removes the stack with `down -v` when Jest exits, fails or is interrupted. Each worktree therefore has its own database, and runs in different worktrees do not interfere; two runs in the same checkout still share one project. Before the contracts build and the stack, `npm run test:e2e*` runs `scripts/check-installed.mjs`, which compares each package in `package-lock.json` with `node_modules` (leaving out the linked contracts package and optional packages npm skipped on this platform) and stops with the names that differ (run `npm ci` in `apps/api`), so a checkout with stale packages fails at once rather than after the stack boots.

- Run single files through the stack: `npm run test:e2e -- --runTestsByPath <file>`. A bare `npx jest` on an E2E spec has no stack to reach.
- `docker-compose.dev.yml` uses fixed container names (`postgres`, `redis`, `mailpit`, ...) and env-interpolated host ports. Web E2E (`apps/web/docker-compose.e2e.yml`, project `tempo-web`) publishes fixed ports 5432, 6379, 1025, 8025 and 3000, so only one web E2E stack runs per host.
- For any other parallel stack (a host-run API for browser tests), use a unique project name and host ports through a temporary override file kept outside the repo (`ports: !override`). Override `REDIS_URL` as well as `REDIS_PORT`: the app and BullMQ read only `REDIS_URL` (`src/app/core/redis/redis.module.ts`, `src/app/core/queue/queue.module.ts`). The Mailpit helper derives its URL from `EMAIL_UI_PORT` (`test/utils/email-utils.ts`).
- Host-run processes reach Compose services through `127.0.0.1` and the published ports; service names resolve only inside the Compose network. Set host-facing values after sourcing every env file, since a `.local` file can replace them.
- Repeated auth setup can exhaust the login rate limit or leave sessions behind; reset only the disposable Redis (`FLUSHDB` on that container) or wait for the TTL.
- A "started" log line proves only that bootstrap happened once. Before reporting a background API live, check the PID, the listener and `GET /health`.
- Before tearing anything down, check `docker compose ls --all`; never run `down` on a project you did not start.

## Seeded data

- API E2E setup boots the application and runs `seedAccounts` for each spec file. It does not load the full banking dataset: create the rows a spec depends on with `BankingFixtures`.
- `scripts/seed-data/seed.constants.ts` holds the synthetic accounts. Tests that change account data use the account dedicated to that flow, not the shared `VERIFIED` one; scenarios that need their own banking totals use an isolated user.
- `npm run db:seed` and API-backed web E2E run the full seed: accounts, banking, own transfers and recurring payments. `apps/web/test/auth.setup.ts` in the web app only logs those accounts in and saves their sessions; it does not seed.
- `seedBankingData` is a full synthetic dataset with fixed row IDs, not a repeatable per-user fixture factory. Do not make feature assertions depend on its exact contents. Account-deletion E2E uses it to exercise cascades through populated relationships.
- Data a test counts as a whole goes under its own user (see `scripts/seed-data/seed-own-transfer-data.ts` and `scripts/seed-data/seed-recurring-data.ts`), so default pagination fixtures keep their counts.

## Reusing test setup

- `test/setup/e2e.setup.ts`: `getApp`, `loginAgent`, and `enableAiCategorizationE2e()`, `enableMerchantLogosE2e()` or `enableOperatorAlertsE2e()` at module scope. `test/utils/wait-utils.ts`: `waitFor` until background workers finish, and `lockWaits`, how many test database sessions wait on a lock, for a race that must reach a lock first. `test/utils/auth-utils.ts`: `createVerifiedAccount`, `expectValidationMessage`. `test/utils/email-utils.ts`: Mailpit reads, taken once the email queue has no pending jobs, so an absent email is really absent; a wait past 1 s logs the jobs still pending.
- Use `BankingFixtures` (`scripts/seed-data/banking-fixtures.ts`, valid defaults; pass only the fields a test depends on) for persisted connections, accounts and transactions. Use `test/fixtures/bank-transaction.fixture.ts` for an in-memory entity in unit tests; it does not set up database relationships or replace persisted fixtures.
- Use `test/utils/banking-utils.ts` to create an isolated user with real signup, verification and login, plus one connection and an empty bank account. Pass the base currency explicitly and keep scenario rows local:

```ts
import {createBankingOwner} from '../../utils/banking-utils';

const {agent, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
await fixtures.createTransactions(bankAccount, [bookedRow('2026-09-10', '-12.00')]);
const response = await agent.get('/bank-transactions').expect(200);
```

- Share repeated setup mechanics and required record fields, not the inputs and assertions that explain a scenario. Keep dates, amounts, category states and ownership explicit when the behavior depends on them.
- Keep a helper in its spec when only that spec uses it. Move it into `test/utils` or `test/fixtures` when multiple specs need the same contract; do not build generic repository or provider mocks around unrelated tests.
- Split a spec along feature boundaries only when the resulting setup is clearer. Each API E2E file boots its own application and schema, so splitting is not a test-speed optimization.

## Web E2E against this API

Web E2E (`apps/web`) runs an API image and seeds it inside the container. In CI that image is built from the same commit whenever the change touches `apps/api`, so a seed or route change here reaches web E2E in the same PR.

- If only the changed feature fails in web E2E while auth and unrelated pages pass, check the image first: inspect `dist` in the pulled image for the route, field or seed marker. A missing route is version skew; never weaken web assertions to match an older API.
- The runtime image ships no env files (`scripts/runtime-image-smoke.js` fails the build if one appears). Consumers that run it with `NODE_ENV=test` pass their own synthetic config; before dropping a file or default from the image, grep `apps/web/docker-compose.e2e.yml` and `.github/workflows/ci.yml` for what they rely on.

## Timeouts

- `test/setup/e2e.setup.ts` gives app boot 60 s because a cold CI runner exceeds Jest's 5 s default. If CI repeats an identical mass failure in one spec, grep the log for `Exceeded timeout of 5000 ms for a hook` before calling it a flake.
- Specs that wait for several email deliveries raise their own timeout (`test/e2e/banking/bank-connection-alerts.e2e.spec.ts`). Do not shorten a mail helper's polling window to fit a default timeout.
- When Supertest requests overlap (concurrency or latency tests), bind the app's HTTP server to an ephemeral loopback port for the test and close it afterwards; otherwise Supertest starts and closes a listener per request and overlapping calls fail with `ECONNRESET`.
