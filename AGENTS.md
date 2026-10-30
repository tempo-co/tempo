# Tempo Agent Instructions

Tempo is a personal-finance app that syncs real bank data through Enable Banking. This repository holds both apps and their deployment tooling.

## Layout

- `apps/api`: NestJS backend, plus the local MCP package (`apps/api/mcp`) and the Claude subscription bridge (`apps/api/claude-bridge`). Read `apps/api/AGENTS.md` before touching it.
- `apps/web`: React SPA. Read `apps/web/AGENTS.md` before touching it.
- `ops/`: deploy, install, backup and staging scripts, host units, the production and Tailscale Compose files. Read `ops/README.md` before touching it.
- `.github/`: one CI workflow for everything, GHCR retention and Dependabot. Read `docs/ci-and-images.md` before touching workflows, Dockerfiles or image tags.
- In task descriptions, “backend” means `apps/api` and “frontend” means `apps/web`.
- Each app has its own `package.json`, lockfile, ESLint and Prettier config (API: tabs; web: two spaces). Run npm commands inside the app directory and format only with that app's config. The apps share no code; web reaches the API only over HTTP.

## Product direction and workflow

- Tempo is personal-use-first, not a public multi-tenant SaaS. A private self-hosted production deployment exists; do not assume managed cloud services or public SaaS behavior.
- The intended deployment model is a self-hosted 24/7 instance using real bank data fetched through Enable Banking, with access from other devices. Keep that separate from local development and test environments.
- Personal-use-first is not permission for person-specific behavior. Automatic features use general, tested rules over stored transaction evidence, never hidden merchant or account exception lists. Owner actions (category corrections, confirm/dismiss choices) are legitimate inputs.
- Do not push directly to `main`; use a pull request with passing CI. Use Conventional Commit-style messages such as `feat: ...` and `fix: ...`.
- A change that touches both apps is one PR. CI runs web E2E against the API image built from the same commit, so an API contract change and the web code using it are tested together.
- Merging to `main` ships: CI tags the tested images of the apps that changed as `:main`, and production deploys `:main` within minutes.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs, images) are public. Tempo handles real bank data, so none of it may appear there.

- Never put real personal data in code, tests, fixtures, docs, commits, PR descriptions or comments: names, emails, addresses, locations, transaction details (merchants, amounts, dates, references), IBANs or card numbers, host names, IPs or home-directory paths.
- Use obviously fake values: `user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`.
- Build fixtures from scratch; never copy a real payload. Refer to production rows by UUID only.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Verification

- Size local verification to the change: run relevant static checks and focused tests, including regression proof where appropriate. Let PR CI run the full suites on fresh services. Run a full suite locally only for cross-cutting changes, gaps in CI, or failures requiring reproduction. A complete passing CI run on the current head is the delivery gate.
- Local test stacks use fixed container names and host ports and are shared by every worktree; each app's `AGENTS.md` says how to check for other stacks before starting or tearing one down.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Docs

Living docs (`README.md`, `AGENTS.md`, `docs/`, `ops/README.md`, each app's docs) state current durable facts: no dates, decision history or rename narration. Edit Markdown by hand.
