# Tempo Web Agent Instructions

React 19 + TypeScript SPA (Vite, TanStack Router/Query, Tailwind with shadcn-style Radix wrappers, Playwright E2E). `package.json`, `vite.config.ts`, `playwright.config.ts` and `.github/workflows/ci.yml` are authoritative; when `README.md` differs, trust them.

## Read before touching

- `docs/browser-and-e2e-testing.md`: before writing or running Playwright specs, mocking routes, testing dialogs, drawers, dates or search limits.
- `docs/env-boundaries.md`: before changing `VITE_*` values, `NODE_ENV`, `docker-compose.e2e.yml`, the API image, Nginx or `Dockerfile.production`, or when local E2E setup fails.
- `docs/frontend-conventions.md`: before changing feedback/toasts, destructive styles, phone layouts, settings lists, copy or `src/components/ui`.
- `docs/pwa.md`: before changing the manifest, icons, base path or offline shell.
- `DESIGN.md`: palette, typography and component tokens. `PRODUCT.md`: product scope.

## Product direction and cross-repo workflow

- Tempo is personal-use-first, not a public multi-tenant SaaS. A private self-hosted production deployment exists; do not assume managed cloud services or public SaaS behavior.
- The intended deployment model is a self-hosted 24/7 instance with real bank data from Enable Banking and access from other devices. Keep that separate from local development and test environments.
- Do not push directly to `main`; use a pull request with passing CI. Use Conventional Commit-style messages such as `feat: ...` and `fix: ...`.
- The adjacent backend repository is `../tempo-api`; in task descriptions, “frontend” means this `tempo-web` repo and “backend” means `tempo-api`. For cross-repo work, inspect both repositories and their `AGENTS.md` files.
- Frontend E2E runs against `ghcr.io/tempo-co/tempo-api:main` by default; `TEMPO_API_E2E_IMAGE` can point the stack at a different API image. In CI, a web PR whose body contains a line `Depends-on: tempo-api#<n>` runs E2E against that open API PR's `pr-<n>` image (published for same-repo, non-Dependabot API PRs); a merged or closed API PR falls back to `main`, which includes the change once the API main release job has finished. Editing the PR body reruns CI; pushing to the API PR does not, so rerun the web E2E job after the API PR's Image job finishes.
- Prefer integration/E2E coverage against local services over mocks when testing external integrations.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs, images) are public. Tempo handles real bank data, so none of it may appear there.

- Never put real personal data in code, tests, fixtures, docs, commits, PR descriptions or comments: names, emails, addresses, locations, transaction details (merchants, amounts, dates, references), IBANs or card numbers, host names, IPs or home-directory paths.
- Use obviously fake values: `user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`.
- Build fixtures from scratch; never copy a real payload. Refer to production rows by UUID only.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Verification

- Size local verification to the change: run relevant static checks and focused tests, including regression proof where appropriate. Let PR CI run the full suite on fresh services. Run the full suite locally for cross-cutting changes, gaps in CI, or failures requiring reproduction. A complete passing CI run on the current head is the delivery gate.
- Fresh worktree: `npm ci`, then `npx playwright install chromium --with-deps` (as CI does) before any spec runs. Production and staging serve the app at `/`.
- Static checks: `npm run lint:check`, `npm run format:check`, `npm run build`. `npm run lint` and `npm run format` modify files.
- There is no unit-test runner; all tests are Playwright specs under `test/`. Find the specs for a change by grepping `test/e2e` for the route, component or label; `--only-changed` finds nothing because specs do not import `src`.
- `npm run test:e2e:local` resets the Docker services (`down -v`), starts them, seeds, and runs the whole suite. Fully mocked specs run without Docker; see `docs/browser-and-e2e-testing.md`.
- CI runs lint/format, build (plus `ops/tests/tempo-web-security-headers-test.sh`) and four E2E shards; the required `E2E Tests` job fails unless every shard passes.

## Traps

- `src/routeTree.gen.ts` is generated and ignored by Git. Run `npm run generate-routes` (or any `dev`/`build`) in a fresh clone or worktree before `lint:check`, and after adding, renaming or deleting a route. A missing or stale tree shows up as dozens of `no-unsafe-*` or implicit-`any` errors in untouched files, not a regression.
- `.env.*` is ignored, so a fresh worktree has no `VITE_*` values. Pass CI's values inline for the process (`VITE_API_URL=http://localhost:3000 VITE_APP_URL=http://localhost:5173 VITE_EMAIL_UI_URL=http://localhost:8025`); do not create or edit env files for a run.
- Leave `NODE_ENV` unset for builds and Playwright. `NODE_ENV=test` during `vite build` turns off the service worker and turns on dev-only code in the preview build. Gate dev-only code on `import.meta.env.MODE === 'development'` or an explicit `VITE_*` flag, never on `import.meta.env.DEV`.
- Playwright reuses any server already on `VITE_APP_URL` locally (`reuseExistingServer`). Another worktree's preview on port 5173 means you are testing the wrong build; check the listener first.
- `docker-compose.e2e.yml` has fixed container names and host ports (1025, 8025, 6379, 5432, 3000). Check for other stacks before `docker:test:up`; `docker:test:down` deletes volumes.
- The E2E API drops its schema on boot (`NODE_ENV=test`). Seed only after it is healthy; a full local run changes seeded accounts, so reset the stack before rerunning.
- A web change that needs an unmerged API change is only tested when `TEMPO_API_E2E_IMAGE` (locally) or `Depends-on:` (CI) selects an image containing it. A missing image is version skew: wait for it; never weaken assertions.
- `ops/tests/tempo-web-security-headers-test.sh` builds the production image and probes the SPA and the API proxy (needs Docker). Update it with any change to `nginx/`.
- CI publishes `ghcr.io/tempo-co/tempo-web:pr-<n>` for same-repo PRs and retags the tested image as `:main` after `main` passes. `:main` is what production deploys, so a merge to `main` ships.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## E2E test helpers

Reuse these instead of re-creating setup inline:

- `test/fixtures.ts`: import `test` and `expect` from here instead of `@playwright/test`. It provides the page objects as fixtures (`loginPage`, `homePage`, `signupPage`, `verifyEmailPage`, `verifyEmailChangePage`, `resetPasswordPage`, `accountSettingsPage`, `securitySettingsPage`, `appearanceSettingsPage`), plus:
  - `freshAccount`: a new verified account with no bank data, with the test's browser context logged in as it.
  - `createVerifiedAccount(request)`: the same account without logging in, for tests that log in through the UI.
- Shared seeded data: tests that change account data or depend on an account having no bank data use `freshAccount` rather than a seeded account, so they do not depend on test order and stay safe to retry. Do not change seeded data another test reads.
- `test/utils/api-mocks.ts`: `mockBankConnections`, `transformBankConnections` and `routeBankConnectionsApi` intercept the `GET /bank-connections` API call while letting navigations to `/bank-connections` through. `mockJson` and `fulfillJson` answer other routes with JSON.
- `test/utils/layout.ts`: `boxOf(locator)` returns a rendered element's bounding box, and `expectNoHorizontalOverflow(page)` checks for horizontal scrolling.
- `test/utils/url.ts`: `withSearchParams(path, params)` builds URLs for the invalid-search-param cases in `test/data`.
- `test/utils/email-utils.ts`: `EmailUtils.getVerificationCode(email)` reads a verification code from Mailpit; `ResetPasswordPage.openResetLink(email)` requests a reset and opens the emailed link.
- `test/utils/hook-harness.ts`: `createHookHarness(stubs)` runs a real hook against a real `QueryClient` with whole modules stubbed. Add every new named import a hook uses from a stubbed module to the stubs.
- Fully mocked specs declare `test.use({storageState: {cookies: [], origins: []}})`.
- Write repeated validation cases as a `for` loop over a table of cases.

## Code conventions not enforced by tooling

- Feature code lives in `src/features/<feature>/{api,components,types,utils}`; shared code in `src/components/shared`, `src/hooks`, `src/providers`, `src/types`, `src/utils`; primitives in `src/components/ui`. Import `src` through the `@/` alias.
- Filenames are kebab-case; hooks export `useX` from `use-x.ts`. DTO files in feature `types` directories define a Zod schema and infer the exported type from it.
- JSON API hooks use the `api` wrapper in `src/utils/api.ts` with TanStack Query; it sends cookies, maps failures to `HttpError` and owns the shared auth/network toasts and redirects. Mutations never retry or queue for replay (`src/query-client.ts`).
- Use `cn` from `src/utils/cn.ts` to merge Tailwind classes.
- Prettier covers `src/**/*.{js,jsx,ts,tsx}` only; edit `src/index.css` and Markdown by hand.
- Living docs (`DESIGN.md`, `PRODUCT.md`, `README.md`, `docs/`) state current durable facts: no dates, decision history or rename narration. No em dashes in the README.
