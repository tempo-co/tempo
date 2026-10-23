# Tempo local MCP

A standalone TypeScript stdio server using the official `@modelcontextprotocol/sdk`. It calls Tempo over authenticated GET requests. It does not import or start the Nest app, expose an HTTP transport, sync bank accounts, or provide write or recurring-payment tools.

## Build and verify

From the API repository root, with Node.js 22.13 or later:

```bash
NODE_ENV=development npm --prefix mcp ci --include=dev
npm --prefix mcp run lint:check
npm --prefix mcp run format:check
npm --prefix mcp test
```

`test` builds the package and runs synthetic integration tests against disposable loopback HTTP servers, plus real SDK stdio process tests. No database, Docker or live credentials are used. Existing CI checks `Lint & Format`, `Build` and `Unit Tests` include this package without changing their names.

The build generates category values and descriptions from `src/app/modules/banking/categorization/bank-transaction-category.ts`. Generated TypeScript and `dist/` are ignored. Only build-time code reads that leaf module; the built server needs only `mcp/dist/` and its production dependencies.

## Token and environment

Use a verified Tempo browser session to manage tokens:

- `POST /api/personal-access-tokens` with `{"name":"Local MCP","expiresInDays":90}` creates a read-scoped token and returns metadata plus the token once. `expiresInDays` is 30, 90 or 365, or `null` for a token that never expires; it defaults to 90.
- `GET /api/personal-access-tokens` returns metadata without secrets.
- `DELETE /api/personal-access-tokens/:id` revokes a token and returns 204.

Token management requires a session, not a bearer token. Creation and revocation also require the configured web Origin. Expired tokens are refused with 401 and stay listed until revoked. Revoking all other sessions also revokes every personal token, even when there are no other sessions. Password changes and resets use that same revocation path; deleting an account deletes its tokens. Ordinary logout and individual-session revocation leave tokens unchanged. Keep the returned token in the client's secret store or protected process environment, never in Git, a prompt, a command argument or a shared client configuration. Revoke unused tokens and restart clients after replacing a token.

| Environment | Contract |
| --- | --- |
| `TEMPO_API_TOKEN` | Required bearer token. No whitespace or control characters. |
| `TEMPO_API_URL` | API base URL, default `http://127.0.0.1:8080/api`. HTTPS, or HTTP only for `127.0.0.1`, `localhost` or `[::1]`. No embedded credentials, query or fragment. Trailing slashes are removed. |

Choose the final API base URL: redirects, including same-origin redirects, are refused. Requests time out after 15 seconds. HTTP 401, 403, 404, 429 and 5xx errors become actionable MCP errors without copying response bodies or bearer credentials. Valid numeric or HTTP-date `Retry-After` headers are included for 429 responses. There are no automatic retries.

## Client setup and isolation

**Do not enable this server globally until client isolation is proven.** Enable it only for the intended interactive session or project. Confirm that background, cron and delegated-agent sessions cannot discover or call it before using real financial data. This package does not configure or guarantee that isolation, and read-only access is still sensitive access.

A generic client entry looks like this. Replace the path and inject the token through that client's secret mechanism; the placeholder is not a usable token:

```json
{
  "mcpServers": {
    "tempo": {
      "command": "node",
      "args": ["/absolute/path/to/tempo-api/mcp/dist/stdio.js"],
      "env": {
        "TEMPO_API_URL": "http://127.0.0.1:8080/api",
        "TEMPO_API_TOKEN": "<client-managed-secret>"
      }
    }
  }
}
```

Run `node .../mcp/dist/stdio.js` directly, not an npm command that prints a banner to stdout. The server uses stdout only for MCP protocol messages; startup diagnostics use stderr. The client must explicitly forward both environment variables to the child process if it does not inherit them. Do not configure remote MCP hosting or an HTTP transport.

## Tools

All inputs are strict: unknown fields are rejected, including caller-supplied owner/account IDs, bearer tokens and origins. `bankAccountIds` is an owner-scoped bank-account filter, not an owner selector. All HTTP-backed tools use only the token's account. Successful results are one compact JSON text block. API money strings, precision, nulls and metadata are preserved rather than converted to floating-point values.

| Tool | Input | API mapping |
| --- | --- | --- |
| `list_accounts` | `{}` | `GET /bank-connections`; connection array with bank accounts, current/latest balances, base-currency balance values and sync freshness. |
| `month_summary` | `{month, asOf?}` | `GET /bank-transactions/summary?month=...&asOf=...`. |
| `cash_flow` | `{interval, from, to, asOf?}` | `GET /bank-transactions/cash-flow`. |
| `balance_trend` | `{interval, from, to, asOf?}` | `GET /bank-transactions/balance-trend`. |
| `search_transactions` | `{filters?, page?, pageSize?}` | `GET /bank-transactions` with `pagination[pageIndex]`, `pagination[pageSize]` and nested `filter[...]` query parameters. |
| `transaction_totals` | `{filters?}` | `GET /bank-transactions/totals`, no paging. |
| `get_transaction` | `{id}` | `GET /bank-transactions/:id`, UUIDv4 only. |
| `review_counts` | `{}` | `GET /bank-transactions/review-counts`. |
| `list_categories` | `{}` | Local generated values, labels and descriptions, including filter-only `UNCATEGORIZED`. |

Routes above are relative to `TEMPO_API_URL`, including its `/api` prefix. Every tool declares `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`; server and API authorization, not annotations, enforce read-only access.

`month` is `YYYY-MM` in 1900–2099. Dates are real `YYYY-MM-DD` calendar dates, not timestamps. `asOf` defaults to the date in **Europe/Amsterdam at each call**, including for cash flow and balance trend, whose API DTO requires it. `interval` is `week`, `month` or `year`. The API enforces `from <= to <= asOf`, maximum ranges of 104 weeks, 60 months or 10 years, and summary months on or before `asOf`. API range errors are returned as safe HTTP 400 tool errors.

Search `page` is a zero-based nonnegative integer, default 0. `pageSize` defaults to 10 and must be one of the actual API DTO options: **5, 10, 20, 30, 40, 50, 100**. No unbounded fetch-all loop is provided. Use `transaction_totals` with the same filters for sums across all matches; summing a search page does not produce a full total.

Both search and totals accept these optional `filters`, matching the banking DTO:

- `bookingDate: {from?, to?}` with calendar dates.
- `bankAccountIds: UUIDv4[]`.
- `search: string`, maximum 1000 characters using the API validator (surrogate pairs and presentation sequences count as one). Proxy/request-line limits can also reject heavily encoded queries.
- `categories: string[]` from `list_categories`, including `UNCATEGORIZED`.
- `categorySources: (AI | HISTORY | MANUAL)[]`.
- `financialEventTypes: (CURRENCY_EXCHANGE | OWN_TRANSFER)[]`.
- `cashFlows: (SPENDING | INCOME | INTERNAL | CURRENCY_EXCHANGE | OWN_TRANSFER | UNKNOWN)[]`.
- `baseAmount: PRESENT | MISSING`.
- `categoryStatuses: (FAILED | CATEGORIZING)[]`.

`transaction_totals` returns `{baseCurrency, spending, income, net, count, excluded: {unknownDirection, missingBaseAmount}}`. Monetary totals are decimal strings using Tempo's spending/income semantics. Counts and exclusions describe the whole filtered set, not one search page. `list_accounts` preserves the API connection array and does not invent a grand balance total across currencies or missing conversions.

## Disposable API smoke

After starting an isolated API with synthetic banking fixtures, create a test token using its session-only management endpoint. Supply that token, an explicit loopback `TEMPO_API_URL` and a fixture UUIDv4 in `TEMPO_SMOKE_TRANSACTION_ID` through protected environment injection, then run:

```bash
npm --prefix mcp run smoke:api
```

The command uses the SDK's actual stdio client to list and call all nine tools, including the new totals route and a real fixture detail. It prints only tool pass/fail labels, not financial payloads or credentials. It refuses non-loopback hosts and requires an explicit URL and fixture ID. It neither creates nor revokes tokens; the fixture owner must revoke the disposable token and stop the isolated API afterwards. This smoke is a separate gate from the HTTP-stub suite.
