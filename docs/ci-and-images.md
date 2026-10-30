# CI and images

Workflow: `.github/workflows/ci.yml` (`CI/CD`). One workflow runs for every PR and every push to `main`; its jobs run only for the parts of the repository a change touches. API image and migration rules: `apps/api/docs/migrations-and-image.md`.

## Which jobs run

The `Changes` job sets four flags. A PR compares its merge commit with the base branch. A push to `main` compares each app with the commit its current `:main` image was built from (read from GHCR by `.github/scripts/released-revision.sh`), so a change whose release was skipped because `main` moved on is released by the next push; `ops` compares with the previous `main`.

| Flag | Set when the change touches | Jobs |
|---|---|---|
| `api` | `apps/api/**` | `API lint & format`, `API build`, `API unit tests`, `API E2E tests`, `API image` |
| `web` | `apps/web/**` | `Web lint & format`, `Web build`, `Web image` |
| `e2e` | `apps/api/**` or `apps/web/**` | `Web E2E shard 1/8`…`8/8`, `Web E2E tests` |
| `ops` | `ops/**` | `Ops checks` |

A change to `.github/workflows/ci.yml` or `.github/scripts/` sets every flag, and an area whose base commit is unknown (not in this history, or unreadable) runs. Other files (root docs, `AGENTS.md`, other workflows, Dependabot config) run no jobs. Jobs are gated with `if:`, never with `on: paths:`: a skipped job reports success, while a skipped workflow leaves a required check pending forever.

`CI` needs every job and fails if any of them failed or was cancelled; skipped jobs count as passing. It is the only required check, so job names can change without touching the ruleset.

## What each job covers

- `Ops checks`: `shellcheck -x` on the `ops/` scripts, and `docker compose config -q` on the production, Tailscale and staging Compose files with synthetic values for every required variable. A new `${VAR:?}` in a Compose file needs a synthetic export there.
- `API lint & format`: the API's `lint:check`/`format:check` and the `mcp/` package's lint/format.
- `API build`: `npm run build` plus the `mcp/` build.
- `API unit tests`: Jest, `node --test claude-bridge/*.test.mjs`, and the `mcp/` tests.
- `API E2E tests`: `npm run test:e2e:cov` on fresh services. It normally takes a few minutes; a run far beyond that is stuck, not slow.
- `API image` and `Web image`: build `apps/api/Dockerfile` and `apps/web/Dockerfile.production`. The API Dockerfile runs a runtime smoke check, so a built API image is a smoke-tested image. Same-repo, non-Dependabot PRs and pushes to `main` publish `ghcr.io/<owner>/api` and `ghcr.io/<owner>/web` as `:sha-<sha>` and `:pr-<n>`. Images carry `org.opencontainers.image.source` (this repository) and `org.opencontainers.image.revision` (the commit).
- `Web build`: `npm run build` plus `scripts/tempo-web-security-headers-test.sh`, which builds the production web image and probes Nginx.
- `Web E2E shard n/8`: the Playwright suite against the Docker stack in `apps/web/docker-compose.e2e.yml`. The API image is this run's `API image` when `api` is set (pinned by digest; a Dependabot or fork PR, which publishes nothing, passes it as a run artifact instead), otherwise `ghcr.io/tempo-co/api:main` pinned by digest. The run summary records the image and its revision. Every spec runs in Chromium and WebKit when `web` is set; an API-only change runs Chromium only, since WebKit catches browser-engine differences only a web change can introduce. `Web E2E tests` merges the shard reports and fails unless every shard passed.
- `Release main images`: on `main` only, after `CI` passed, retags `sha-<sha>` as `:main` with `docker buildx imagetools create` (no rebuild), for each app whose flag is set, API before web. It is serialized and skips when `main` has moved on, so `:main` never moves backwards. Production deploys `:main` (`ops/README.md`), so an app a commit did not touch keeps running its previous image.

## Rules

- Never publish a tag deployments track from a pre-test job.
- An API contract change and the web code that uses it belong in one PR, so web E2E runs against the API that serves it.
- No CI run after a push usually means the PR conflicts with main; merge main into the branch rather than pushing empty commits.
- When two PRs both edit an `AGENTS.md` or the same docs, simulate the second merge (`git merge-tree --write-tree`) before handing them over.
- Image cleanup on a host must filter on `org.opencontainers.image.source` and pass `--all`; tagged leftovers are never dangling.

## GHCR retention

`.github/workflows/ghcr-retention.yml` runs `ops/ghcr-retention.sh` weekly for both packages (see `ops/README.md`). Scheduled runs only report until the repository variable `GHCR_RETENTION_DELETE` is `true`. Both packages are linked to this repository, which gives its workflows write and admin access; if that link is removed, image pushes and deletions fail with 403.
