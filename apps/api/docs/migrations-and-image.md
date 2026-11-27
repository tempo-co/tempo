# Migrations and the API image

CI builds and releases this image; see the root `docs/ci-and-images.md`.

## Image

- The image builds from the repository root (`docker build -f apps/api/Dockerfile .`). `@wisp/contracts` is a `file:../../packages/contracts` dependency, so the Dockerfile places the package at `/usr/packages/contracts`, two levels above the app directory, and the runtime stage keeps its `package.json` and `dist/` for the `node_modules` link.
- The runtime stage sets `NODE_ENV=production` and ships only `dist/`, production dependencies and `/usr/src/app/wisp-staging-copy.sql`, the staging copy filter the production server copies out of the running API (`docs/staging-feed.md`). The Claude contract JSON files sit under `src/` and are imported, so the build emits them into `dist/`.
- The `Dockerfile` runs `scripts/runtime-image-smoke.js` (no dev dependencies, no env files, email templates present), so a built image is a smoke-tested image.
- Email `.hbs` templates are copied to `dist/` by `nest-cli.json` assets and checked by the smoke script; keep templates under `src/app/core/email/templates`.
- A new script that a CI job runs right after `npm ci` needs a `pre<script>` hook that runs `npm run contracts:build`, or it sees every contracts type as an error.

## Migrations

- Migrations live in `src/app/core/database/migrations/` and run automatically only in production. After merging main, check for a timestamp collision with an unshipped branch migration; rename the file and its class/`name` together.
- The set has no baseline. A fresh database runs every migration first, so each must skip work on a table that does not exist yet; the schema script (`scripts/schema.ts`, `node dist/scripts/schema.js` in the image) then creates the tables from the entities. `test/e2e/database/fresh-database.e2e.spec.ts` runs that install.
- TypeORM orders migrations by the number in the last 13 characters of the class `name`. Names here end in a 14-digit stamp (`RestampSameDayRowsNewestFirst20261119090000`), so the first digit is dropped and the order stays correct until the year 3000. Keep the file and class stamps identical, and before renaming a migration that may have shipped, check whether the database's `migrations` table has recorded it.
- Many migrations import live `src/app/modules/banking/` code (merchant keys, text columns, display descriptions, own-transfer and exchange recomputes), so they compile against its current types and run its current behavior: changing those modules' inputs edits the shipped migrations too. Code whose output a migration must keep (hashed identity keys) is frozen in `src/app/core/database/migration-support/` instead.
- Prove a migration with the real QueryRunner against disposable PostgreSQL: up, read/write through the migrated schema, down, up again, and a second run that applies nothing. A second run that still writes rows needs an `IS DISTINCT FROM` guard on the new value (as in `src/app/modules/banking/own-transfer/own-transfer-category.ts`). Fingerprint unrelated tables (row count plus an md5 over rows) before and after to show they did not change, over the columns that existed before the migration (read from `information_schema.columns` first), so a new column does not read as a change. When branches stack migrations, rehearse on current main merged with the top branch.
- A failed rollout restores the previous images but never rolls back migrations. After a migration that drops or renames a column the previous image reads, that image fails on the column until the migration's `down` runs or the pre-deploy backup is restored.
- A data-migration spec may ship with its migration and be removed once the migration has run everywhere it needs to.
