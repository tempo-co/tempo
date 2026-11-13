# Migrations and the API image

CI builds and releases this image; see the root `docs/ci-and-images.md`.

## Image

- The image builds from the repository root (`docker build -f apps/api/Dockerfile .`). `@tempo/contracts` is a `file:../../packages/contracts` dependency, so the Dockerfile places the package at `/usr/packages/contracts`, two levels above the app directory, and the runtime stage keeps its `package.json` and `dist/` for the `node_modules` link.
- The runtime stage sets `NODE_ENV=production` and ships only `dist/` and production dependencies. The Claude contract JSON files sit under `src/` and are imported, so the build emits them into `dist/`.
- The `Dockerfile` runs `scripts/runtime-image-smoke.js` (no dev dependencies, no env files, email templates present), so a built image is a smoke-tested image.
- Email `.hbs` templates are copied to `dist/` by `nest-cli.json` assets and checked by the smoke script; keep templates under `src/app/core/email/templates`.
- The API's build, start, seed/schema and E2E npm hooks run `npm run contracts:build`, which compiles `@tempo/contracts`. Direct TypeScript invocations need it first. Jest needs no build: both Jest configs map `@tempo/contracts` to its source, and ts-jest type-checks through `tsconfig.jest.json`, which does the same.

## Migrations

- Migrations live in `src/app/core/database/migrations/` and run automatically only in production. After merging main, check for a timestamp collision with an unshipped branch migration; rename the file and its class/`name` together.
- Prove a migration with the real QueryRunner against disposable PostgreSQL: up, read/write through the migrated schema, down, up again, and a second run that applies nothing. Fingerprint unrelated tables (row count plus an md5 over rows) before and after to show they did not change.
- A failed rollout restores the previous images but never rolls back migrations. After a migration that drops or renames a column the previous image reads, that image fails on the column until the migration's `down` runs or the pre-deploy backup is restored.
- A data-migration spec may ship with its migration and be removed once the migration has run everywhere it needs to.
