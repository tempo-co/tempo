# Transaction categorization

How AI categorization in `src/app/modules/banking/categorization/` and the subscription bridge in `claude-bridge/` fit together, and the rules that keep them safe. Configuration variables are in `src/app/core/config/config.schema.ts`.

## Record and lifecycle

PostgreSQL is the record; BullMQ only schedules work.

- Per row: `category` (nullable until a result is applied), `categoryStatus` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `NOT_APPLICABLE`), `categorySource` (`AI`, `HISTORY`, `MANUAL`), confidence, provider, model, prompt version, search trace, `categoryInputHash` and `categoryAppliedInputHash`.
- The input hash covers only classification-relevant fields: the input schema's fields minus the correlation id, the history hints and the dates, with the amount reduced to its sign. A provider upsert that changes references, balances, timestamps, dates or the size of the amount (a pending payment that books, a card hold that settles) must not trigger a model call. A fixed row's hash is pinned in the input spec.
- Sync decides whether a row's input changed by hashing the stored row and the incoming one with the current rules, never by comparing against the stored hash, so a change to what the hash covers re-queues nothing.

| Event                                                               | Effect                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization callback saves a connection or accounts               | Nothing to categorize yet.                                                                                                               |
| Sync inserts a transaction                                          | Hash computed, row `PENDING`, enqueued after commit.                                                                                     |
| Sync upserts with the same input hash                               | Category kept, no AI work.                                                                                                               |
| Sync changes a classification-relevant field                        | Hash updated, row back to `PENDING` unless `MANUAL`, keeping its category until the new one lands; a completed AI row is re-checked too. |
| Sync changes only dates, the amount's size or other unhashed fields | Category and status kept, no AI work.                                                                                                    |
| Row becomes an own transfer or currency exchange                    | `NOT_APPLICABLE`; never sent to the model.                                                                                               |
| Exchange recompute finds a row is no longer an exchange             | Back to `PENDING` unless `MANUAL`, enqueued after commit.                                                                                |
| Owner sets a category                                               | `MANUAL`, applied hash = current hash, AI metadata cleared; later syncs never overwrite it.                                              |

- Jobs carry transaction ids, never financial payloads. The worker claims a job's `PENDING`/`FAILED` rows in one guarded update and every write is conditional on id, expected input hash and non-manual source, so a stale job cannot overwrite newer data.
- A row keeps its category, even one given for an older input, until a new one is applied: a claim never clears it and a failed call leaves it in place.
- A `PROCESSING` claim older than 15 minutes counts as abandoned and can be claimed again. The worker renews the claims of the rows still waiting before every model call after the first, so a batch that runs many calls for longer than that is never taken by a second worker or replica.
- A database commit and a Redis enqueue are not atomic: the hourly reconciliation sweep re-enqueues rows still waiting.
- `NEEDS_REVIEW` is an ordinary category value meaning "purpose unknown or evidence conflicts". `OTHER` means the evidence names a kind of spending no category covers; a merchant known only by its name, with nothing that pins down what it sells, is `NEEDS_REVIEW`. A provider or queue failure is neither: rows stay `PENDING`/`FAILED`.
- Never erase a completed category (including historical `OTHER`) in a response shim, sync reset or worker path; guard resets with the row's current status and hash.

## Merchant identity

`merchantKey` and `displayDescription` are derived from retained bank text at sync. A bare payment processor does not identify the business it collects for. A structured SEPA direct debit can supply that identity when its remittance begins with one explicitly named legal entity, bounded before the locality/reference tail, and its declared counterparty is absent or a processor. Display and key derivation share this evidence extractor; arbitrary notes, narrative remittances, multiple entities and a declared nonprocessor counterparty do not qualify.

The counterparty name comes only from the party the direction names, never from the opposite party, which may be the account holder (`banking-invariants.md`, provider field normalization). So debits without a named payee (fees, cash withdrawals) are keyed by their own bank text. The account-holder counterparty migration clears stored names recognizably taken from the wrong party (the account's holder name on a row that is not an own transfer, any name on a row without a direction) and descriptions that only copy the name, then derives these two columns again. It leaves categories, their hashes, manual choices and owner decisions unchanged and enqueues nothing; a changed non-manual row is recategorized only when a later sync fetches it again.

The processor-collected-business refresh migration updates only these two derived columns for qualifying rows whose values differ. It leaves source text, categorization metadata and manual choices, owner decisions and unrelated rows unchanged, and neither enqueues categorization nor calls a provider. Repeating it writes nothing once the derived values match.

## Pipeline order

Read `CategorizationPipeline` before explaining a result. The categorization module splits into `CategorizationScheduler` (enqueue, job ids, retry delays, reconciliation), `CategorizationRowStore` (claim, guarded writes), `CategorizationContextLoader` (manual history, same-amount payments), `ManualCategoryService` (preview, manual category, follow-up) and `CategorizationPipeline` (the job itself).

Own transfers and currency exchanges never reach the model, and `MANUAL` rows are never claimed or overwritten. Every other row goes to the model with its full sanitized input and the owner's history; there are no fixed rules and no second pass.

1. **History hints.** The owner's `MANUAL` picks for the same `merchantKey` go to the model as `previousManualCategories`: every category with its raw count and a few recent examples (amount, currency, date, sanitized note), one-off picks included, for the model to weigh. AI rows are never examples there. Outgoing payments also get `sameAmountPayments` (below).
2. **One call per row group** (`BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE` rows per job, processor concurrency 1). With `AI_CATEGORIZATION_WEB_SEARCH_ENABLED`, the rows of a batch that allow the same search query (`toCategorizationSearch`: the same sanitized merchant name and location) form one group, and rows without merchant text share one group without search. Without it, the whole batch is one call without search.
3. **Optional search inside the call, on the bridge only.** On the subscription bridge, a group's call may run one web search with exactly the code-built query, or skip it; the prompt tells the model to search only when the merchant's business is unknown and the evidence and history don't settle the category, and never for a person. The API route never offers a search (below), so rows its evidence and history can't settle go to `NEEDS_REVIEW`. `categorySearchTrace` is set only when a search ran, and records the pinned query. A result that names only a payment processor, terminal provider or acquirer is not evidence of what was bought.

Outgoing payments to a person follow a fixed order, never `NEEDS_REVIEW`: goods or a purpose named in the text → that category (a gift, birthday or present → `GIFTS_AND_DONATIONS`); otherwise owner picks for that payee that all name one category (other than `TRANSFER_OUT`) → that category, unless the payment's amount or note clearly differs; otherwise at least two earlier same-amount, same-currency payments to that person with a manual or purpose-derived category → reuse it; otherwise `TRANSFER_OUT`. Mixed owner picks for one person decide nothing. The amount matching happens in code (`sameAmountPayments`); the model only receives the matches. Money received from a person stays `TRANSFER_IN`.

## Routes and failure handling

The Anthropic API is tried first, then the host-side subscription bridge over a Unix socket (`AI_CATEGORIZATION_SUBSCRIPTION_SOCKET`). Result metadata names the route that answered (`claude-api` or `claude-subscription`). Never add a paid route after the subscription.

- A call falls through to the bridge on any API error, with or without a search allowed; only the bridge request carries the group's `searchQuery`.
- **Failure rule** (`routesFailed`): a call with no usable answer leaves its rows `PENDING` (the unavailable error) only when nothing ran and a retry can succeed: the bridge refused before running, or, with no bridge configured, the API refused transiently (401/403/429/529). Anything else may have run or would fail the same way again (a truncated or invalid reply, an API 400, bridge 400/413/502, a timeout) and is a retryable provider error. A call the API may have run fails the same way when the bridge then refuses, so a waiting bridge never repeats it. Merchant identification (`identifyMerchants`) keeps its own failure rule.
- The API cannot hold the model to the code-built query before a server-side search runs, and the full-context input could leak into a query the model writes itself, so the API request offers no tools and omits `searchQuery`; a reply that used a tool anyway fails the call. On the bridge, `search-hook.mjs` allows only the pinned query.
- **Provider error mapping**: only bridge 404/409/415/503 and socket `ENOENT`/`ECONNREFUSED`/`EACCES` mean "unavailable". A timeout, an oversized reply, `ECONNRESET`, 400, 413 or 502 may follow a run.
- A provider error marks that group's rows `FAILED` and the batch's other groups still run; the job then retries the failed rows twice within seconds, after which a row waits for the next start's sweep, never the hourly one. The provider validates every reply once (ids, categories, confidence, evidence type, search trace) and reports an invalid one as that retryable error; the pipeline trusts what it returns.
- Once a call is unavailable on both routes, the batch's remaining groups are not sent: their rows stay `PENDING` and the job throws the unavailable error after completing the groups that answered, so the retry picks up just the pending ones. Categorize jobs retry unavailable routes after 1, 2, 5, 10 and 20 minutes (`UNAVAILABLE_RETRY_DELAYS_MS`); after that the hourly sweep takes over.
- A call allows 16k output tokens: adaptive thinking shares the budget with a reply for up to 50 rows, and a reply cut off at the limit fails the group.
- Construct the Anthropic SDK client with `logLevel: 'off'`, or `ANTHROPIC_LOG=debug` prints raw upstream bodies before the adapter sanitizes them.

## The bridge contract

`claude-bridge/contract.json` holds the prompt, schema, category and evidence-type enums, the search limits and the allowed `models`/`efforts`. The bridge's `/categorize` route runs without tools, or with `WebSearch` behind the pinned-query hook when the request carries `searchQuery`, and replies with `searched` and the result's source hostnames. The API and the bridge both fingerprint `sha256(JSON.stringify(contract))` and the API sends it as `x-tempo-contract`; the bridge answers 409 on a mismatch. Fingerprint the parsed JSON, never file bytes: the built copy is formatted differently.

- Any change to `contract.json` (prompt, enum, models) changes the fingerprint. A bridge still running the old contract then refuses every fallback call, so the bridge must be reinstalled (root `ops/install.sh claude-bridge`) after the API that carries the new contract is deployed. A bridge change that leaves the contract alone can be installed first.
- A new bridge route gets its own contract file and fingerprint rather than a new section in `contract.json`, so existing routes keep working on a bridge that has not been reinstalled. Add the file to the `Dockerfile` and the root `ops/install.sh`, and pin in `bridge.test.mjs` that each route refuses the other's fingerprint.
- A prompt change bumps `BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION` (pinned in the service spec).
- Category values, labels and the descriptions the model reads as boundaries live in `@tempo/contracts` (`categories.ts`). `category` is a plain `varchar(32)` column, so a new category needs no migration, but it changes the contract's enums (regenerate with `npm run contract:input`), so it follows the rollout order above. The web app needs its label, icon and color tokens (`bank-transaction-category-meta.ts`, `src/index.css`); totals, the breakdown and MCP's `list_categories` read the values from the contracts package. Stored rows keep their category until something re-checks them.
- The input a transaction sends to the model is defined once, in `bank-transaction-categorization-input.schema.ts` (zod). It yields the TypeScript types, the fields the provider serializes and the input hash's fields. `npm run contract:input` writes its JSON Schema into `contract.json` (`input.transaction`, `input.searchQuery`), which `claude-bridge/validation.mjs` checks requests against exactly; the provider spec fails while the two differ. A new input field is a schema edit plus a regenerated contract, so it changes the fingerprint and follows the rollout order above. Also assert in the provider spec that the field reaches the serialized bridge request: an E2E that spies on `provider.categorize` passes even when the provider drops it.
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
- Search queries are built in code from sanitized, normalized merchant text only, never IBANs, references, amounts or dates; the model may only run that query or none.
- Bank text is untrusted input; the contract tells the model to ignore instructions inside transaction fields.

## Applying a manual category

`updateCategory` → `setManualCategory` updates the one row and fans out only to the ids passed in `applyToTransactionIds`. A follow-up for those ids is retried via the queue if it fails. Anything that writes categories outside this path (scripts, migrations) must mirror its field resets exactly and leave non-selected rows alone.

## Tests

- E2E with the provider mocked at its boundary only: `enableAiCategorizationE2e()` / `enableAiCategorizationWebSearchE2e()` at module scope, `jest.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, ...)` before bootstrap, real queue, worker, database and HTTP. See `docs/provider-testing.md`.
- The provider spec pins the contract enums and limits against the app's own constants, and drives the bridge path against a loopback stub.
