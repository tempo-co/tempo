# Testing external providers

Enable Banking and Claude are paid, credentialed or privacy-sensitive. Automated tests never reach them.

## Rules

- **Off by default.** AI categorization and web search are off in `.env.development`, `.env.test` and the shared E2E setup. A spec that needs them opts in through `test/setup/e2e.setup.ts` (`enableAiCategorizationE2e()` at module scope, before the app boots), not through a second env file, Jest config, npm script or CI job.
- **Synthetic credentials only.** The opt-in sets `ANTHROPIC_API_KEY=test-only-placeholder`. Never read, forward or require a real key in development or tests.
- **Mock only the provider boundary.** Keep schema, persistence, queue, worker, retries, routes, auth, DTOs and ownership real. Spy on every provider method the path uses (`categorize`, `categorizeWithWebSearch`) before bootstrap, so startup reconciliation cannot reach the network.
- **Deterministic doubles.** Return schema-valid results keyed by the input correlation ids, with categories from the real catalog and bounded confidence.
- **Both suites.** The default suite proves the feature is off and the provider is never called; the opted-in suite proves orchestration and persistence end to end.
- **Adapter tests separately.** Test the concrete provider against a mocked transport or loopback server that matches the real schema: malformed, incomplete, duplicate and out-of-domain responses.
- **Real infrastructure for diagnosis.** Query-builder mocks hide identifier quoting, column widths, races and affected-row guards. Fix the SQL or schema rather than weakening the test.
- **Outbound privacy.** Write adversarial synthetic fixtures before changing sanitization and assert on the serialized request (standard, search and fallback).
- **Cost limits are enforced in code.** Assert at most one provider request per candidate (e.g. one search per unresolved row). A batch size, prompt wording or a provider flag is not a cap.
- **Separate gates.** The API route succeeding does not verify the bridge route, and a refusal verifies failure handling, not a successful fallback. Rows inserted by direct SQL bypass enqueue hooks; pending rows with no jobs mean the provider path never ran.
- **Accuracy is a separate claim.** Schema validity and model confidence say nothing about correctness.

## Recipe: one vertical path

1. Read the provider interface, queue/worker path, config defaults and persistence; pick the smallest boundary to mock.
2. Write a failing E2E: synthetic fixture (`BankingFixtures`), real enqueue, real worker, mocked provider, real database, authenticated HTTP read.
3. Add provider-failure and manual-override race cases.
4. Before promising automatic recovery, trace the stored failure status through queue-attempt exhaustion and the reconciliation sweep's selection predicate; a retryable error is useless if the worker stores a status the sweep skips.

## Diagnosing a failing provider E2E

1. Check the queue's added/active/completed/failed events.
2. Read the row back (status, input hash, applied hash, source, last error).
3. Re-run the guarded SQL against real PostgreSQL; quote camelCase columns.
4. Compare stored metadata lengths (prompt version, model) with the column widths in the migrations.
5. Check affected-row guards and expected statuses before touching retries or timeouts.

Never replace the queue or repository with mocks to make it pass.

## Provider qualification

Before adding a bank-data provider or institution, separate sandbox from production: confirm live entitlement, the exact institution/entity, AIS capabilities, licensing model, consent lifetime and every fee. A free developer account proves none of these. For a missing bank, check the provider-wide catalog and then the application's own ASPSP list with the canonical ISO country code (`GB`, not `UK`); an empty answer is a scope or entitlement signal, not an outage. Keep a second provider behind an adapter with its own identifiers and encrypted consent references; do not reuse fields whose semantics belong to Enable Banking.
