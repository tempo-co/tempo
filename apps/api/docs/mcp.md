# Tempo MCP

Connect an MCP client to Tempo's hosted **Streamable HTTP** endpoint using the server URL shown in Settings → Integrations, normally `https://example.ts.net/api/mcp`. Configure an account-owned personal access token as a Bearer credential through the client's secret store. The client can run on another device; it does not need a local checkout or Node.js.

The endpoint serves sixteen read-only tools through the official `@modelcontextprotocol/sdk`. It reads stored data directly through the same owner-scoped services, validation and public response boundaries as REST. It does not sync banks or provide write tools. The tool registration lives in `src/app/modules/banking/mcp/`; `McpReaderService` binds it to the token's account.

## Hosted endpoint

The API route is `/mcp`; the web proxy exposes it at `/api/mcp`. Each POST uses a fresh stateless server and transport. There is no MCP session ID or session registry. Authenticated GET and DELETE return 405 with `Allow: POST`.

Every routed request requires a valid personal token for a verified account. Missing, malformed, revoked and expired credentials return 401 with `WWW-Authenticate: Bearer`; an unverified token owner returns 403. Browser cookies do not authorize requests and do not cause session reads, last-seen updates, TTL refreshes or `Set-Cookie` responses, including on refused requests. Token usage updates `lastUsedAt` with the same one-minute write allowance as REST.

Non-browser requests may omit Origin. A present Origin must exactly equal the origin of `WEB_BASE_URL`; null, malformed and other origins return 403, including preflight and unsupported methods. These boundaries match Express's pathname for both ordinary and absolute-form HTTP targets. Requests use the existing Nest throttler (300 requests per minute for browsing in production) and a 100 KiB body cap in both the JSON parser and SDK fallback reader. Parser and service errors use static safe text; raw exception messages, request bodies and credentials are not copied to MCP errors or logs. Like REST's exception filter, a read that fails with anything other than an HTTP exception is logged server-side, with only the error name and stack frames.

## Tests

`src/app/modules/banking/mcp/tools.spec.ts` covers the tool registration through an in-memory SDK client: strict input validation, Amsterdam-dated defaults, the reader call each tool makes and safe errors. `test/e2e/mcp/mcp.e2e.spec.ts` binds a disposable API on loopback and uses the real `StreamableHTTPClientTransport` to initialize, list and call all sixteen tools against synthetic PostgreSQL fixtures. It verifies ownership, REST output parity, decimal strings, safe errors, auth, Origin, body cap, throttling and Redis session isolation, including observed Redis commands. Use the disposable E2E stack or an isolated override as described in `e2e-and-seeding.md`. The auth-guard and personal-token E2E suites cover the related REST contracts.

## Tokens

Use a verified Tempo browser session to manage tokens:

- `POST /api/personal-access-tokens` with `{"name":"MCP client","expiresInDays":90}` creates a read-scoped token and returns metadata plus the token once. `expiresInDays` is 30, 90 or 365, or `null` for a token that never expires; it defaults to 90.
- `GET /api/personal-access-tokens` returns metadata without secrets.
- `DELETE /api/personal-access-tokens/:id` revokes a token and returns 204.

Token management requires a session, not a bearer token. Creation and revocation also require the configured web Origin. Expired tokens are refused with 401 and stay listed until revoked. Password changes and resets revoke every personal token; deleting an account deletes its tokens. Logout and session revocation, including logging out all other sessions, leave tokens unchanged. Keep the returned token in the client's secret store or protected process environment, never in Git, a prompt, a command argument or a shared client configuration. Revoke unused tokens and restart clients after replacing a token.

## Tools

All inputs are strict: unknown fields are rejected, including caller-supplied owner/account IDs, bearer tokens and origins. `bankAccountIds` is an owner-scoped bank-account filter, not an owner selector. Every data tool uses only the token's account. Successful results are one compact JSON text block. API money strings, precision, nulls and metadata are preserved rather than converted to floating-point values. The table shows the equivalent REST reads; tools call the owning services directly.

| Tool                  | Input                                 | API mapping                                                                                                                                                  |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_accounts`       | `{}`                                  | `GET /bank-connections`; connection array with bank accounts, current/latest balances, base-currency balance values and sync freshness.                      |
| `list_recurring`      | `{asOf?}`                             | `GET /recurring-series`; expense and income lists with per-series details, monthly totals and unconverted counts.                                            |
| `recurring_summary`   | `{asOf?}`                             | `GET /recurring-series/summary`; monthly totals, the next three payments across shown active bills and income, and late or higher-than-usual bills.          |
| `month_summary`       | `{month, asOf?}`                      | `GET /bank-transactions/summary?month=...&asOf=...`.                                                                                                         |
| `cash_flow`           | `{interval, from, to, asOf?}`         | `GET /bank-transactions/cash-flow`.                                                                                                                          |
| `balance_trend`       | `{interval, from, to, asOf?}`         | `GET /bank-transactions/balance-trend`.                                                                                                                      |
| `search_transactions` | `{filters?, sort?, page?, pageSize?}` | `GET /bank-transactions` with `pagination[pageIndex]`, `pagination[pageSize]` nested `filter[...]` and optional `sort[by]` / `sort[order]` query parameters. |
| `transaction_totals`  | `{filters?}`                          | `GET /bank-transactions/totals`, no paging.                                                                                                                  |
| `get_transaction`     | `{id}`                                | `GET /bank-transactions/:id`, UUIDv4 only.                                                                                                                   |
| `review_counts`       | `{}`                                  | `GET /bank-transactions/review-counts`.                                                                                                                      |
| `list_categories`     | `{}`                                  | Values, labels and descriptions from `@tempo/contracts`, including filter-only `UNCATEGORIZED`.                                                              |
| `spending_breakdown`  | `{interval, by, from, to, asOf?}`     | `GET /bank-transactions/breakdown`; spending by category or income by source per month or year.                                                              |
| `list_merchants`      | `{search?, offset?, limit?}`          | `GET /merchants`; merchant groups with all-time totals, most spent first; finds a merchant id by name.                                                       |
| `merchant_ranking`    | `{interval, period, asOf?, limit?}`   | `GET /merchants/ranking`; merchants by net spending in the period containing `period`, against their usual amount.                                           |
| `get_merchant`        | `{id}`                                | `GET /merchants/:id`; all-time paid, refunded, average payment, first date, exclusions and merchant variants.                                                |
| `merchant_periods`    | `{id, interval, from, to, asOf?}`     | `GET /merchants/:id/periods`; spent, received and count per period.                                                                                          |

Every tool declares `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`; server and API authorization, not annotations, enforce read-only access.

`month` is `YYYY-MM` in 1900–2099. Dates are real `YYYY-MM-DD` calendar dates, not timestamps. `asOf` defaults to the date **in the token owner's time zone (`accounts.timeZone`) at each call**, including recurring lists/summary, cash flow and balance trend, whose API DTOs require it. Tool descriptions name that zone. `interval` is `week`, `month` or `year`. The API enforces `from <= to <= asOf`, maximum ranges of 104 weeks, 240 months or 20 years (`MAX_RANGE_PERIODS` in `@tempo/contracts`; keep these numbers in step with it), and summary months on or before `asOf`. API range errors are returned as safe HTTP 400 tool errors.

Search `page` is a zero-based nonnegative integer, default 0. `pageSize` defaults to 10 and must be one of the actual API DTO options: **5, 10, 20, 30, 40, 50, 100**. No unbounded fetch-all loop is provided. Use `transaction_totals` with the same filters for sums across all matches; summing a search page does not produce a full total.

Search accepts optional `sort: {by, order}`, where `by` is `bookingDate`, `amount`, `category` or `source`, and `order` is `ASC` or `DESC`. Amount sorting uses signed base-currency amounts; source sorts by bank name. Omitting sort preserves the API default of newest booking date first. Totals do not accept sorting.

Both search and totals accept these optional `filters`, matching the banking DTO:

- `bookingDate: {from?, to?}` with calendar dates.
- `bankAccountIds: UUIDv4[]`.
- `search: string`, maximum 1000 characters using the API validator (surrogate pairs and presentation sequences count as one).
- `categories: string[]` from `list_categories`, including `UNCATEGORIZED`.
- `categorySources: (AI | HISTORY | MANUAL)[]`.
- `financialEventTypes: (CURRENCY_EXCHANGE | OWN_TRANSFER)[]`.
- `cashFlows: (SPENDING | INCOME | INTERNAL | CURRENCY_EXCHANGE | OWN_TRANSFER | UNKNOWN)[]`.
- `baseAmount: PRESENT | MISSING`.
- `categoryStatuses: (FAILED | CATEGORIZING)[]`.
- `recurringSeriesKey: string`, the 32-character lowercase hexadecimal `key` from `list_recurring`. It narrows results to that series and combines with the other filters. Unknown or another owner's keys return the same safe 404 error.

`transaction_totals` returns `{baseCurrency, spending, income, net, count, excluded: {unknownDirection, missingBaseAmount}}`. Monetary totals are decimal strings using Tempo's spending/income semantics. Counts and exclusions describe the whole filtered set, not one search page. `list_accounts` preserves the API connection array and does not invent a grand balance total across currencies or missing conversions.

Breakdown `interval` is `month` or `year` and `by` is `category` (spending net of refunds) or `source` (income by merchant); each period's total equals cash flow's. Merchant ids match `^[bk]_[0-9a-f]{32}$` (`MERCHANT_GROUP_ID_PATTERN`) and come from `list_merchants`, `merchant_ranking` or a transaction's `merchantGroupId`; an unknown or another owner's id returns the same safe 404 error. `list_merchants` takes `search` up to 200 characters, a nonnegative `offset` and `limit` 1–100 (default 50); `merchant_ranking` takes `limit` 1–200 (default 50) and refuses a period that starts after `asOf`. Merchant amounts are decimal strings in the base currency with Tempo's spending semantics: own transfers and currency exchanges never count, and `spent` is payments minus refunds. These limits come from `@tempo/contracts`.
