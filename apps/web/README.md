## Tempo

Tempo Web is the frontend of [Tempo](https://github.com/tempo-co/tempo-api): a private personal-finance overview for connected bank accounts. Built with React 18, TypeScript, Vite, Tailwind CSS, and TanStack Router/Query; end-to-end tested with Playwright.

## Prerequisites

Make sure you have the following installed on your system:

- [Node.js](https://nodejs.org/) (22.x)
- [Docker](https://www.docker.com/) (for the E2E stack)

## Installation

```bash
$ npm ci
```

## Env setup

Vite environment values are declared in `vite-env.d.ts`:

- `VITE_API_URL`: API base URL used by `src/utils/api.ts`
- `VITE_APP_URL`: app URL used by Playwright's web server and `baseURL`
- `VITE_EMAIL_UI_URL`: Mailpit URL used by `test/utils/email-utils.ts`

## Development

```bash
$ npm run dev
```

Generates the TanStack route tree and starts Vite with hot reload.

## Build

```bash
$ npm run build
```

Generates routes, type-checks with `tsc -b`, and produces the production bundle. Lint and format checks mirror CI:

```bash
$ npm run lint:check
$ npm run format:check
```

## Offline use

Production builds install a service worker for the app shell. After one successful visit, saved account and banking views can reopen during a connection outage. Previously loaded query results are stored in this browser's local storage for up to 24 hours. Only loaded pages and filter combinations are available; cached data is not a new live balance or authorization check. Use Tempo only in a trusted browser profile.

An unreachable API shows a reconnecting state, not a login redirect. Changes are not queued or automatically replayed while disconnected. Logout, account deletion and an observed expired/revoked session clear saved data. An unconfirmed logout is completed before trusting the session again after reconnection; only logout is retried. If the browser cannot store that intention, keep the app open until logout is confirmed. Revocation on another device can only be detected when this browser reconnects. Session identifiers are not persisted, and the service worker never caches API responses or bank authorization callbacks.

Shell updates wait until the previous worker's tabs close; there is no automatic reload of an open form. Close all Tempo windows and reopen online to activate a waiting update. Development mode does not install a worker.

## Test

End-to-end tests use Playwright against a disposable Docker stack (PostgreSQL, Redis, Mailpit, and the API). Playwright builds and previews the app itself. The categorization flow uses the paired API branch image so the browser calls the real category endpoint; the only mocked boundary is the API's AI provider.

For a fully deterministic local run (reset services, fresh database and seed):

```bash
$ npm run test:e2e:local
```

This uses `ghcr.io/tempo-co/tempo-api:main`. To test against an unmerged API change, set `TEMPO_API_E2E_IMAGE` to a locally built image or a PR image (`ghcr.io/tempo-co/tempo-api:pr-<n>`).

CI runs the same suite on every push (`npx playwright test` against fresh services). A web PR whose body contains `Depends-on: tempo-api#<n>` runs against that API PR's image.

`docker:test:up` / `docker:test:down` manage the E2E services; each E2E run starts from a pristine database, and the E2E setup authenticates seeded users via `test/auth.setup.ts`.
