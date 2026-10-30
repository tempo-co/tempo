# Tempo Web Agent Instructions

React 19 + TypeScript SPA (Vite, TanStack Router/Query, Tailwind with shadcn-style Radix wrappers, Playwright E2E). `package.json`, `vite.config.ts`, `playwright.config.ts` and the root `.github/workflows/ci.yml` are authoritative; when `README.md` differs, trust them. Paths below are relative to `apps/web` unless they start at the repository root. Repo-wide rules (product direction, workflow, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- `docs/browser-and-e2e-testing.md`: before writing or running Playwright specs, mocking routes, testing dialogs, drawers, dates or search limits.
- `docs/env-boundaries.md`: before changing `VITE_*` values, `NODE_ENV`, `docker-compose.e2e.yml`, the API image, Nginx or `Dockerfile.production`, or when local E2E setup fails.
- `docs/frontend-conventions.md`: before changing feedback/toasts, destructive styles, phone layouts, settings lists, copy or `src/components/ui`.
- `docs/pwa.md`: before changing the manifest, icons, base path or offline shell.
- `DESIGN.md`: palette, typography and component tokens. `PRODUCT.md`: product scope.

## Verification

- Prefer integration/E2E coverage against local services over mocks when testing external integrations.
- E2E runs against `ghcr.io/tempo-co/api:main` by default; `TEMPO_API_E2E_IMAGE` points the stack at another API image, such as a local build of `apps/api`. In CI it runs against the API image built in the same run when the change touches `apps/api` or `packages/contracts`, otherwise against API `:main`.
- Fresh worktree: `npm ci`, then `npx playwright install chromium webkit --with-deps` (as CI does) before any spec runs. Production and staging serve the app at `/`.
- Static checks: `npm run lint:check`, `npm run format:check`, `npm run build`. `npm run lint` and `npm run format` modify files.
- There is no unit-test runner; all tests are Playwright specs under `test/`. Find the specs for a change by grepping `test/e2e` for the route, component or label; `--only-changed` finds nothing because specs do not import `src`.
- `npm run test:e2e:local` resets the Docker services (`down -v`), starts them, seeds, and runs the whole suite. Fully mocked specs run without Docker; see `docs/browser-and-e2e-testing.md`.
- Every local worktree shares one E2E stack (`api` on `localhost:3000`), so a reset or a full run from one agent corrupts another's run. Locally, run only the specs for your change, and only when `pgrep -af 'playwright test'` shows no other run; push and let CI run the full suite, since each shard gets its own stack.
- CI runs lint/format, build (plus `scripts/tempo-web-security-headers-test.sh`) and eight E2E shards (every spec in Chromium and WebKit; Chromium only when the change touches `apps/api` but not `apps/web`). `Web E2E tests`, and with it the required `CI` check, fails unless every shard passes.

## Traps

- `src/routeTree.gen.ts` is generated and ignored by Git. Run `npm run generate-routes` (or any `dev`/`build`) in a fresh clone or worktree before `lint:check`, and after adding, renaming or deleting a route. A missing or stale tree shows up as dozens of `no-unsafe-*` or implicit-`any` errors in untouched files, not a regression.
- `.env.*` is ignored, so a fresh worktree has no `VITE_*` values. Pass CI's values inline for the process (`VITE_API_URL=http://localhost:3000 VITE_APP_URL=http://localhost:5173 VITE_EMAIL_UI_URL=http://localhost:8025`); do not create or edit env files for a run.
- Leave `NODE_ENV` unset for builds and Playwright. `NODE_ENV=test` during `vite build` turns off the service worker and turns on dev-only code in the preview build. Gate dev-only code on `import.meta.env.MODE === 'development'` or an explicit `VITE_*` flag, never on `import.meta.env.DEV`.
- Playwright reuses any server already on `VITE_APP_URL` locally (`reuseExistingServer`). Another worktree's preview on port 5173 means you are testing the wrong build; check the listener first.
- `docker-compose.e2e.yml` has fixed container names and host ports (1025, 8025, 6379, 5432, 3000). Check for other stacks before `docker:test:up`; `docker:test:down` deletes volumes.
- The E2E API drops its schema on boot (`NODE_ENV=test`). Seed only after it is healthy; a full local run changes seeded accounts, so reset the stack before rerunning.
- A web change that needs an API change is tested in CI when both are in the same PR. Locally, point `TEMPO_API_E2E_IMAGE` at an image built from `apps/api`; a stack on API `:main` lacks the change. Never weaken assertions to match an older API.
- `scripts/tempo-web-security-headers-test.sh` builds the production image and probes the SPA and the API proxy (needs Docker). Update it with any change to `nginx/`.
- CI publishes `ghcr.io/tempo-co/web:pr-<n>` for same-repo PRs and retags the tested image as `:main` after `main` passes. `:main` is what production deploys, so a merge to `main` ships.

## E2E test helpers

Reuse these instead of re-creating setup inline:

- `test/fixtures.ts`: import `test` and `expect` from here instead of `@playwright/test`. It provides the page objects as fixtures (`loginPage`, `homePage`, `signupPage`, `verifyEmailPage`, `verifyEmailChangePage`, `resetPasswordPage`, `accountSettingsPage`, `securitySettingsPage`, `appearanceSettingsPage`), plus:
  - `freshAccount`: a new verified account with no bank data, with the test's browser context logged in as it.
  - `createVerifiedAccount(request)`: the same account without logging in, for tests that log in through the UI.
- Shared seeded data: tests that change account data or depend on an account having no bank data use `freshAccount` rather than a seeded account, so they do not depend on test order and stay safe to retry. Do not change seeded data another test reads.
- `test/utils/api-mocks.ts`: `mockBankConnections`, `transformBankConnections` and `routeBankConnectionsApi` intercept the `GET /bank-connections` API call while letting navigations to `/bank-connections` through. `mockJson` and `fulfillJson` answer other routes with JSON. `mockEmptyHome` answers Home's card requests with empty data; fully mocked specs get it and `mockBankConnections(page, [])` by default from `test/fixtures.ts`.
- `test/utils/layout.ts`: `boxOf(locator)` returns a rendered element's bounding box, and `expectNoHorizontalOverflow(page)` checks for horizontal scrolling.
- `test/utils/url.ts`: `withSearchParams(path, params)` builds URLs for the invalid-search-param cases in `test/data`.
- `test/utils/email-utils.ts`: `EmailUtils.getVerificationCode(email)` reads a verification code from Mailpit; `ResetPasswordPage.openResetLink(email)` requests a reset and opens the emailed link.
- `test/utils/hook-harness.ts`: `createHookHarness(stubs)` runs a real hook against a real `QueryClient` with whole modules stubbed. Add every new named import a hook uses from a stubbed module to the stubs.
- Fully mocked specs declare `test.use({storageState: {cookies: [], origins: []}})`.
- Write repeated validation cases as a `for` loop over a table of cases.

## Code conventions not enforced by tooling

- Feature code lives in `src/features/<feature>/{api,components,types,utils}`; shared code in `src/components/shared`, `src/hooks`, `src/providers`, `src/types`, `src/utils`; primitives in `src/components/ui`. Import `src` through the `@/` alias.
- Filenames are kebab-case; hooks export `useX` from `use-x.ts`. DTO files in feature `types` directories define a Zod schema and infer the exported type from it.
- API request and response types and the fixed value lists they use come from `@tempo/contracts` (root `packages/contracts`); pass them to `api.get<T>()` and check request bodies with `satisfies`. Don't redefine them in `src`. Labels and other UI copy for those values stay in the feature's `types` or `utils`.
- JSON API hooks use the `api` wrapper in `src/utils/api.ts` with TanStack Query; it sends cookies, maps failures to `HttpError` and owns the shared auth/network toasts and redirects. Mutations never retry or queue for replay (`src/query-client.ts`).
- Use `cn` from `src/utils/cn.ts` to merge Tailwind classes.
- Prettier covers `src/**/*.{js,jsx,ts,tsx}` only; edit `src/index.css` and Markdown by hand.
- Living docs (`DESIGN.md`, `PRODUCT.md`, `README.md`, `docs/`) state current durable facts: no dates, decision history or rename narration. No em dashes in the README.
