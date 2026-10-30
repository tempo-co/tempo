# Transaction categorization

How AI categorization in `src/app/modules/banking/categorization/` and the subscription bridge in `claude-bridge/` fit together, and the rules that keep them safe. Configuration variables are in `src/app/core/config/config.schema.ts`.

## Record and lifecycle

PostgreSQL is the record; BullMQ only schedules work.

- Per row: `category` (nullable until a result is applied), `categoryStatus` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `NOT_APPLICABLE`), `categorySource` (`AI`, `HISTORY`, `MANUAL`), confidence, provider, model, prompt version, search trace, `categoryInputHash` and `categoryAppliedInputHash`.
- The input hash covers only classification-relevant fields. A provider upsert that changes references, balances or timestamps must not trigger a model call.

| Event | Effect |
|---|---|
| Authorization callback saves a connection or accounts | Nothing to categorize yet. |
| Sync inserts a transaction | Hash computed, row `PENDING`, enqueued after commit. |
| Sync upserts with the same input hash | Category kept, no AI work. |
| Sync changes a classification-relevant field | Hash updated, row back to `PENDING` unless `MANUAL`. |
| Row becomes an own transfer or currency exchange | `NOT_APPLICABLE`; never sent to the model. |
| Owner sets a category | `MANUAL`, applied hash = current hash, AI metadata cleared; later syncs never overwrite it. |

- Jobs carry transaction ids, never financial payloads. The worker claims `PENDING`/`FAILED` rows and every write is conditional on id, expected input hash and non-manual source, so a stale job cannot overwrite newer data.
- A database commit and a Redis enqueue are not atomic: the hourly reconciliation sweep re-enqueues rows still waiting.
- `NEEDS_REVIEW` is an ordinary category value meaning "purpose unknown or evidence conflicts". `OTHER` means a known kind of transaction outside the taxonomy. A provider or queue failure is neither: rows stay `PENDING`/`FAILED`.
- Never erase a completed category (including historical `OTHER`) in a response shim, sync reset or worker path; guard resets with the row's current status and hash.

## Merchant identity

`merchantKey` and `displayDescription` are derived from retained bank text at sync. A bare payment processor does not identify the business it collects for. A structured SEPA direct debit can supply that identity when its remittance begins with one explicitly named legal entity, bounded before the locality/reference tail, and its declared counterparty is absent or a processor. Display and key derivation share this evidence extractor; arbitrary notes, narrative remittances, multiple entities and a declared nonprocessor counterparty do not qualify.

The processor-collected-business refresh migration updates only these two derived columns for qualifying rows whose values differ. It leaves source text, categorization metadata and manual choices, owner decisions and unrelated rows unchanged, and neither enqueues categorization nor calls a provider. Repeating it writes nothing once the derived values match.

## Pipeline order

Read `categorizeClaimedBatch` before explaining a result.

1. **Manual-history hint.** The owner's `MANUAL` picks for the same `merchantKey` go to the model as `previousManualCategories` (counts plus a few recent examples). AI rows are never examples. `withoutOneOffChoices` drops a category picked exactly once when the merchant's other completed rows show a different category.
2. **Fixed rules** (`bank-transaction-category-rules.ts`) apply only when the merchant has no manual history.
3. **Standard pass**: one batched model call for the rest (`BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE` rows per job, processor concurrency 1).
4. **Web search** (when `AI_CATEGORIZATION_WEB_SEARCH_ENABLED`): one search per row, only for `OTHER`/`NEEDS_REVIEW` rows without manual history. A null `categorySearchTrace` on a row with history means search was skipped by design.

Outgoing payments to a person follow a fixed order, never `NEEDS_REVIEW`: a stated purpose → that category; otherwise at least two earlier same-amount, same-currency payments to that person with a manual or purpose-derived category → reuse it; otherwise `TRANSFER_OUT`. The amount matching happens in code (`sameAmountPayments`); the model only receives the matches. Money received from a person stays `TRANSFER_IN`.

## Routes and failure handling

The Anthropic API is tried first, then the host-side subscription bridge over a Unix socket (`AI_CATEGORIZATION_SUBSCRIPTION_SOCKET`). Result metadata names the route that answered (`claude-api` or `claude-subscription`). Never add a paid route after the subscription.

- **Standard pass** falls through to the bridge on any API error.
- **Search pass** falls back only when the API refused before running (`refusedBeforeRunning`), so a row is searched at most once per attempt. If the search could run on neither route the row stays `PENDING`; if it may have run, the row goes to `NEEDS_REVIEW` and is not retried.
- **Provider error mapping**: only bridge 404/409/415/503 and socket `ENOENT`/`ECONNREFUSED`/`EACCES` mean "unavailable". A timeout, an oversized reply, `ECONNRESET`, 400, 413 or 502 may follow a run and go to review.
- With no bridge configured, pend only on transient API refusals (401/403/429/529). A 400 the API always returns would otherwise pend forever.
- Throw the unavailable error only after completing the batch's other rows, so the retry picks up just the pending ones. Categorize jobs retry unavailable routes after 1, 2, 5, 10 and 20 minutes (`UNAVAILABLE_RETRY_DELAYS_MS`); after that the hourly sweep takes over.
- Construct the Anthropic SDK client with `logLevel: 'off'`, or `ANTHROPIC_LOG=debug` prints raw upstream bodies before the adapter sanitizes them.

## The bridge contract

`claude-bridge/contract.json` holds the prompt, schema, category enum and the allowed `models`/`efforts`. The API and the bridge both fingerprint `sha256(JSON.stringify(contract))` and the API sends it as `x-tempo-contract`; the bridge answers 409 on a mismatch. Fingerprint the parsed JSON, never file bytes: the built copy is formatted differently.

- Any change to `contract.json` (prompt, enum, models) changes the fingerprint. A bridge still running the old contract then refuses every fallback call, so the bridge must be reinstalled (root `ops/install.sh claude-bridge`) after the API that carries the new contract is deployed. A bridge change that leaves the contract alone can be installed first.
- A new bridge route gets its own contract file and fingerprint rather than a new section in `contract.json`, so existing routes keep working on a bridge that has not been reinstalled. Add the file to the `Dockerfile` and the root `ops/install.sh`, and pin in `bridge.test.mjs` that each route refuses the other's fingerprint.
- A prompt change bumps `BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION` (pinned in the service spec).
- `claude-bridge/validation.mjs` checks input keys exactly. A new input field or example key needs the validator and `bridge.test.mjs` updated in the same PR, or the fallback rejects every request that carries it. Also assert in the provider spec that the field reaches the serialized bridge request: an E2E that spies on `provider.categorize` passes even when the provider drops it.
- `AI_CATEGORIZATION_MODEL`/`AI_CATEGORIZATION_EFFORT` are validated against the contract lists at config load.

### Bridge status codes

- `503 claude_unavailable` only when nothing ran (subscription check failed, busy, unsafe init). `502 claude_failed` once the model called a tool or produced a result. A 503 for a post-run failure makes the API retry, and search, the same row again.
- The bridge accepts a run only if its `rate_limit_event` reports status `allowed` or `allowed_warning`, `isUsingOverage: false` and `overageStatus: rejected`; init must show no API key, exactly the expected tools and no MCP servers.
- Before each run it checks the plan (`/api/oauth/profile` organization type) and that extra usage is disabled (`/api/oauth/usage`); a pass is cached briefly (`createSubscriptionCheck`) because those endpoints rate-limit. Never gate on `subscriptionType` in the CLI credentials file or `claude auth status`. An expiring login is renewed with `claude doctor` (no inference).

### Bridge tests

- `node --test claude-bridge/*.test.mjs` (CI runs it). `fake-claude.mjs` has one mode per stream violation; add a mode for every new failure shape.
- When a check makes several HTTP calls, the fake takes settings per endpoint and each failure case asserts the call count, so a failure injected for the second call is not tripped by the first.
- To prove a new bridge test fails on the old source, run it under `timeout` with `--test-timeout`: an old bridge can leave requests hanging forever.

## Input privacy

- Send only redacted semantic fields: no account identifiers, balances, provider references or unbounded remittance. `sanitizeCategorizationText` strips labelled identifiers; test it at every serialized boundary (standard, search and fallback) with separators, label variants, mixed alphanumerics and the next label right after punctuation, and assert useful merchant text survives.
- Search queries use sanitized, normalized merchant text only, never IBANs, references, amounts or dates.
- Bank text is untrusted input; the contract tells the model to ignore instructions inside transaction fields.

## Applying a manual category

`updateCategory` → `setManualCategory` updates the one row and fans out only to the ids passed in `applyToTransactionIds`. A follow-up for those ids is retried via the queue if it fails. Anything that writes categories outside this path (scripts, migrations) must mirror its field resets exactly and leave non-selected rows alone.

## Tests

- E2E with the provider mocked at its boundary only: `enableAiCategorizationE2e()` / `enableAiCategorizationWebSearchE2e()` at module scope, `jest.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, ...)` before bootstrap, real queue, worker, database and HTTP. See `docs/provider-testing.md`.
- The provider spec pins the contract enums and limits against the app's own constants, and drives the bridge path against a loopback stub.
