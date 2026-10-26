# CI and images

Workflow: `.github/workflows/ci.yml` (`CI/CD`). Jobs: `Lint & Format`, `Build`, `Unit Tests`, `E2E Tests`, `Image`, `Release main image`.

## What each job covers

- `Lint & Format`: root `lint:check`/`format:check`, the `mcp/` package's lint/format, `shellcheck -x` on the `ops/` scripts, and `docker compose config -q` on the production, Tailscale and staging Compose files with synthetic values for every required variable. A new `${VAR:?}` in a Compose file needs a synthetic export there.
- `Build`: `npm run build` plus the `mcp/` build.
- `Unit Tests`: Jest, `node --test ops/claude-bridge/*.test.mjs`, and the `mcp/` tests.
- `E2E Tests`: `npm run test:e2e:cov` on fresh services. It normally takes a few minutes; a run far beyond that is stuck, not slow.
- `Image`: builds the Dockerfile, which runs `ops/runtime-image-smoke.js` (no dev dependencies, no env files, email templates present), so a built image is a smoke-tested image. Same-repo, non-Dependabot PRs and pushes to main publish `ghcr.io/<owner>/tempo-api:sha-<sha>` and `:pr-<n>`.
- `Release main image`: on main only, after every other job passed, retags `sha-<sha>` as `:main` with `docker buildx imagetools create` (no rebuild). It is serialized and skips when main has moved on, so `:main` never moves backwards. Deployments track `:main`.

## Rules

- Keep job names unchanged: they are required checks. Grep for a job or file name before renaming it.
- Never publish a tag deployments track from a pre-test job.
- Cross-repo contract changes: a tempo-web PR that needs this API's unmerged change declares `Depends-on: tempo-api#<n>` in its body and runs against `:pr-<n>`. Merge the API PR first, and only drop the `Depends-on` line once `Release main image` for the merge commit is green; a web run started earlier pulls the old `:main` and fails on the new endpoints.
- No CI run after a push usually means the PR conflicts with main; merge main into the branch rather than pushing empty commits.
- When two PRs both edit `AGENTS.md` or the same docs, simulate the second merge (`git merge-tree --write-tree`) before handing them over.

## Images

- The runtime stage sets `NODE_ENV=production` and ships only `dist/` and production dependencies. `ops/claude-bridge/contract.json` is copied into the build because the config schema imports it; a new contract file must be added to the `Dockerfile` too.
- Email `.hbs` templates are copied to `dist/` by `nest-cli.json` assets and checked by the smoke script; keep templates under `src/app/core/email/templates`.
- The `mcp/` package is excluded from the API build's file discovery (`tsconfig.build.json`). The hosted controller explicitly imports the Nest-free tool registration, so that shared dependency closure is compiled into `dist/mcp/src/` as CommonJS. The stdio runtime remains excluded; its own build emits ESM to `mcp/dist/stdio.js`. Do not copy `mcp/package.json` into `dist/mcp/`, where its `type: module` would change how the API's CommonJS output loads.
- Root build, start, seed/schema and test npm hooks generate the shared category catalog before compilation. Direct Jest or TypeScript invocations need `npm run generate:mcp` first. The Docker builder copies `mcp/src/` and `mcp/scripts/generate-categories.mjs`; it needs no separate MCP install. The root SDK version matches the standalone lockfile. The runtime image smoke loads the API module and its compiled shared registration with production dependencies.
- Root `ts-node` commands treat `mcp/src/` as CommonJS and resolve its `.js` source specifiers to TypeScript through the root `tsconfig.json` overrides. Keep those overrides scoped to root commands; the standalone package remains ESM.
- Image cleanup must filter on `org.opencontainers.image.source` and pass `--all`; tagged leftovers are never dangling.

## Migrations

- Migrations live in `src/app/core/database/migrations/` and run automatically only in production. After merging main, check for a timestamp collision with an unshipped branch migration; rename the file and its class/`name` together.
- Prove a migration with the real QueryRunner against disposable PostgreSQL: up, read/write through the migrated schema, down, up again, and a second run that applies nothing. Fingerprint unrelated tables (row count plus an md5 over rows) before and after to show they did not change.
- A data-migration spec may ship with its migration and be removed once the migration has run everywhere it needs to.
