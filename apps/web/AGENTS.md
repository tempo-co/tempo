# Tempo Web Agent Instructions

Paths are relative to `apps/web` unless they start at the repository root.

## Read before touching

- `docs/browser-and-e2e-testing.md`: before writing or running Playwright specs, mocking routes, testing dialogs, drawers, dates or search limits. Shared test helpers: `docs/e2e-helpers.md`.
- `docs/env-boundaries.md`: before changing `VITE_*` values, `NODE_ENV`, `docker-compose.e2e.yml`, the API image, Nginx or `Dockerfile.production`, or when local E2E setup fails.
- `docs/frontend-conventions.md`: before changing feedback/toasts, destructive styles, phone layouts, settings lists, copy, query caches or `src/components/ui`.
- `docs/product-ui-rules.md`: before deciding what a screen, card, chart, list or filter shows.
- `docs/pwa.md`: the manifest, icons, base path or offline shell. `docs/file-import.md`: the statement file import's screens on Connections.
- `DESIGN.md`: read before any UI change (colours, type, sizes, components, patterns); it is the design system's single document. `PRODUCT.md`: product scope and product rules.

## Commands and traps

- Fresh worktree: `npm ci`, `npx playwright install chromium webkit`, then `npm run generate-routes`. `src/routeTree.gen.ts` is generated and ignored by Git; when it is missing or stale (rerun after adding, renaming or deleting a route), `lint:check` shows dozens of `no-unsafe-*` or implicit-`any` errors in untouched files.
- There is no unit-test runner; all tests are Playwright specs under `test/` (`test/unit` holds pure-module specs). Find the e2e specs for a change by grepping `test/e2e` for the route, component or label; most e2e specs do not import `src`, so `--only-changed` misses them.
- `npm run test:e2e:local` resets the Docker services (`down -v`), seeds and runs the whole suite on the stack every worktree shares. Locally, run only the specs for your change, and start a run only when `pgrep -af 'playwright test'` shows no other.
- `.env.*` is ignored, so a fresh worktree has no `VITE_*` values. Pass them inline for the process (`docs/env-boundaries.md`); do not create or edit env files for a run.
- Leave `NODE_ENV` unset for builds and Playwright. Gate dev-only code on `import.meta.env.MODE === 'development'` or an explicit `VITE_*` flag, never on `import.meta.env.DEV`.
- Playwright reuses any server already on `VITE_APP_URL` (`reuseExistingServer`). Another worktree's preview on port 5173 means you are testing the wrong build; check the listener first.
- A web change that needs an API change is tested against it only in the same PR, or locally with `TEMPO_API_E2E_IMAGE` pointing at an image built from `apps/api`. Never weaken assertions to match an older API.
- `scripts/tempo-web-security-headers-test.sh` builds the production image and probes the SPA and the API proxy (needs Docker). Update it with any change to `nginx/`.

## Code conventions not enforced by tooling

- Specs that open a page import `test` and `expect` from `test/fixtures.ts`; pure-module specs in `test/unit` use `@playwright/test`. Tests that change account data use `freshAccount`, not a seeded account.
- Filenames are kebab-case; hooks export `useX` from `use-x.ts`. DTO files in feature `types` directories define a Zod schema and infer the exported type from it.
- API request and response types and the fixed value lists they use come from `@tempo/contracts` (root `packages/contracts`); pass them to `api.get<T>()` and check request bodies with `satisfies`. Labels and other UI copy for those values stay in the feature's `types` or `utils`.
- JSON API hooks use the `api` wrapper in `src/utils/api.ts` with TanStack Query; it owns the shared auth/network toasts and redirects. Mutations never retry or queue for replay (`src/query-client.ts`).
- Prettier covers `src/**/*.{js,jsx,ts,tsx}` only; edit `src/index.css` and Markdown by hand. `npx prettier --write src` touches CSS too, so run it on changed paths and check `git status` for collateral files. `prettier-plugin-tailwindcss` stays last in `plugins`.
