## Tempo

Tempo Web is the frontend of [Tempo](https://github.com/tempo-co/tempo-api): a private personal-finance overview for connected bank accounts. Built with React 18, TypeScript, Vite, Tailwind CSS, and TanStack Router/Query; end-to-end tested with Playwright.

## Prerequisites

Make sure you have the following installed on your system:

- [Node.js](https://nodejs.org/) (20.x)
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

## Test

End-to-end tests use Playwright against a disposable Docker stack (PostgreSQL, Redis, Mailpit, and the API). Playwright builds and previews the app itself.

For a fully deterministic local run (reset services, fresh database and seed):

```bash
$ npm run test:e2e:local
```

CI runs the same suite on every push (`npx playwright test` against fresh services).

`docker:test:up` / `docker:test:down` manage the E2E services; each E2E run starts from a pristine database, and the E2E setup authenticates seeded users via `test/auth.setup.ts`.
