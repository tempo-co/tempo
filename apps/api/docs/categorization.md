# Transaction categorization

How AI categorization in `src/app/modules/banking/categorization/` works, and the rules that keep it safe. Configuration variables are in `src/app/core/config/config.schema.ts`.

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
3. **Merchant search.** A group with a search query gets one web search at most, in a separate call before the categorizing one. That call receives only the code-built query (no transaction text, amounts, history or other names) and the web search tool limited to one use. It skips the search for a private person's name or a business it knows for certain, and otherwise returns a short finding (`identifies`: `BUSINESS`, `PAYMENT_PROCESSOR`, `PERSON` or `NOTHING`, plus a description of a business). Only a finding from a search that ran and identified a business or payment processor is passed on, as `searchFinding` beside the transactions, to the categorizing call, which offers no tools. `PERSON` and `NOTHING` are not passed on: results for a name can be about anyone sharing it. A failed search (any error, an invalid or cut-off reply, a tool error) is logged and the group is categorized without a finding.

   `categorySearchTrace` is set only when a search ran, and records the query that ran and the result hostnames. A result or finding that names only a payment processor, terminal provider or acquirer is not evidence of what was bought. There is no cache across batches: rows of one batch that share a query share one search, and each search is paid per call.

Outgoing payments to a person follow a fixed order, never `NEEDS_REVIEW`: goods or a purpose named in the text → that category (a gift, birthday or present → `GIFTS_AND_DONATIONS`); otherwise owner picks for that payee that all name one category (other than `TRANSFER_OUT`) → that category, unless the payment's amount or note clearly differs; otherwise at least two earlier same-amount, same-currency payments to that person with a manual or purpose-derived category → reuse it; otherwise `TRANSFER_OUT`. Mixed owner picks for one person decide nothing. The amount matching happens in code (`sameAmountPayments`); the model only receives the matches. Money received from a person stays `TRANSFER_IN`.

Money received from a government (an income tax refund, an allowance, a benefit) is `INCOME`. It is `REFUND` only when it pays back a payment the owner made from their account, such as an overpaid municipal tax bill or a cancelled fine. Income tax is mostly withheld from salary and never shows as spending, so calling its refund `REFUND` would reduce spending that was never counted. The `INCOME`, `REFUND` and `TAXES_AND_GOVERNMENT` descriptions in `categories.ts` carry this boundary to the model.

## Calls and failure handling

Every model call goes to the Anthropic API with `ANTHROPIC_API_KEY`; there is no other route. Result metadata records `claude-api` and the configured model. Rows categorized by the removed subscription bridge keep `claude-subscription` as their provider.

- **Failure rule** (`callFailed`): a call with no usable answer leaves its rows `PENDING` (the unavailable error) only when the API refused it before running, for a reason that clears without a code change: 401, 403, 429, 529, 402 or a `billing_error`, a 400 whose message says the credit balance is too low, or a connection that never opened. Anything else may have run or would fail the same way again (a truncated or invalid reply, any other 400, 404, 413, 5xx other than 529, a timeout) and is a retryable provider error. An exhausted credit balance therefore never fails a row or turns it into `NEEDS_REVIEW`. Merchant identification (`identifyMerchants`) uses the same rule.
- The API cannot hold the model to the code-built query before a server-side search runs, and the full-context input could leak into a query the model writes itself, so the categorizing request offers no tools and never carries the query; a reply that used a tool anyway fails the call. The searching request carries the query and nothing else, so any query its model writes can only restate it; the provider spec pins its whole request body.
- A provider error marks that group's rows `FAILED` and the batch's other groups still run; the job then retries the failed rows twice within seconds, after which a row waits for the next start's sweep, never the hourly one. The provider validates every reply once (ids, categories, confidence, evidence type, search trace) and reports an invalid one as that retryable error; the pipeline trusts what it returns.
- Once a call is unavailable, the batch's remaining groups are not sent: their rows stay `PENDING` and the job throws the unavailable error after completing the groups that answered, so the retry picks up just the pending ones. Categorize jobs retry an unavailable API after 1, 2, 5, 10 and 20 minutes (`UNAVAILABLE_RETRY_DELAYS_MS`); after that the hourly sweep takes over.
- A call allows 16k output tokens: adaptive thinking shares the budget with a reply for up to 50 rows, and a reply cut off at the limit fails the group.
- Construct the Anthropic SDK client with `logLevel: 'off'`, or `ANTHROPIC_LOG=debug` prints raw upstream bodies before the adapter sanitizes them.

## The contract

`providers/claude-categorization-contract.json` holds the prompt, schema, category and evidence-type enums, the search limits, the merchant search's prompt and schema (`search.instructions`, `search.schema`), the allowed `efforts` and the request schemas (`input`). Merchant identification's prompt and schema are in `providers/claude-merchant-contract.json`. Both are imported by the provider, so the build copies them into `dist/`.

- The categorization prompt still describes a `searchQuery` the API never sends, left from the bridge; removing it is a prompt change and needs its own evaluation.
- A prompt change bumps `BANK_TRANSACTION_CATEGORIZATION_PROMPT_VERSION` (pinned in the service spec).
- Category values, labels and the descriptions the model reads as boundaries live in `@tempo/contracts` (`categories.ts`). `category` is a plain `varchar(32)` column, so a new category needs no migration, but it changes the contract's enums (regenerate with `npm run contract:input`). The web app needs its label, icon and color tokens (`bank-transaction-category-meta.ts`, `src/index.css`); totals, the breakdown and MCP's `list_categories` read the values from the contracts package. Stored rows keep their category until something re-checks them.
- The input a transaction sends to the model is defined once, in `bank-transaction-categorization-input.schema.ts` (zod). It yields the TypeScript types, the fields the provider serializes and the input hash's fields. `npm run contract:input` writes its JSON Schema into the contract (`input.transaction`, `input.searchQuery`); the provider spec fails while the two differ. A new input field is a schema edit plus a regenerated contract. Also assert in the provider spec that the field reaches the serialized API request: an E2E that spies on `provider.categorize` passes even when the provider drops it.
- `AI_CATEGORIZATION_EFFORT` is validated against the contract's `efforts` at config load. `AI_CATEGORIZATION_MODEL` is any model name; an unknown one fails its calls as provider errors.

## Input privacy

- Send only redacted semantic fields: no account identifiers, balances, provider references or unbounded remittance. `sanitizeCategorizationText` strips labelled identifiers; test it at every serialized boundary (the categorizing and the search request) with separators, label variants, mixed alphanumerics and the next label right after punctuation, and assert useful merchant text survives.
- Search queries are built in code from sanitized, normalized merchant text only, never IBANs, references, amounts or dates. The searching model sees nothing but that query.
- Bank text is untrusted input; the contract tells the model to ignore instructions inside transaction fields.

## Applying a manual category

`updateCategory` → `setManualCategory` updates the one row and fans out only to the ids passed in `applyToTransactionIds`. A follow-up for those ids is retried via the queue if it fails. Anything that writes categories outside this path (scripts, migrations) must mirror its field resets exactly and leave non-selected rows alone.

## Tests

- E2E with the provider mocked at its boundary only: `enableAiCategorizationE2e()` / `enableAiCategorizationWebSearchE2e()` at module scope, `jest.spyOn(ClaudeBankTransactionCategorizationProvider.prototype, ...)` before bootstrap, real queue, worker, database and HTTP. See `docs/provider-testing.md`.
- The provider spec pins the contract enums and limits against the app's own constants, and drives every failure class through a mocked Anthropic client.
