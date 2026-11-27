## Wisp

Wisp Web is the frontend of [Wisp](../../README.md): a personal-finance overview for connected bank accounts. Built with React 19, TypeScript, Vite, Tailwind CSS, and TanStack Router/Query; end-to-end tested with Playwright.

## Prerequisites

- [Node.js](https://nodejs.org/) (26.x)
- [Docker](https://www.docker.com/) (for the E2E stack)

## Installation

```bash
$ npm ci
```

## Env setup

Vite environment values are declared in `vite-env.d.ts`; what each does and how to pass them: `docs/env-boundaries.md`.

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

This uses `ghcr.io/wispmoney/api:main`. To test against an unmerged API change, set `WISP_API_E2E_IMAGE` to an image built from `apps/api` or a PR image (`ghcr.io/wispmoney/api:pr-<n>`).

CI runs the same suite on every pull request that changes either app and on `main`, against fresh services and the API image built from the same commit ([CI and images](../../docs/ci-and-images.md)).

`docker:test:down` deletes the database; `test:e2e:local` recreates and seeds it; `test/auth.setup.ts` logs the seeded users in.
