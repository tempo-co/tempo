# Tempo Web Agent Instructions

Tempo Web is a React 19 + TypeScript single-page frontend built with Vite. It uses TanStack Router for file-based routing, TanStack Query for API state, Tailwind CSS/shadcn-style Radix components, and Playwright E2E tests. Main feature areas (`src/features/{auth,banking,settings}`) are authentication, Enable Banking bank connections, bank transactions, and account settings.

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

## Dev environment

- CI uses Node.js 22.x and the committed npm lockfile. Install with `npm ci`.
- Vite environment values are declared in `vite-env.d.ts`:
  - `VITE_API_URL`: API base URL used by `src/utils/api.ts`.
  - `VITE_APP_URL`: app URL used by Playwright's web server and `baseURL`.
  - `VITE_EMAIL_UI_URL`: Mailpit URL used by `test/utils/email-utils.ts`.
  - `VITE_BASE_PATH` (optional, default `/`): the base path `vite.config.ts` serves the app and PWA manifest under. `Dockerfile.production` builds with `/tempo/`.
- `npm run dev` generates the TanStack route tree and starts Vite.

## Build, lint, format, and test

- Size local verification to the change: run relevant static checks and focused tests, including regression proof where appropriate. Let PR CI run the full suite on fresh services. Run the full suite locally for cross-cutting changes, gaps in CI, or failures requiring reproduction. A complete passing CI run on the current head is the delivery gate.

- `npm run generate-routes` — regenerate the route tree.
- `npm run build` — generate routes, run `tsc -b`, then run `vite build`.
- `npm run lint:check` — CI lint check; does not modify files.
- `npm run lint` — lint with ESLint `--fix`; it modifies files.
- `npm run format:check` — CI Prettier check for `src/**/*.{js,jsx,ts,tsx}`.
- `npm run format` — write Prettier formatting for those source files.
- `npx playwright install chromium --with-deps` — install the CI browser.
- `npm run test:e2e:local` — reset E2E Docker services, start them, seed the API, and run the full Playwright suite headlessly (always starts from a pristine database). CI runs the same suite via `npx playwright test` against fresh services.
- `npm run docker:test:up` / `npm run db:seed:e2e` / `npm run docker:test:down` — start services, seed data, and clean up services respectively.

CI runs these jobs in parallel: lint/format (`npm run generate-routes`, `npm run lint:check`, `npm run format:check`), build (`npm run build`, then `ops/tests/tempo-web-security-headers-test.sh`) and E2E (starts the Docker services, seeds the API, runs Playwright). The image build starts after lint/format passes, and the main-image release waits for all of them. There is no unit-test script; Playwright tests are under `test/e2e`.

## Deployment and ops checks

- `ops/tests/tempo-web-security-headers-test.sh` builds the production image and probes the security headers Nginx serves (needs Docker). Update it when you change `nginx/tempo.conf`.
- CI publishes `ghcr.io/tempo-co/tempo-web:pr-<n>` for every same-repo PR and tags `:main` after tests pass on `main`. Production deploys `:main` automatically; staging deploys any pair with `tempo-deploy staging --api <tag> --web <tag>` (see `tempo-api/ops/README.md`). Production and staging are both served under `/tempo/`.

## Repository layout and conventions

- `src/routes/**` contains TanStack Router route files. Each route exports `Route = createFileRoute(...)`; nested/index routes follow the filesystem path.
- `src/features/<feature>/{api,components,types,utils}` holds feature code. Cross-feature code belongs in `src/components/shared`, `src/hooks`, `src/providers`, `src/types`, or `src/utils`; Radix/shadcn primitives are in `src/components/ui`.
- `src/routeTree.gen.ts` is generated by TanStack Router, ignored by Git, and must not be hand-edited. Run `npm run generate-routes` after adding, renaming, or deleting a route.
- Use the configured `@/*` alias for `src` imports. Prettier sorts imports as third-party, `@/` imports, then relative imports, with blank-line separation and sorted specifiers.
- Existing filenames use kebab-case; React components use PascalCase; hooks use `useX` exports from `use-x.ts`. DTO files live in feature `types` directories, define a Zod schema, and infer the exported TypeScript type from it.
- JSON API feature hooks use the `api` wrapper in `src/utils/api.ts` and TanStack Query. That wrapper sends cookie credentials, maps failures to `HttpError`, and handles shared auth/network toasts and redirects.
- Use Tailwind classes for styling and `cn` from `src/utils/cn.ts` when class merging is needed. Formatting is single-quoted, JSX uses single quotes, trailing commas are enabled, bracket spacing is disabled, and the print width is 100.
- TypeScript is strict with unused locals/parameters and fallthrough cases disabled in `tsconfig.app.json`.

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
- Write repeated validation cases as a `for` loop over a table of cases.

## E2E environment and pitfalls

- `docker-compose.e2e.yml` requires Docker and reserves host ports 1025/8025 (Mailpit), 6379 (Redis), 5432 (Postgres), and 3000 (API). The Vite preview uses port 5173.
- E2E setup authenticates seeded users in `test/auth.setup.ts` and writes ignored storage state under `playwright/.auth/`; settings tests change seeded account data, so use the disposable E2E services.
- `npm run docker:test:down` uses `docker compose ... down -v --remove-orphans`; the local E2E reset removes Docker volumes.
- `README.md` documents the current Tempo setup and commands. When it differs from the implementation, use `package.json`, the Vite/Playwright configs, and `.github/workflows/ci.yml` as the authoritative references.
