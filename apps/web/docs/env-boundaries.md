# Environment boundaries

How the build, the E2E stack and the API image fit together, and the traps at each boundary.

## Vite values

`vite-env.d.ts` declares the values the app and tests read:

| Variable | Read by | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `src/utils/api.ts` | `Dockerfile.production` builds with `/api`; Nginx proxies `/api/` to the API. |
| `VITE_APP_URL` | `playwright.config.ts` (`webServer.url`, `baseURL`) | Empty means `page.goto('/login')` fails with "Cannot navigate to invalid URL". |
| `VITE_EMAIL_UI_URL` | `test/utils/email-utils.ts` | Mailpit UI. |
| `VITE_BASE_PATH` | `vite.config.ts` | Optional, default `/`. Sets Vite `base`, the generated manifest and the offline shell. See `docs/pwa.md`. |

`playwright.config.ts` and `test/fixtures.ts` read these with `loadEnv('development', ...)`, so they come from `.env.development`/`.env.development.local` or the process environment. `.env.*` is ignored by Git, so a fresh clone or worktree has none. Pass the CI values inline for that process instead of creating env files:

```bash
VITE_API_URL=http://localhost:3000 VITE_APP_URL=http://localhost:5173 VITE_EMAIL_UI_URL=http://localhost:8025 \
  npx playwright test <spec>
```

Without them, the `webServer` build (`npm run build && npm run preview`) exits before any test runs and Playwright reports only "Process from config.webServer was not able to start". Run `npm run build` directly with the same environment to see the real error.

## `NODE_ENV` changes the build

The build reads the ambient `NODE_ENV`. With `NODE_ENV=test` (or anything other than unset/`production`) during `vite build`:

- `import.meta.env.PROD` is false, so `src/utils/register-offline-shell.ts` does not register the service worker. Specs that wait for `navigator.serviceWorker.controller` (offline and network-resilience specs) time out.
- `import.meta.env.DEV` is true, so `src/main.tsx` wraps the app in `StrictMode` and `src/routes/__root.tsx` renders the router devtools in the preview build.
- The bundle uses the development JSX runtime.

`import.meta.env.MODE` stays `production` for `vite build` regardless of `NODE_ENV`.

Rules:

- Leave `NODE_ENV` unset for `npm run build`, `npm run preview` and Playwright. CI does not set it.
- Gate dev-only behaviour on `import.meta.env.MODE === 'development'` or an explicit `VITE_*` flag, never on `import.meta.env.DEV`; a shell that exports `NODE_ENV=test` flips `DEV` in a production build.
- If a shell exports `NODE_ENV=production`, `vite` dev can crash before any request with `_jsxDEV is not a function` (mixed JSX runtimes). Set `NODE_ENV=development` for `npm run dev`; that is a harness failure, not a test result.
- When a spec passes locally and fails in CI with a different but valid label/variant in the snapshot, grep both strings in `src`. If neither is in the source, the variant is chosen at build time; reproduce with the CI environment before changing assertions.

## E2E stack

`docker-compose.e2e.yml` (project `tempo-web` in the npm scripts) runs Mailpit (1025/8025), Redis (6379), Postgres (5432) and the API (3000) with synthetic configuration. Host ports and container names (`api`, `postgres_test`, `redis_test`, `mailpit_test`) are fixed, so it collides with any other stack using them. Check `docker compose ls --all` and `docker ps` before `docker:test:up`/`down`; `docker:test:down` runs `down -v --remove-orphans` and deletes the database volume.

- The API runs with `NODE_ENV=test`, which drops and recreates the schema on boot. Seed only after the API is healthy: `docker:test:up` waits (`--wait`), then `db:seed:e2e` runs the seed inside the `api` container. A seed run before the API started is wiped, and logins then fail with "Invalid email or password".
- The API's only CORS origin is `WEB_BASE_URL=http://localhost:5173`, and the bank callback redirect is fixed to the same origin. Serving the app on another port or as `127.0.0.1` needs those changed too, so keep the preview on `localhost:5173`.
- Banking provider calls point at `https://api.example.invalid` and AI categorization is off. Specs that need provider responses mock them with `page.route`.
- The seed and the specs share accounts. `test/auth.setup.ts` logs seeded users in and writes `playwright/.auth/*.json`. A full run changes seeded accounts (password change/reset, sessions), so reseed before running again, and keep the `setup` project so storage states are refreshed after a reseed. Stale storage states show up as 401s.
- Repeated setup runs consume the API's login throttle and leave sessions in Redis. Recreate the stack (`npm run test:e2e:local`) instead of reusing empty or stale storage-state files.

## API image

E2E runs the API image named in `docker-compose.e2e.yml`: `${TEMPO_API_E2E_IMAGE:-ghcr.io/tempo-co/api:main}`. A local run proves nothing about an unmerged API change unless `TEMPO_API_E2E_IMAGE` points at an image that contains it: build one from this checkout (`docker build -t tempo-api:local -f apps/api/Dockerfile .` at the repository root) or use a PR's `ghcr.io/tempo-co/api:pr-<n>`.

In CI, the `Select API image` step uses the API image built in the same run when the change touches `apps/api` or `packages/contracts`, otherwise API `:main`, pinned by digest either way; the run summary records the image and revision used (root `docs/ci-and-images.md`). If only the feature that changed fails while unrelated pages pass, check that image for the route before suspecting the spec; never weaken an assertion to match an older API.

## Seeded preview for manual review

1. Confirm the worktree, branch and `HEAD` you intend to show. `vite preview` and `vite` on 5173 may belong to another checkout; check the listener's working directory before reusing it.
2. Start and seed the stack (`npm run docker:test:up && npm run db:seed:e2e`), or reuse a running one after confirming its project label.
3. Start the app with process-scoped values: `VITE_API_URL=http://localhost:3000 npm run dev`. Verify one real browser request reaches that API origin; a 200 for the document does not prove API calls work.
4. Hand over `http://localhost:5173/<route>` and say which pages need a login. Do not print seeded credentials or storage state.

## Production image

`Dockerfile.production` builds with `VITE_API_URL=/api` and `VITE_BASE_PATH=/`, then serves `dist` from Nginx on port 8080 with `nginx/tempo.conf`. `nginx/tempo.conf` proxies `/api/` and `/bank-connections/callback` to `api:3000` and applies `nginx/security-headers.conf` to the SPA. The exact `/api/mcp` endpoint uses HTTP/1.1, disables response buffering, has a 60-second upstream read timeout and limits request bodies to 100 KiB. Integrations derives the absolute MCP server URL from `VITE_API_URL` and the browser origin. `scripts/tempo-web-security-headers-test.sh` builds the image and probes both the SPA and the API proxy, including MCP event delivery and the request limit; update it with any `nginx/` change.
