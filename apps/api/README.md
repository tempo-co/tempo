## Tempo

Tempo API is a backend service built with [NestJS](https://nestjs.com) for personal finances. It synchronizes real bank data through [Enable Banking](https://enablebanking.com) and serves accounts, balances, and transactions to the [web client](../web/README.md).

## Prerequisites

Make sure you have the following installed on your system:

- [Node.js](https://nodejs.org/) (v20.19.0+, v22.13.0+, or v24.x+)
- [Docker Engine](https://docs.docker.com/engine/) (v28.0.0 or later)

## Installation

```bash
$ npm ci
```

## Env setup

The development environment uses variables from `.env.development`. To override these locally (for API keys or secrets), define them in a `.env.development.local` file, which takes precedence.

Optional AI categorization uses Claude with model `claude-sonnet-5-5` at `high` effort by default (`AI_CATEGORIZATION_MODEL`, `AI_CATEGORIZATION_EFFORT`). `AI_CATEGORIZATION_ENABLED=false` keeps it off in development and tests. When enabled, configure `ANTHROPIC_API_KEY`, `AI_CATEGORIZATION_SUBSCRIPTION_SOCKET`, or both. The API route is tried first; the local subscription bridge is the fallback. No credentials are required while categorization is disabled.

`AI_CATEGORIZATION_WEB_SEARCH_ENABLED=false` keeps merchant search off. When enabled, the one merchant search runs on the Anthropic API, or on the subscription bridge when the API refuses the request. Results retain the actual route (`claude-api` or `claude-subscription`) and configured model. If neither route is available, for the normal pass or the search, rows stay pending for queue retries and hourly reconciliation, preserving same-input categories and manual overrides.

`MERCHANT_LOGOS_ENABLED=false` keeps merchant logos off. When enabled, the API identifies each new merchant once per owner through the same Claude routes as categorization, takes the logo from logo.dev when `LOGO_DEV_SECRET_KEY` is set, or from the merchant's official site when that one is larger, after the site's homepage confirms the brand, and serves it from `GET /merchant-logos/:id/:version` to the owner only. When a site serves no usable icon or refuses the server, the API asks DuckDuckGo's icon service for it. logo.dev and DuckDuckGo receive only the hostname; such a logo shows only when the model was sure of the site. Logos are stored in PostgreSQL, so backups include them.

pgAdmin requires a login; its password defaults to `DB_PASSWORD` and can be overridden by setting `PGADMIN_DEFAULT_PASSWORD` in the environment.

## Development

```bash
$ npm run start:dev
```

This script starts the necessary Docker services, cleans any previous build output and starts the server in watch mode.

## Local MCP client

The optional [read-only stdio MCP package](mcp/README.md) exposes eleven banking tools to a local MCP client. It uses a Tempo personal access token, not a browser session, and runs separately from the API. Build and configure it only for an explicitly selected client session or project; do not enable it globally until interactive/background isolation is proven.

## Test

### Unit tests

Unit tests use Jest and focus on testing individual components in isolation.

```bash
$ npm run test

# generate coverage report
$ npm run test:cov
```

### E2E tests

Jest is used for end-to-end tests. The shared setup starts a real application and seeds the test accounts. The dedicated categorization profile additionally seeds stable, account-scoped bank connection, account, and transaction fixtures before its test cases run.

```bash
$ npm run test:e2e

# generate coverage report
$ npm run test:e2e:cov

```

The shared E2E setup keeps AI categorization disabled by default. The categorization spec opts into enabled mode before the shared application bootstrap, injects a non-secret placeholder key, and mocks only the provider boundary. It still exercises the real Nest HTTP app, PostgreSQL persistence, BullMQ/Redis queue, worker, response DTOs, and provider-failure handling; the normal E2E cases remain disabled.

### Database seeding

```bash
$ npm run db:seed
```

This truncates and recreates the PostgreSQL `public` schema, then seeds initial data. It runs against whatever database `DB_NAME` points to.
