# Tempo MCP

Connect an MCP client to Tempo's hosted **Streamable HTTP** endpoint using the server URL shown in Settings → Integrations, normally `https://example.ts.net/api/mcp`. Configure an account-owned personal access token as a Bearer credential through the client's secret store. The client can run on another device; it does not need a local checkout or Node.js.

The endpoint serves eleven read-only tools through the official `@modelcontextprotocol/sdk`. It reads stored data directly through the same owner-scoped services, validation and public response boundaries as REST. It does not sync banks or provide write tools. The standalone stdio entrypoint remains available for clients that launch a local process; both transports share one tool registration.

## Hosted endpoint

The API route is `/mcp`; the web proxy exposes it at `/api/mcp`. Each POST uses a fresh stateless server and transport. There is no MCP session ID or session registry. Authenticated GET and DELETE return 405 with `Allow: POST`.

Every routed request requires a valid personal token for a verified account. Missing, malformed, revoked and expired credentials return 401 with `WWW-Authenticate: Bearer`; an unverified token owner returns 403. Browser cookies do not authorize requests and do not cause session reads, last-seen updates, TTL refreshes or `Set-Cookie` responses, including on refused requests. Token usage updates `lastUsedAt` with the same one-minute write allowance as REST.

Non-browser requests may omit Origin. A present Origin must exactly equal the origin of `WEB_BASE_URL`; null, malformed and other origins return 403, including preflight and unsupported methods. These boundaries match Express's pathname for both ordinary and absolute-form HTTP targets. Requests use the existing Nest throttler (300 requests per minute for browsing in production) and a 100 KiB body cap in both the JSON parser and SDK fallback reader. Parser and service errors use static safe text; raw exception messages, request bodies and credentials are not copied to MCP errors or logs.

## Build and verify

From `apps/api`, with Node.js 22.13 or later:

```bash
NODE_ENV=development npm --prefix mcp ci --include=dev
npm --prefix mcp run lint:check
npm --prefix mcp run format:check
npm --prefix mcp test
```

`test` builds the standalone package and runs synthetic integration tests against disposable loopback HTTP servers, plus real SDK stdio process tests. These package tests need no database, Docker or live credentials. Existing CI checks `Lint & Format`, `Build` and `Unit Tests` include this package without changing their names.

Both builds generate category values and descriptions from `src/app/modules/banking/categorization/bank-transaction-category.ts`. Generated TypeScript and `dist/` are ignored. The API's CommonJS build compiles only the imported Nest-free registration and its dependencies; the standalone package builds as ESM and preserves `mcp/dist/stdio.js`. The Docker builder copies the shared source and generator, and runtime smoke loads the compiled API with production dependencies.

Hosted E2E coverage lives in `test/e2e/mcp/mcp.e2e.spec.ts`. It binds a disposable API on loopback and uses the real `StreamableHTTPClientTransport` to initialize, list and call all eleven tools against synthetic PostgreSQL fixtures. It verifies ownership, REST output parity, decimal strings, safe errors, auth, Origin, body cap, throttling and Redis session isolation, including observed Redis commands. Use the normal disposable E2E stack or an isolated override as described in `docs/e2e-and-seeding.md`; generate categories with `npm run generate:mcp` before invoking Jest directly. The auth-guard and personal-token E2E suites cover the related REST contracts.

## Tokens

Use a verified Tempo browser session to manage tokens:

- `POST /api/personal-access-tokens` with `{"name":"Local MCP","expiresInDays":90}` creates a read-scoped token and returns metadata plus the token once. `expiresInDays` is 30, 90 or 365, or `null` for a token that never expires; it defaults to 90.
- `GET /api/personal-access-tokens` returns metadata without secrets.
- `DELETE /api/personal-access-tokens/:id` revokes a token and returns 204.

Token management requires a session, not a bearer token. Creation and revocation also require the configured web Origin. Expired tokens are refused with 401 and stay listed until revoked. Revoking all other sessions also revokes every personal token, even when there are no other sessions. Password changes and resets use that same revocation path; deleting an account deletes its tokens. Ordinary logout and individual-session revocation leave tokens unchanged. Keep the returned token in the client's secret store or protected process environment, never in Git, a prompt, a command argument or a shared client configuration. Revoke unused tokens and restart clients after replacing a token.

The following environment variables apply to the optional stdio server and disposable smoke script:

| Environment | Contract |
| --- | --- |
| `TEMPO_API_TOKEN` | Required bearer token. No whitespace or control characters. |
| `TEMPO_API_URL` | API base URL, default `http://127.0.0.1:8080/api`. HTTPS, or HTTP only for `127.0.0.1`, `localhost` or `[::1]`. No embedded credentials, query or fragment. Trailing slashes are removed. |

Choose the final API base URL: redirects, including same-origin redirects, are refused. Requests time out after 15 seconds. HTTP 401, 403, 404, 429 and 5xx errors become actionable MCP errors without copying response bodies or bearer credentials. Valid numeric or HTTP-date `Retry-After` headers are included for 429 responses. There are no automatic retries.

## Client isolation and optional stdio setup

**Do not enable this server globally until client isolation is proven.** Enable it only for the intended interactive session or project. Confirm that background, cron and delegated-agent sessions cannot discover or call it before using real financial data. This package does not configure or guarantee that isolation, and read-only access is still sensitive access.

For a client that requires a local process, build the package and use an entry like this. Replace the path and inject the token through that client's secret mechanism; the placeholder is not a usable token:

```json
{
  "mcpServers": {
    "tempo": {
      "command": "node",
      "args": ["/absolute/path/to/tempo/apps/api/mcp/dist/stdio.js"],
      "env": {
        "TEMPO_API_URL": "http://127.0.0.1:8080/api",
        "TEMPO_API_TOKEN": "<client-managed-secret>"
      }
    }
  }
}
```

Run `node .../mcp/dist/stdio.js` directly, not an npm command that prints a banner to stdout. The server uses stdout only for MCP protocol messages; startup diagnostics use stderr. The client must explicitly forward both environment variables to the child process if it does not inherit them.

## Tools

All inputs are strict: unknown fields are rejected, including caller-supplied owner/account IDs, bearer tokens and origins. `bankAccountIds` is an owner-scoped bank-account filter, not an owner selector. Every data tool uses only the token's account. Successful results are one compact JSON text block. API money strings, precision, nulls and metadata are preserved rather than converted to floating-point values. The table shows the equivalent REST reads; hosted calls use the owning services directly.

| Tool | Input | API mapping |
| --- | --- | --- |
| `list_accounts` | `{}` | `GET /bank-connections`; connection array with bank accounts, current/latest balances, base-currency balance values and sync freshness. |
| `list_recurring` | `{asOf?}` | `GET /recurring-series`; expense and income lists with per-series details, monthly totals and unconverted counts. |
| `recurring_summary` | `{asOf?}` | `GET /recurring-series/summary`; monthly totals and the next three payments across shown active bills and income. |
| `month_summary` | `{month, asOf?}` | `GET /bank-transactions/summary?month=...&asOf=...`. |
| `cash_flow` | `{interval, from, to, asOf?}` | `GET /bank-transactions/cash-flow`. |
| `balance_trend` | `{interval, from, to, asOf?}` | `GET /bank-transactions/balance-trend`. |
| `search_transactions` | `{filters?, sort?, page?, pageSize?}` | `GET /bank-transactions` with `pagination[pageIndex]`, `pagination[pageSize]` nested `filter[...]` and optional `sort[by]` / `sort[order]` query parameters. |
| `transaction_totals` | `{filters?}` | `GET /bank-transactions/totals`, no paging. |
| `get_transaction` | `{id}` | `GET /bank-transactions/:id`, UUIDv4 only. |
| `review_counts` | `{}` | `GET /bank-transactions/review-counts`. |
| `list_categories` | `{}` | Local generated values, labels and descriptions, including filter-only `UNCATEGORIZED`. |

Routes above are relative to `TEMPO_API_URL`, including its `/api` prefix. Every tool declares `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`; server and API authorization, not annotations, enforce read-only access.

`month` is `YYYY-MM` in 1900–2099. Dates are real `YYYY-MM-DD` calendar dates, not timestamps. `asOf` defaults to the date in **Europe/Amsterdam at each call**, including recurring lists/summary, cash flow and balance trend, whose API DTOs require it. `interval` is `week`, `month` or `year`. The API enforces `from <= to <= asOf`, maximum ranges of 104 weeks, 60 months or 10 years, and summary months on or before `asOf`. API range errors are returned as safe HTTP 400 tool errors.

Search `page` is a zero-based nonnegative integer, default 0. `pageSize` defaults to 10 and must be one of the actual API DTO options: **5, 10, 20, 30, 40, 50, 100**. No unbounded fetch-all loop is provided. Use `transaction_totals` with the same filters for sums across all matches; summing a search page does not produce a full total.

Search accepts optional `sort: {by, order}`, where `by` is `bookingDate`, `amount`, `category` or `source`, and `order` is `ASC` or `DESC`. Amount sorting uses signed base-currency amounts; source sorts by bank name. Omitting sort preserves the API default of newest booking date first. Totals do not accept sorting.

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
- `recurringSeriesKey: string`, the 32-character lowercase hexadecimal `key` from `list_recurring`. It narrows results to that series and combines with the other filters. Unknown or another owner's keys return the same safe 404 error.

`transaction_totals` returns `{baseCurrency, spending, income, net, count, excluded: {unknownDirection, missingBaseAmount}}`. Monetary totals are decimal strings using Tempo's spending/income semantics. Counts and exclusions describe the whole filtered set, not one search page. `list_accounts` preserves the API connection array and does not invent a grand balance total across currencies or missing conversions.

## Disposable API smoke

After starting an isolated API with synthetic banking fixtures, create a test token using its session-only management endpoint. Supply that token, an explicit loopback `TEMPO_API_URL` and a fixture UUIDv4 in `TEMPO_SMOKE_TRANSACTION_ID` through protected environment injection, then run:

```bash
npm --prefix mcp run smoke:api
```

The command uses the SDK's actual stdio client to list and call all eleven tools, including recurring reads, totals and a real transaction detail. It prints only tool pass/fail labels, not financial payloads or credentials. It refuses non-loopback hosts and requires an explicit URL and fixture ID. It neither creates nor revokes tokens; the fixture owner must revoke the disposable token and stop the isolated API afterwards. This smoke is a separate gate from the HTTP-stub suite.
