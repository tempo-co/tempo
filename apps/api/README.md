## Tempo

Tempo API is a backend service built with [NestJS](https://nestjs.com) for personal finances. It synchronizes real bank data through [Enable Banking](https://enablebanking.com) and serves accounts, balances, and transactions to the [web client](../web/README.md).

## Prerequisites

- [Node.js](https://nodejs.org/) (v26+)
- [Docker Engine](https://docs.docker.com/engine/) (v28.0.0 or later)

## Installation

```bash
$ npm ci
```

## Env setup

The development environment uses variables from `.env.development`. To override these locally (for API keys or secrets), define them in a `.env.development.local` file, which takes precedence.

Optional features, all off by default (`src/app/core/config/config.schema.ts`): AI categorization and merchant search (`docs/categorization.md`), merchant logos (`docs/merchant-logos.md`), statement file import and its column mapper (`docs/file-import.md`). Each AI feature needs `ANTHROPIC_API_KEY`, except merchant logos with `MERCHANT_LOGOS_CACHED_ONLY=true`; merchant search also needs `BRAVE_SEARCH_API_KEY`.

Every email comes from `EMAIL_FROM`, `"Wisp" <no-reply@localhost>` when unset, and carries `EMAIL_REPLY_TO` as its Reply-To; unset or empty, emails have no Reply-To. Production sets both: the sender in its env file, the Reply-To in `ops/production.compose.yml`. The shared layout's header image is `apps/web/public/email-header.png`, linked by absolute URL from `WEB_BASE_URL`, and its footer links `/official` there.

`OPERATOR_ALERT_EMAIL` is the address operator alerts go to (`src/app/core/operator-alert/`); unset or empty, none are sent. A scheduled bank sync run whose dispatch job throws sends one, at most once a day per error name, naming the error but never its message, and so does a dispatcher that can't be installed at start-up; one connection's failure sends none, since its owner gets that connection's own alerts. The email job's id (kind and date) keeps the daily limit across restarts and API instances.

## Development

```bash
$ npm run start:dev
```

This script starts the necessary Docker services, cleans any previous build output and starts the server in watch mode.

## Statement file import

How statement files become transactions, the formats read, the limits and the column mapper are described in [docs/file-import.md](docs/file-import.md).

## MCP

The API serves sixteen read-only banking tools over a hosted [Streamable HTTP MCP endpoint](docs/mcp.md) at `/api/mcp`. Clients authenticate with a Tempo personal access token, not a browser session.

## Test

### Unit tests

```bash
$ npm run test

# generate coverage report
$ npm run test:cov
```

### E2E tests

```bash
$ npm run test:e2e

# generate coverage report
$ npm run test:e2e:cov

```

### Database seeding

```bash
$ npm run db:seed
```

Destructive: see `AGENTS.md` before running it.
