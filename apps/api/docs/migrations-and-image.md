# Migrations and the API image

CI builds and releases this image; see the root `docs/ci-and-images.md`.

## Image

- The image builds from the repository root (`docker build -f apps/api/Dockerfile .`). `@tempo/contracts` is a `file:../../packages/contracts` dependency, so the Dockerfile places the package at `/usr/packages/contracts`, two levels above the app directory, and the runtime stage keeps its `package.json` and `dist/` for the `node_modules` link.
- The runtime stage sets `NODE_ENV=production` and ships only `dist/` and production dependencies. `claude-bridge/contract.json` is copied into the build because the config schema imports it; a new contract file must be added to the `Dockerfile` too.
- The `Dockerfile` runs `scripts/runtime-image-smoke.js` (no dev dependencies, no env files, email templates present), so a built image is a smoke-tested image.
- Email `.hbs` templates are copied to `dist/` by `nest-cli.json` assets and checked by the smoke script; keep templates under `src/app/core/email/templates`.
- The `mcp/` package is excluded from the API build's file discovery (`tsconfig.build.json`). The hosted controller explicitly imports the Nest-free tool registration, so that shared dependency closure is compiled into `dist/mcp/src/` as CommonJS. The stdio runtime remains excluded; its own build emits ESM to `mcp/dist/stdio.js`. Do not copy `mcp/package.json` into `dist/mcp/`, where its `type: module` would change how the API's CommonJS output loads.
- The API's build, start and seed/schema npm hooks run `npm run generate`: it compiles `@tempo/contracts` (`contracts:build`) and generates the shared category catalog before compilation. The E2E hooks run only `generate:mcp`. Direct TypeScript invocations need `npm run generate` first. Jest needs no build: both Jest configs map `@tempo/contracts` to its source, and ts-jest type-checks through `tsconfig.jest.json`, which does the same. The Docker builder copies `mcp/src/` and `mcp/scripts/generate-categories.mjs`; it needs no separate MCP install. The API's SDK version matches the standalone lockfile. The runtime image smoke loads the API module and its compiled shared registration with production dependencies.
- The API's `ts-node` commands treat `mcp/src/` as CommonJS and resolve its `.js` source specifiers to TypeScript through the `tsconfig.json` overrides in `apps/api`. Keep those overrides scoped to the API's commands; the standalone package remains ESM.

## Migrations

- Migrations live in `src/app/core/database/migrations/` and run automatically only in production. After merging main, check for a timestamp collision with an unshipped branch migration; rename the file and its class/`name` together.
- Prove a migration with the real QueryRunner against disposable PostgreSQL: up, read/write through the migrated schema, down, up again, and a second run that applies nothing. Fingerprint unrelated tables (row count plus an md5 over rows) before and after to show they did not change.
- A data-migration spec may ship with its migration and be removed once the migration has run everywhere it needs to.
