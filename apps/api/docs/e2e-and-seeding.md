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
- Synchronize creates tables and indexes, not triggers or SQL functions. Anything a migration installs beyond entities must also be installed for synchronized schemas, or tests pass on a schema production does not have.

## Disposable stacks

`docker-compose.test.yml` uses fixed container names (`postgres_test`, `redis_test`, `mailpit_test`), and `docker-compose.dev.yml` uses its own (`postgres`, `redis`, `mailpit`, ...); both use env-interpolated host ports. `npm run test:e2e*` runs `docker compose -p tempo-api-test ... down -v` first.

- Before starting or tearing down, check `docker compose ls --all`, container names and listening ports. Never run `down` on a project you did not start.
- For a parallel stack (another worktree, a host-run API for browser tests), use a unique project name, container names and host ports through a temporary override file kept outside the repo (`ports: !override`). A unique project name alone does not prevent port or container-name collisions.
- Host-run processes reach Compose services through `127.0.0.1` and the published ports; service names resolve only inside the Compose network. Set host-facing values after sourcing every env file, since a `.local` file can replace them.
- Repeated auth setup can exhaust the login rate limit or leave sessions behind; reset only the disposable Redis (`FLUSHDB` on that container) or wait for the TTL.
- A "started" log line proves only that bootstrap happened once. Before reporting a background API live, check the PID, the listener and `GET /health`.
- Tear down only your own project, remove generated auth state and confirm the ports are free.

## Seeded data

- `scripts/seed-data/seed.constants.ts` holds the synthetic accounts. Tests that change account data use the account dedicated to that flow, not the shared `VERIFIED` one.
- `seedBankingData` builds the full dev dataset and backs `npm run db:seed`; do not assert its exact contents. Build rows a spec depends on with `BankingFixtures`.
- Data a test counts as a whole goes under its own seeded owner (see `seed-own-transfer-data.ts`), so default pagination fixtures keep their counts.
- Fixture text must be synthetic and must not be derived from real merchants, names or places.

## Web E2E against this API

Web E2E (`apps/web`) runs an API image and seeds it inside the container. In CI that image is built from the same commit whenever the change touches `apps/api`, so a seed or route change here reaches web E2E in the same PR.

- If only the changed feature fails in web E2E while auth and unrelated pages pass, check the image first: inspect `dist` in the pulled image for the route, field or seed marker. A missing route is version skew; never weaken web assertions to match an older API.
- To run the web suite locally against this checkout's API, build an image from `apps/api` and set `TEMPO_API_E2E_IMAGE` to it.
- The runtime image ships no env files (`scripts/runtime-image-smoke.js` fails the build if one appears). Consumers that run it with `NODE_ENV=test` pass their own synthetic config; before dropping a file or default from the image, grep `apps/web/docker-compose.e2e.yml` and `.github/workflows/ci.yml` for what they rely on.

## Timeouts

- `e2e.setup.ts` gives app boot 60 s because a cold CI runner exceeds Jest's 5 s default. If CI repeats an identical mass failure in one spec, grep the log for `Exceeded timeout of 5000 ms for a hook` before calling it a flake.
- Specs that wait for several email deliveries raise their own timeout (`bank-connection-alerts.e2e.spec.ts`). Do not shorten a mail helper's polling window to fit a default timeout.
- When Supertest requests overlap (concurrency or latency tests), bind the app's HTTP server to an ephemeral loopback port for the test and close it afterwards; otherwise Supertest starts and closes a listener per request and overlapping calls fail with `ECONNRESET`.
