# Wisp Agent Instructions

## Direction and workflow

- Wisp is for real users at any bank and in any country Enable Banking covers. Sign-up is open (`docs/adr/`).
- Automatic features use general, tested rules over stored transaction evidence, never hidden merchant or account exception lists. A user's own actions (category corrections, confirm or dismiss choices) are legitimate inputs.
- Commit messages follow Conventional Commits (`feat: ...`, `fix(web): ...`).
- A change that touches both apps is one PR: CI runs web E2E against the API image built from the same commit.
- Merging to `main` releases that night: CI tags the tested images of the apps that changed as `:main`, a nightly workflow (or a manual run on the owner's word) moves `:release` to the newest green `:main`, and production deploys `:release` within minutes. Keep `main` releasable at all times. Read `docs/ci-and-images.md` before touching workflows, Dockerfiles or image tags.

## Privacy

This repository and everything attached to it (commits, PRs, comments, CI logs, images) are public, and Wisp handles real bank data. Linear issues are private to the maintainer's workspace, so local paths, host names and links to the live app may go there; names, emails, transaction details, IBANs and card numbers may not.

- Never put real personal data in code, tests, fixtures, docs, commits, PR text or comments: names, emails, addresses, transaction details (merchants, amounts, dates, references), IBANs, card numbers, host names, IPs or home-directory paths.
- Use obviously fake values (`user@example.com`, "Example Shop", `example.ts.net`, published example IBANs such as `NL91ABNA0417164300`) and build fixtures from scratch. Refer to production rows by UUID only.
- If you find real personal data, stop and report it to a maintainer privately instead of fixing it in a PR: the diff would publish it again.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Docs

- Living docs (`README.md`, `AGENTS.md`, `docs/`, `ops/README.md`, each app's docs) state current durable facts: no dates, decision history or rename narration. Edit Markdown by hand.
- After any doc edit run `node .github/scripts/check-docs.mjs` (`git add` a new doc first); what it checks is in `docs/ci-and-images.md`.

## Agent skills

### Issue tracker

Issues live in the Linear project named Wisp; GitHub Issues are disabled. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, named as the roles. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md`, created when first needed, and `docs/adr/`. See `docs/agents/domain.md`.
