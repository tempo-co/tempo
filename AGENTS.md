# Tempo Agent Instructions

## Direction and workflow

- Tempo is for real users at any bank and in any country Enable Banking covers. Sign-up is open, and every merge to `main` deploys (`docs/adr/`).
- Automatic features use general, tested rules over stored transaction evidence, never hidden merchant or account exception lists. Owner actions (category corrections, confirm or dismiss choices) are legitimate inputs.
- Commit messages follow Conventional Commits (`feat: ...`, `fix(web): ...`).
- A change that touches both apps is one PR: CI runs web E2E against the API image built from the same commit.
- Merging to `main` ships: CI tags the tested images of the apps that changed as `:main`, and production deploys `:main` within minutes. Read `docs/ci-and-images.md` before touching workflows, Dockerfiles or image tags.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs, images) are public, and Tempo handles real bank data.

- Never put real personal data in code, tests, fixtures, docs, commits, PR text or comments: names, emails, addresses, transaction details (merchants, amounts, dates, references), IBANs, card numbers, host names, IPs or home-directory paths.
- Use obviously fake values (`user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`) and build fixtures from scratch. Refer to production rows by UUID only.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Docs

- Living docs (`README.md`, `AGENTS.md`, `docs/`, `ops/README.md`, each app's docs) state current durable facts: no dates, decision history or rename narration. Edit Markdown by hand.
- After any doc edit run `node .github/scripts/check-docs.mjs`. It fails CI on a backticked path that is not tracked, an unknown `npm run` script or a doc over its word budget, so `git add` a new doc before running it.

## Agent skills

### Issue tracker

Issues live in the Linear project named Tempo; GitHub Issues are disabled. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, named as the roles. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md`, created when first needed, and `docs/adr/`. See `docs/agents/domain.md`.
