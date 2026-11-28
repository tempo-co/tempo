# Wisp API Agent Instructions

Paths are relative to `apps/api` unless they start at the repository root.

## Read before touching

- `src/app/modules/banking/` and `src/app/modules/notifications/`: `docs/banking-invariants.md`. Code that writes derived values (categories, own transfers, exchanges, recurring series, merchant keys): `docs/derived-data-writes.md`.
- The reporting currency and amount conversion (`src/app/modules/banking/services/reporting-currency.service.ts`, `src/app/modules/banking/services/bank-transaction-amount-conversion.service.ts`): `docs/reporting-currency.md`.
- `src/app/modules/file-import/`, and sync's handling of imported rows (`src/app/modules/banking/sync-sweep.ts`, the takeover in `src/app/modules/banking/services/bank-transaction-persistence.service.ts`): `docs/file-import.md`.
- `src/app/modules/banking/categorization/`: `docs/categorization.md`.
- `src/app/modules/banking/bank-logos/`: `docs/bank-logos.md`.
- `src/app/modules/banking/merchant-logos/`: `docs/merchant-logos.md`. Logos are for display and merchant spending totals only: categories, merchant keys and recurring payments never read them.
- `src/app/modules/auth/`, `src/app/core/session/` and `src/app/core/personal-access-token/`: `docs/auth-and-sessions.md`.
- Anything calling Enable Banking or Claude, or tests that mock them: `docs/provider-testing.md`.
- E2E setup, test helpers, seeds, Compose stacks, `NODE_ENV`, image consumers: `docs/e2e-and-seeding.md`.
- `Dockerfile`, migrations: `docs/migrations-and-image.md`. Deploy scripts, host units and staging: root `ops/README.md`.
- `src/app/modules/banking/mcp/` and the hosted MCP endpoint: `docs/mcp.md`.

## Commands and traps

- `lint` and `format` rewrite files. Run Prettier only on files you changed; edit Markdown by hand.
- Jest unit tests match `src/**/*.spec.ts` and E2E tests `test/**/*.e2e.spec.ts`; a spec named any other way silently never runs; the real-file corpus check `test/corpus/*.spec.ts` runs only through `npm run test:corpus` (`docs/real-file-corpus.md`). Run known unit files with `npx jest --runTestsByPath <file> --runInBand` and E2E files with `npm run test:e2e -- --runTestsByPath <file>`: a plain path pattern is a regex over absolute paths, so a word in the worktree path can select the whole suite.
- `npm run test:e2e*` gives each checkout its own Compose stack on Docker-assigned ports and removes it when Jest exits, so worktrees run in parallel; two runs in one checkout still share it. Each spec file's boot drops the test schema, so never point `.env.test` at a database you care about.
- `npm run db:seed` truncates and recreates the `public` schema: run it only against a disposable database.
- The `input` sections of `src/app/modules/banking/categorization/providers/claude-categorization-contract.json` are generated (`npm run contract:input`); see `docs/categorization.md` before editing it.

## Tests

- E2E first: prove ownership, cascades, locking, delivery and queue behavior against real PostgreSQL, Redis and Mailpit. Unit tests are for ordering invariants before side effects, fault injection and pure functions over provider payloads; drop mocked wiring tests once E2E covers the property.
- Route authentication (401, 403 `EMAIL_NOT_VERIFIED`, token-readable routes) is covered once in `test/e2e/auth/auth-guard.e2e.spec.ts`; add new protected routes to its tables.
- Unit tests of services with many dependencies use named-dependency builders, not positional `{} as never` lists. Use `it.each` tables for validation cases.
- A TypeORM `select: false` column is `undefined` on every plain find, so asserting it is `undefined` proves nothing; assert a selected companion column or `addSelect` it.
- Compare database read-backs, not the object `save` returned: `numeric` columns change string scale on the first read.
- Dates a test compares with the run date (sync windows, "more than N days back") derive from it: `addDays(dateInAppTimeZone(new Date()), -n)`. A fixed date passes until the calendar reaches it, then fails every PR at once.
- Mocked provider replies answer by the account or request they belong to, not by call order: rows saved together share a `createdAt`, so a read ordered by it alone can return them in either order.

## Code rules

- No `forwardRef`. When two modules need each other, extract a leaf module around the shared dependency (as `BankingAuthorizationStateModule` does) and delegate to the owning service instead of duplicating its logic.
- When a service moves into `core`, move the smallest shared contract (response type, error code, message constant) down with it, and type-check the test files too: the Nest build (`tsconfig.build.json`) excludes them.
- Use `@core/*` and `@modules/*` across features and relative imports inside one.
- HTTP request and response shapes come from `@wisp/contracts` (root `packages/contracts`). Controllers declare return types with them, request DTO classes keep their validators and `implements` the contract type, and response shapes are not redefined in the API. Rerun `npm run contracts:build` after editing the package; type-check with `npm run typecheck`, which rebuilds it first and includes the test files.
- Expected races and refusals use the module's typed error codes (e.g. `BankingAuthorizationStateError('state_superseded')`) or Nest HTTP exceptions with a stated status, never a bare `Error`.
- Every account-owned query includes the user's account id.
- Queue changes touch the `src/app/core/queue/` constants/module and the feature processor/service together. Jobs carry ids, never financial payloads.
