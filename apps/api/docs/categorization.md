# Transaction categorization

How AI categorization in `src/app/modules/banking/categorization/` works, and the rules that keep it safe. Configuration variables are in `src/app/core/config/config.schema.ts`.

## Record and lifecycle

PostgreSQL is the record; BullMQ only schedules work.

- Per row: `category` (nullable until a result is applied), `categoryStatus` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `NOT_APPLICABLE`), `categorySource` (`AI`, `HISTORY`, `MANUAL`), confidence, provider, model, prompt version, search trace, `categoryInputHash` and `categoryAppliedInputHash`.
- The input hash covers only classification-relevant fields: the input schema's fields minus the correlation id, the hints (the owner's bank and history) and the dates, with the amount reduced to its sign. A provider upsert that changes references, balances, timestamps, dates or the size of the amount (a pending payment that books, a card hold that settles) must not trigger a model call. A fixed row's hash is pinned in the input spec.
- Sync decides whether a row's input changed by hashing the stored row and the incoming one with the current rules, never by comparing against the stored hash, so a change to what the hash covers re-queues nothing.

| Event                                                               | Effect                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization callback saves a connection or accounts               | Nothing to categorize yet.                                                                                                               |
| Sync inserts a transaction                                          | Hash computed, row `PENDING`, enqueued after commit.                                                                                     |
| Sync upserts with the same input hash                               | Category kept, no AI work.                                                                                                               |
| Sync changes a classification-relevant field                        | Hash updated, row back to `PENDING` unless `MANUAL`, keeping its category until the new one lands; a completed AI row is re-checked too. |
| Sync changes only dates, the amount's size or other unhashed fields | Category and status kept, no AI work.                                                                                                    |
| Row becomes an own transfer                                         | `COMPLETED` as `TRANSFER_IN` or `TRANSFER_OUT` by direction, set by the own-transfer rule without a model call; a manual category is kept. A row that stops being one goes back to `PENDING` with no category, enqueued after commit. |
| Row becomes a currency exchange                                     | `NOT_APPLICABLE`; never sent to the model.                                                                                               |
| Exchange recompute finds a row is no longer an exchange             | Back to `PENDING` unless `MANUAL`, enqueued after commit.                                                                                |
| User sets a category                                               | `MANUAL`, applied hash = current hash, AI metadata cleared; later syncs never overwrite it.                                              |

- The worker claims a job's `PENDING`/`FAILED` rows in one guarded update and every write is conditional on id, expected input hash and non-manual source, so a stale job cannot overwrite newer data.
- A row keeps its category, even one given for an older input, until a new one is applied: a claim never clears it and a failed call leaves it in place.
- A `PROCESSING` claim older than 15 minutes counts as abandoned and can be claimed again. The worker renews the claims of the rows still waiting before every model call after the first, so a batch that runs many calls for longer than that is never taken by a second worker or replica.
- A database commit and a Redis enqueue are not atomic: the hourly reconciliation sweep re-enqueues rows still waiting, including rows written without an enqueue.
- A categorize job's id hashes its row ids and input hashes. Finished and failed categorize jobs are removed, so an identical batch is dropped only while its job is still waiting, delayed or active.
- `NEEDS_REVIEW` is an ordinary category value meaning "purpose unknown, evidence conflicts, or no category covers it", including a merchant known only by name. A provider or queue failure is not a category: rows stay `PENDING`/`FAILED`.
- Never erase a completed category (including one the list no longer has) in a response shim, sync reset or worker path; guard resets with the row's current status and hash.

## Merchant identity

`merchantKey` and `displayDescription` are derived from retained bank text at sync. A bare payment processor does not identify the business it collects for. A structured SEPA direct debit can supply that identity when its remittance begins with one explicitly named legal entity, bounded before the locality/reference tail, and its declared counterparty is absent or a processor. Display and key derivation share this evidence extractor; arbitrary notes, narrative remittances, multiple entities and a declared nonprocessor counterparty do not qualify.

The counterparty name comes only from the party the direction names, never from the opposite party, which may be the account holder (`banking-invariants.md`, provider field normalization). So debits without a named payee (fees, cash withdrawals) are keyed by their own bank text.

## Pipeline order

Read `CategorizationPipeline` before explaining a result. The categorization module splits into `CategorizationScheduler` (enqueue, job ids, retry delays, reconciliation), `CategorizationRowStore` (claim, guarded writes), `CategorizationContextLoader` (manual history, payment history), `ManualCategoryService` (preview, manual category, follow-up) and `CategorizationPipeline` (the job itself).

Own transfers and currency exchanges never reach the model, and `MANUAL` rows are never claimed or overwritten. Every other row goes to the model with its full sanitized input and the user's history; there are no fixed rules for the model's choice and no second pass.

1. **Hints.** Every row carries `ownerBank`: its bank connection's name and country, never the holder's name. The user's `MANUAL` picks for the same `merchantKey` go to the model as `previousManualCategories`: every category with its raw count and a few recent examples (amount, currency, date, sanitized note), one-off picks included, for the model to weigh. AI rows are never examples there. Outgoing payments also get `sameAmountPayments` (below). `counterpartyHistory` lists the owner's earlier `COMPLETED` payments with the same counterparty (equal `counterpartyIban`, or the same merchant name in either direction; an IBAN the owner's rows show under 2+ merchant names is a processor's and does not match) from the 24 months before the row, own transfers and financial events excluded: the 6 newest in the row's direction and the 4 newest in the other, with date, amount, currency, direction and category, minus rows in its `sameAmountPayments`. Rows in unlisted categories give no hint. A failed lookup drops only its own hints.
2. **One call per row group** (`BANK_TRANSACTION_CATEGORIZATION_BATCH_SIZE` rows per job, processor concurrency 1). With `AI_CATEGORIZATION_WEB_SEARCH_ENABLED`, the rows of a batch that allow the same search query (`toCategorizationSearch`: the same sanitized merchant name and location) form one group, and rows without merchant text share one group without search. Without it, the whole batch is one call without search.
3. **Merchant lookup.** Every answer carries `lookUpMerchant`: the model sets it when the group is paid to or from a business it cannot identify with certainty, and leaves it false for a private person, a business it knows, or evidence that already decides. When it is set, or an outgoing card-payment group comes back `NEEDS_REVIEW`, and the group has a search query and no row is `TRANSFER_IN` or `TRANSFER_OUT` (a person's name never goes to the search API), code sends only that query, from the rows' shared bank country if Brave supports it, to the Brave Search API (`BraveWebSearchClient`, `BRAVE_SEARCH_API_KEY`), and a second categorizing call receives the top 5 results (title, hostname, snippet up to 500 characters) as `merchantSearch`; its answer is stored. A failed search (HTTP error, no credit, timeout) is logged with its status only; an empty one shows only in the client's result count. Either way the first answer stands. A failed second call fails the group like any other call.

   `categorySearchTrace` is set only when results reached the second call, and records the query and the result hostnames. Snippets are never stored, and there is no cache across batches: Brave's Search plan grants no storage rights, and rows of one batch that share a query share one search. A result that names only a payment processor, terminal provider or acquirer is not evidence of what was bought.

Outgoing payments to a person are `NEEDS_REVIEW` only when the text names a purpose no category covers; otherwise they follow a fixed order: goods or a purpose named in the text → that category (a gift, birthday or present → `GIFTS_AND_DONATIONS`); otherwise user picks for that payee that all name one category (other than `TRANSFER_OUT`) → that category, unless the payment's amount or note clearly differs; otherwise at least two earlier same-amount, same-currency payments to that person with a manual or purpose-derived category → reuse it; otherwise `TRANSFER_OUT`. Mixed user picks for one person decide nothing. The amount matching happens in code (`sameAmountPayments`); the model only receives the matches. Money received from a person stays `TRANSFER_IN`.

Money received from a government (an income tax refund, an allowance, a benefit) is `INCOME`. It is `REFUND` only when `counterpartyHistory` lists an earlier payment to that government body that it pays back, such as an overpaid municipal tax bill or a cancelled fine. Income tax is mostly withheld from salary and never shows as spending, so calling its refund `REFUND` would reduce spending that was never counted. The contract instructions carry the listed-payment condition; the `INCOME`, `REFUND` and `TAXES_AND_GOVERNMENT` descriptions in `packages/contracts/src/categories.ts` carry the general boundary.

## Calls and failure handling

Every model call goes to the Anthropic API with `ANTHROPIC_API_KEY`. Result metadata records `claude-api` and the configured model.

- **Failure rule** (`callFailed`): a call with no usable answer leaves its rows `PENDING` (the unavailable error) only when the API refused it before running, for a reason that clears without a code change: 401, 403, 429, 529, 402 or a `billing_error`, a 400 whose message says the credit balance is too low, or a connection error other than a timeout (usually a connection that never opened). Anything else may have run or would fail the same way again (a truncated or invalid reply, any other 400, 404, 413, 5xx other than 529, a timeout) and is a retryable provider error. An exhausted credit balance therefore never fails a row or turns it into `NEEDS_REVIEW`. Merchant identification (`identifyMerchants`) uses the same rule.
- The API cannot hold the model to the code-built query before a server-side search runs, and the full-context input could leak into a query the model writes itself, so the categorizing request offers no server tool and never carries the query; a reply that ran one anyway fails the call. Code runs the only search, with the code-built query.
- The categorizing call returns its answer as the input of a `StructuredOutput` tool carrying the contract schema, which Tempo reads and never runs; the reply must stop with `tool_use` after exactly one call to it, and the input goes through the same validation. It does not use a strict `output_config.format` json_schema: with one, the model often skips thinking and sends well-known merchants to review. The tool choice is `auto` (with parallel calls off) and the tool description asks for one call: the API rejects a forced tool choice with adaptive thinking. Merchant identification keeps the json_schema format.
- A provider error marks that group's rows `FAILED` and the batch's other groups still run; the job then retries the failed rows twice within seconds, after which a row waits for the next start's sweep, never the hourly one. The provider validates every reply once (ids, categories, confidence, evidence type, search trace) and reports an invalid one as that retryable error; the pipeline trusts what it returns.
- Once a call is unavailable, the batch's remaining groups are not sent: their rows stay `PENDING` and the job throws the unavailable error after completing the groups that answered, so the retry picks up just the pending ones. Categorize jobs retry an unavailable API after 1, 2, 5, 10 and 20 minutes (`UNAVAILABLE_RETRY_DELAYS_MS`); after that the hourly sweep takes over.
- A call allows 16k output tokens: adaptive thinking shares the budget with a reply for up to 50 rows, and a reply cut off at the limit fails the group.
- The categorizing call caches its prompt start for five minutes: tools, then the system prompt's two text blocks (instructions, category definitions as JSON) with the breakpoint on the last. The prefix must stay byte-identical; the user message carries only per-request data (`transactions`, and `merchantSearch` on the call after a lookup). Other calls are not cached.
- Construct the Anthropic SDK client with `logLevel: 'off'`, or `ANTHROPIC_LOG=debug` prints raw upstream bodies before the adapter sanitizes them.
- Each API reply logs its token counts, never content.

## The contract

`src/app/modules/banking/categorization/providers/claude-categorization-contract.json` holds the prompt, schema, category and evidence-type enums, the search limits, the allowed `efforts` and the request schemas (`input`). Merchant identification's prompt and schema are in `src/app/modules/banking/categorization/providers/claude-merchant-contract.json`. Both are imported by the provider, so the build copies them into `dist/`.

- The instructions are Markdown sections; `lookUpMerchant`, `confidence` and `evidenceType` are explained in the schema.
- A prompt change bumps `BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION`, which the provider spec pins to a hash of the requests it builds.
- Category values, labels and the boundary descriptions the model reads live in `@tempo/contracts` (`packages/contracts/src/categories.ts`). `category` is a plain `varchar(32)` column, so a new category needs no migration, but changes the contract's enums: `npm run contract:input` regenerates them. The web app needs its label, icon and color tokens (`apps/web/src/features/banking/utils/bank-transaction-category-meta.ts`, `apps/web/src/index.css`); totals, the breakdown and MCP's `list_categories` read the contracts package. Stored rows keep their category until re-checked.
- The input a transaction sends to the model is defined once, in `src/app/modules/banking/categorization/bank-transaction-categorization-input.schema.ts` (zod). It yields the TypeScript types, the fields the provider serializes and the input hash's fields. `npm run contract:input` writes its JSON Schema into the contract (`input.transaction`, `input.searchQuery`, `input.merchantSearch`); the provider spec fails while the two differ. Also assert in the provider spec that the field reaches the serialized API request: an E2E that spies on `provider.categorize` passes even when the provider drops it.
- `AI_CATEGORIZATION_MODEL` and `_EFFORT` default to Haiku at `xhigh` (merchant identification: merchant-logos.md). An effort outside the contract's `efforts` fails config load.

## Input privacy

- Send only redacted semantic fields: no account identifiers, balances, provider references or unbounded remittance. `sanitizeCategorizationText` strips labelled identifiers; test it at every serialized boundary (the categorizing request and the search query) with separators, label variants, mixed alphanumerics and the next label right after punctuation, and assert useful merchant text survives.
- A long opaque identifier becomes `[REDACTED]`, keeping only a glued leading word of one capital and three or more lower-case letters (`ExampleREF0012345` becomes `Example [REDACTED]`). A merchant glued to an ID in capitals reaches the model nameless.
- Search queries are built in code from sanitized, normalized merchant text only, never IBANs, references, amounts or dates. The search API receives nothing but that query.
- Bank text is untrusted input; the contract tells the model to ignore instructions inside transaction fields.

## Applying a manual category

How a correction reaches other rows, and the rules for every other path that writes categories, are in `docs/derived-data-writes.md`.

## Tests

- E2E with the provider mocked at its boundary only: `enableAiCategorizationE2e()` / `enableAiCategorizationWebSearchE2e()` at module scope, `jest.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, ...)` before bootstrap, real queue, worker, database and HTTP. See `docs/provider-testing.md`.
- The provider spec pins the contract enums and limits against the app's own constants, and drives every failure class through a mocked Anthropic client.
