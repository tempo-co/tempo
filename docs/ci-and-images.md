# CI and images

Workflow: `.github/workflows/ci.yml` (`CI/CD`). One workflow runs for every PR and every push to `main`; its jobs run only for the parts of the repository a change touches. API image and migration rules: `apps/api/docs/migrations-and-image.md`.

## Which jobs run

The `Changes` job sets five flags. A PR compares its merge commit with the base branch. A push to `main` compares each app with the commit its current `:main` image was built from (read from GHCR by `.github/scripts/released-revision.sh`), so a change whose release was skipped (a newer commit had already released that app) is released by the next push; `ops` compares with the previous `main`.

| Flag | Set when the change touches | Jobs |
|---|---|---|
| `api` | `apps/api/**`, `packages/contracts/**`, `.dockerignore` | `API lint & format`, `API build`, `API unit tests`, `API image` |
| `api_e2e` | anything that sets `api`, or `ops/wisp-staging-copy.sql` (its test runs in the API's E2E suite) | `API E2E tests` |
| `web` | `apps/web/**`, `packages/contracts/**`, `.dockerignore` | `Web lint & format`, `Web build`, `Web image` |
| `e2e` | anything that sets `api` or `web` | `Web E2E shard 1/8`…`8/8`, `Web E2E tests` |
| `ops` | `ops/**` | `Ops checks` |

A change to `.github/workflows/ci.yml` or `.github/scripts/` sets every flag, and an area whose base commit is unknown (not in this history, or unreadable) runs. Other files (root docs, `AGENTS.md`, other workflows, Dependabot config) run only `Docs check`. Jobs are gated with `if:`, never with `on: paths:`: a skipped job reports success, while a skipped workflow leaves a required check pending forever.

`CI` needs every job and fails if any of them failed or was cancelled; skipped jobs count as passing. It is the only required check, so job names can change without touching the ruleset.

## What each job covers

- `Docs check`: runs for every change. `.github/scripts/check-docs.mjs` fails when a living doc names a backticked path that is not tracked, an `npm run` script its package lacks, or exceeds its word budget; budgets, overrides and the allowed missing paths are in `.github/scripts/check-docs.json`, and `node --test .github/scripts/check-docs.test.mjs` tests the check.
- `Ops checks`: `shellcheck -x` on the `ops/` scripts and the release scripts in `.github/scripts/`, the offline `ops/test-deploy.sh`, `ops/test-sync-pins.sh`, `ops/test-backup.sh` and `.github/scripts/move-tag.test.sh`, `docker compose config -q` on the production and staging Compose files with synthetic values for every required variable, and `caddy validate` on `ops/Caddyfile` with the pinned Caddy image. A new `${VAR:?}` in a Compose file needs a synthetic export there.
- `API lint & format`: the API's `lint:check`/`format:check`.
- `API build`: `npm --prefix apps/api run build`.
- `API unit tests`: Jest.
- `API E2E tests`: `npm --prefix apps/api run test:e2e:cov` on fresh services. It normally takes a few minutes; a run far beyond that is stuck, not slow.
- `API image` and `Web image`: build `apps/api/Dockerfile` and `apps/web/Dockerfile.production` with the repository root as context, so both can copy `packages/contracts`. The root `.dockerignore` allowlists the two apps and that package and keeps `node_modules`, `dist` and env files out. The API Dockerfile runs a runtime smoke check, so a built API image is a smoke-tested image. Both Dockerfiles pin their base images (Node, and Nginx for the web) by tag and digest; Dependabot checks them daily, Node without the cooldown, so a Node security release reaches a PR within a day. Same-repo, non-Dependabot PRs and pushes to `main` publish `ghcr.io/<owner>/api` and `ghcr.io/<owner>/web` as `:sha-<sha>` and `:pr-<n>`. Images carry `org.opencontainers.image.source` (this repository) and `org.opencontainers.image.revision` (the commit).
- `Web build`: `npm --prefix apps/web run build` plus `apps/web/scripts/tempo-web-security-headers-test.sh`, which builds the production web image and probes Nginx.
- `Web E2E shard n/8`: the Playwright suite against the Docker stack in `apps/web/docker-compose.e2e.yml`. The API image is this run's `API image` when `api` is set (pinned by digest; a Dependabot or fork PR, which publishes nothing, passes it as a run artifact instead), otherwise `ghcr.io/tempo-co/api:main` pinned by digest. The run summary records the image and its revision. Every spec runs in Chromium and WebKit when `web` is set; an API-only change runs Chromium only, since WebKit catches browser-engine differences only a web change can introduce. Each shard runs Playwright inside the official Playwright image (mcr.microsoft.com/playwright) at the version in `apps/web/package-lock.json`, on the host network and with the job's Node, so no shard installs browsers or their system packages. `Web E2E tests` merges the shard reports, lists the tests that passed only on a retry in the run summary, and fails unless every shard passed.
- `Release main images`: on `main` only, after `CI` passed, retags `sha-<sha>` as `:main` with `.github/scripts/move-tag.sh` (`docker buildx imagetools create`, no rebuild), for each app whose flag is set, API before web. Runs are serialized with the `Release` workflow, and each app's `:main` only moves forward: it is retagged when the commit its current image was built from (`.github/scripts/released-revision.sh`) is an ancestor of this run's commit, and kept when a newer commit already released it. So while merges land faster than CI finishes, each green run whose commit is newer than `:main` advances it. A `:main` built from a commit that is neither an ancestor nor a descendant of this one (or without a revision label) fails the job; retag it by hand. A missing `:main` is created. An app a commit did not touch keeps its previous `:main` image.

## Release

Production deploys `:release` (`ops/README.md`). `.github/workflows/release.yml` (`Release`) moves each app's `:release` to the image its `:main` points at, API before web, every night at 02:23 UTC, and at once when run by hand: Actions → Release → Run workflow on `main`, or `gh workflow run release.yml --ref main`. A release ships everything merged since the previous one, and the run summary lists those commits per app. It uses `.github/scripts/move-tag.sh`, the same forward-only rule as `:main`: `:release` is kept when it is already newer, a `:release` off `main`'s history fails the run, and a `:main` built from a commit not on `main` is never released. Because `:main` only moves after `CI` passed, `:release` only ever points at green commits. The first run creates `:release`. GitHub pauses scheduled workflows after 60 days without repository activity, and may start a scheduled run late when it is busy.

## Rules

- Publish a tag that deployments track (`:main`, `:release`) only after `CI` passed; production deploys whatever `:release` points at, and `:release` follows `:main`.
- Image cleanup on a host must filter on `org.opencontainers.image.source` and pass `--all`; tagged leftovers are never dangling.

## ECB currencies

`.github/workflows/ecb-currencies.yml` runs `.github/scripts/ecb-currencies.mjs` monthly (and by hand from the Actions tab). The script rewrites `packages/contracts/src/ecb-currencies.ts` from the ECB's list of euro reference rates and prints what changed. It fails without writing on a reply it can't trust, including one that lacks a currency the table lists (the ECB keeps stopped currencies' series). When the table changed, the workflow opens a pull request from its own branch (`BRANCH` in the workflow), or updates the open one; each run rebuilds that branch from `main`, replacing anything pushed to it. It pushes and opens the pull request as the organization's `tempo-co ECB currencies` GitHub App (contents and pull-request write, installed on this repository only; client id in the repository variable `ECB_APP_CLIENT_ID`, private key in the secret `ECB_APP_PRIVATE_KEY`), because changes made with a workflow's own token start no other workflow, so CI would not run on the PR. The key does not expire; replace the secret only if it leaks. The workflow is separate from `CI/CD`, so an ECB outage fails only its own run.

## GHCR retention

`.github/workflows/ghcr-retention.yml` runs `ops/ghcr-retention.sh` weekly for both packages (see `ops/README.md`); it never deletes the images `:main` and `:release` point at. Scheduled runs only report until the repository variable `GHCR_RETENTION_DELETE` is `true`. Both packages are linked to this repository, which gives its workflows write and admin access; if that link is removed, image pushes and deletions fail with 403.
