<p align="center">
  <a href="https://github.com/tempo-co/tempo/actions" target="_blank">
    <img src="https://github.com/tempo-co/tempo/actions/workflows/ci.yml/badge.svg" alt="Build Status" />
  </a>
  <a href="https://nodejs.org/" target="_blank">
    <img src="https://img.shields.io/badge/node.js-22.13%2B-brightgreen" alt="Node.js Version" />
  </a>
</p>

## Tempo

Tempo is a private, self-hosted personal-finance app. It synchronizes real bank data through [Enable Banking](https://enablebanking.com) and shows accounts, balances, transactions and recurring payments.

| Path | Contents |
|---|---|
| [`apps/api`](apps/api/README.md) | NestJS backend, the local MCP package and the Claude subscription bridge |
| [`apps/web`](apps/web/README.md) | React web app |
| [`ops`](ops/README.md) | Deployment: deploy, install and backup scripts, host units, production and staging Compose files |
| [`docs`](docs/ci-and-images.md) | CI and images for both apps |

Each app has its own `package.json`, lockfile and tooling; run npm commands inside its directory (`cd apps/api && npm ci`). Both need Node.js 26.x and Docker.
