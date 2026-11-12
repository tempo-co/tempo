# Banking invariants

Rules for `src/app/modules/banking/` that the code relies on but does not state in one place. Read this before changing authorization, sync, deletion, transaction identity, own transfers, currency exchanges or totals.

## Ownership

- Every read, callback, sync and mutation is owner-scoped through `bank_transactions` → `bank_accounts` → `bank_connections."accountId"`. A bank connection is not the ownership boundary: one owner can have several connections, and one connection several accounts.
- Derived state is per owner. Own-transfer recognition and currency-exchange pairing take a per-owner transaction advisory lock (`pg_advisory_xact_lock(hashtext('own-transfer:' || ownerId))`, `'currency-exchange:'`); categorization history hints only read the same owner's rows. Money moving between two different Tempo owners stays ordinary spending/income.
- Unauthorized callers get 404, never a lock-conflict signal: do the owner-scoped precheck before taking any shared lock.

## Provider account identity (Enable Banking)

From `enable-banking.client.ts` `parseAccount()`:

- `uid` → `bank_accounts.providerAccountId`. Session-scoped: it rotates on every authorization and only identifies an account within its connection's current session.
- `identification_hash` → `identificationHash`. Stable across sessions for the same real account.
- Account upsert/dedup must try `(connection, providerAccountId)` first, then `(connection, identificationHash)`. Deduping by `providerAccountId` across sessions silently creates duplicate accounts.
- Treat `identificationHash` as an opaque fingerprint. Never reverse it into an account number or log it next to IBANs.

## Re-authorization merges into the existing connection

`startAuthorization` always inserts a pending row, so failure and cancel semantics stay per attempt. `persistAuthorizedSession` then writes the new session, consent and accounts onto the owner's existing AUTHORIZED/EXPIRED connection for the same provider + ASPSP and drops the pending row. Account upsert by hash rotates `providerAccountId` in place and keeps transaction history.

- The authorization state records `replacesConnectionId`: an exact id must still exist and be eligible, otherwise the callback fails with `state_superseded`; `null` may pick the newest eligible connection under lock; a missing value (legacy state) fails closed.
- Expected races throw `BankingAuthorizationStateError` with a code from its union (e.g. `state_superseded`), never a bare `Error`, so they are not logged as `internal_error`.
- Serialize first-time callbacks with the account/ASPSP scope lock before selecting a reusable connection, or two pending rows can each become an authorized connection.
- In tests, the newest connection row may be CANCELLED under merge semantics: never look up "the" connection by `createdAt DESC`; filter by status.
- Do not dedupe accounts globally per owner by hash. It forces account re-parenting, and sync's authoritative-account reconciliation would then mark a borrowed account inactive (its `providerAccountId` is not in its own connection's session).

## Connection removal and sync coordination

Treat a connection as a concurrent lifecycle: provider callbacks, background sync, deletion and Redis authorization state overlap.

- Sync and deletion share one per-connection Redis lease (`banking:sync:<connection-id>`, `banking-connection-lock.service.ts`). Deletion fails with 409 while sync holds it.
- Sync re-reads the owned connection **after** acquiring the lease; otherwise it continues with a stale entity after a deletion commits. Every success, failure and status write is fenced by the run identity (`syncStatus = RUNNING` + `syncStartedAt`); a zero-row guarded update means ownership was lost, so roll back.
- Database lock order, in both callback persistence and deletion: pending authorization row(s), then the reusable connection, then children. Reversing it in one path deadlocks against the other.
- Destructive removal of AUTHORIZED/EXPIRED connections requires the exact body `confirmation: "DELETE"`, checked by the API. Pending/cancelled/failed connections with child data are protected separately (409).
- Delete, then remove Redis authorization state for every invalidated connection after commit. Release the lease in `finally`; a cleanup or logging failure must not turn a committed deletion into a reported failure.
- FKs from `bank_accounts`, `bank_transactions`, `bank_account_balances` and `bank_sync_runs` cascade on delete. Expired consent or an inactive account keeps rows; only explicit DELETE erases them.

Regression matrix worth keeping green: missing/wrong/lowercase/padded confirmation → 400 and nothing removed; other owner → 404; held lease → 409; authorized and expired deletion → 204 with cascade; incomplete connection with an account → 409; pending re-authorization cancelled by deletion, and its late callback cannot recreate a connection; callback replay or superseded state → error, no second persistence.

## Background and foreground sync

- Data reads return Tempo's saved database state and never call the provider. Opening the authenticated app in the foreground can separately initiate an online refresh mutation while cached data remains visible. Unattended background sync never sends PSU presence headers.
- Foreground refresh is a verified-owner, session-only, CSRF-protected `POST /bank-connections/:connectionId/refresh`. Check ownership before acquiring the shared lease, then re-read under the lease. It synchronously returns a finished `BankSyncRunResponseDto` with HTTP 200 (or HTTP 204 when skipped as a recent sync, below), including partial/failed provider runs; expected refusals use typed HTTP errors and existing consent/conflict messages.
- Foreground refresh shares the incremental fetch/import, lease and fencing path. It bypasses the ordinary automatic `nextSyncAt` gate, but not consent expiry or an active provider `RATE_LIMITED` cooldown. When the connection synchronized (a SUCCEEDED or PARTIAL run sets `lastSyncedAt`) less than `BANKING_FOREGROUND_REFRESH_MIN_INTERVAL_MS` (5 minutes) ago, it answers HTTP 204 without contacting the provider or recording a run: opening Tempo repeatedly cannot fetch a bank more often than that. A cooldown refusal is HTTP 429 with `Retry-After`, `rateLimitSource` and `retryAfterSeconds`; a newly rate-limited run returns those metadata fields in the finished run.
- PSU context exists only within that request, from Express `req.ip` and the request User-Agent. Never use body-supplied PSU fields, incoming `Psu-*` headers, raw forwarding headers or server/public-IP discovery. Check the matching institution's catalog `required_psu_headers` (cached per country in Redis for an hour, `banking:aspsp-catalog:<country>`) before making presence-bearing requests; refuse missing/unsupported required context rather than sending an incomplete header set. Send the context to session/balance reads and every transaction page, including continuation after an empty page.
- Disconnect/abort cancels provider I/O, stops lease renewal and prevents subsequent page dispatch. Cancellation during provider fetch finishes the run as failed and restores its prior automatic schedule; never queue or replay foreground presence. PSU metadata is not persisted in banking rows or jobs. Cancellation racing with persistence may arrive too late to undo imported data.
- The existing trusted-proxy chain determines `req.ip`; a genuine private/tailnet address is not replaced or rejected merely for lacking public routability. Bank acceptance of such addresses is unproven and requires a separately approved live trial. See [Enable Banking's reference](https://enablebanking.com/docs/api/reference/) for PSU header and `required_psu_headers` semantics.
- A recurring dispatcher (`BANKING_SYNC_DISPATCH_INTERVAL`) enqueues due AUTHORIZED connections; the per-connection gate is `nextSyncAt` (`BANKING_SYNC_INTERVAL`). It skips a connection whose job is still waiting or running, writes QUEUED with a guarded update before adding the job (a job add that fails leaves the row due for the next dispatch), and one connection's error does not stop the others.
- A failed provider call is classified by `classifyProviderFailure` (`bank-sync-failure.ts`) from Enable Banking's documented error codes, never from substrings or a bare HTTP 403:
  - Session ended (`CLOSED_SESSION`, `EXPIRED_SESSION`, `REVOKED_SESSION`, `SESSION_DOES_NOT_EXIST`, or a session the provider reports in another status than AUTHORIZED): the connection becomes EXPIRED with no next sync, and only re-authorization helps.
  - Rate limit (HTTP 429 with any code, or `ASPSP_RATE_LIMIT_EXCEEDED`): stops the remaining provider calls in that run. The cooldown is `Retry-After` clamped to 15 minutes–24 hours (`BANKING_MIN_RETRY_AFTER_SECONDS`, `BANKING_MAX_RETRY_AFTER_SECONDS`), or 6 hours without a usable one; it becomes `nextSyncAt` with sync status RATE_LIMITED. Do not retry in a tight loop.
  - Tempo's own application refused (HTTP 401 without a session code, `UNAUTHORIZED_ACCESS`, `AUTHORIZATION_NOT_PROVIDED`, `UNAUTHORIZED_IP`, or Tempo failing to sign its JWT): stops the run, which fails with the ordinary retry backoff, and logs at ERROR because every connection fails until the key, application or clock is fixed. The connection stays AUTHORIZED.
  - Anything else, including a per-account HTTP 403 such as `ASPSP_ACCOUNT_NOT_ACCESSIBLE`: fails that call only; the run goes on with the other calls and ends PARTIAL or FAILED.
- The sync claim needs only the lease plus an AUTHORIZED connection with the session it read: a RUNNING row left by a crashed process is taken over, the new `syncStartedAt` fences out the old process's writes, and the connection's leftover RUNNING runs become FAILED with an `interrupted` failure. A fenced write that matches no row throws `BankingSyncOwnershipLostError` (HTTP 409) and the run's transaction rolls back.
- Fetch windows are per account. `bank_accounts.transactionsFetchedThrough` is the date (Europe/Amsterdam, `@core/time/app-time-zone`) of the account's last complete transactions fetch. Until one completes, the account asks for `strategy: 'longest'`; afterwards `strategy: 'default'` from that date minus `INCREMENTAL_OVERLAP_DAYS`, without `date_to`, relying on dedupe. When that start is older than `BANKING_UNATTENDED_HISTORY_DAYS` (90: many banks serve no more without the user present, and none publishes its limit), it asks for `longest` from that start instead, which returns what the bank still has rather than `WRONG_TRANSACTIONS_PERIOD`.
- Drain every continuation key, including pages with no rows. A key the provider already sent fails the call with `provider_pagination_loop`. When a later page fails, the pages before it are still imported, but the account's watermark only advances when every page was fetched.
- Banks allow few unattended calls per account per day, so a failed run is retried narrowly. A provider call that failed on its own (classified `failed`) is stored in `bank_connections.syncRetryCalls`, and the next automatic run, after the `BANKING_TRANSIENT_RETRY_BASE_MS` backoff, repeats only those calls (the session read, or one account's balances or transactions). If a call fails again in that retry, or nothing a retry can fix failed (unreadable rows only), the next sync is an ordinary full one after `BANKING_SYNC_INTERVAL`. Tempo's own credential refusals, unexpected exceptions and persistence failures retry the full sync with the exponential backoff. Foreground refreshes are always full.
- Keep provider calls outside database transactions; enqueue categorization only after the rows commit.
- Once the sync transaction commits, the run is reported as finished: lease loss or a disconnect after that point does not fail it. The fencing inside the transaction protects the write.
- Every failed or partial run stores why in `bank_sync_runs.failures` (`bank-sync-failure.ts`) and logs the same summary at WARN with the run id: per failed provider call its kind (`session`, `balances`, `transactions`), Tempo's bank account id, the provider error code, HTTP status and whether `Retry-After` came back; `internal` for an unexpected exception (logged with its name and stack frames); `cancelled` for an aborted foreground refresh; `interrupted` for a run a crashed process left RUNNING. Never store or log provider messages, response bodies, provider ids or exception messages. The user-facing `errorMessage` stays generic.
- Transactions the provider sends without a usable amount or currency are not imported. The rest of the page is, the count is recorded as an `unparseable_transactions` failure for that account, and the run is PARTIAL. A page with no usable row fails that account's transactions call.

## Transaction identity

- Rows are unique on `(bankAccountId, dedupeKey)`. The key comes from `bank-transaction-identity.ts`: a stable core group of provider-independent fields plus an occurrence number. Descriptions, counterparty and references only disambiguate occurrences inside a group.
- Provider transaction ids and entry references are hints, scoped to their account, never globally unique.
- When a row keeps its key while moving groups, reserve every occupied key in the account, not just the candidates of a narrow query, or an upsert can overwrite a different payment.
- A pending payment can move group when `valueDate` becomes populated on booking. Never merge amount/date look-alikes to fix that; genuinely repeated payments must survive.
- File imports decide duplicates with the ladder in `bank-transaction-matcher.ts` (reference, then amount + value date + balance after, then same day, then the only candidate within 3 days) before writing. The date steps never pair two rows whose bank references are both present and differ; a row whose only nearby candidate has another reference is doubtful. Rows the ladder calls new go through `persistTransactions` with `importId`, which inserts each at the next free occurrence of its group and never matches or updates a stored row. A matched stored row is not written at all.
- A file import's statement goes to the account the request names (`bankAccountId`, or the `accountChoices` entry `<bank>:<currency>` of a file that names no account), else to the owner's synced account with its IBAN and currency, else to an imported-files account. A file that names no account is routed by its bank and currency alone (to an active account when one fits, so an inactive one cannot make it ambiguous), so before anything is written it must look like the synced account it was routed to: when at least `UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS` of its rows (in the format with the most such rows) fall within the first and last day that account stores and the ladder matches fewer than `UNCONFIRMED_TARGET_MIN_MATCH_SHARE` (half) of them, the drop is refused with `target_account_unconfirmed`. A coincidental match or two (equal amounts on nearby days) does not confirm a wrong account. Two fitting synced accounts refuse it with `ambiguous_target_account`. Both refusals list every statement needing an answer with its candidate accounts (inactive accounts only when the statement was routed to one); an answered statement is not checked again.
- A drop is at most 20 files of 10 MB each and 25 MB together (`parse-limits.ts`, which the web mirrors to refuse the same choice before uploading; the parse child loads that file alone, so it imports nothing). The upload route counts the body as it streams, so a drop is refused with `drop_too_large` once its body passes 25 MB plus a 64 KB multipart allowance, whatever `Content-Length` says; a declared length over that is refused before the upload waits for a slot. Files are read into memory only, so at most `MAX_CONCURRENT_UPLOADS` (2) uploads per API process are read and imported at once; later ones wait in arrival order before their body is read, and one that waits 30 s is refused with `import_busy` (HTTP 503 with `Retry-After`). A waiting upload whose client leaves leaves the queue.
- Sync takes over an imported row: on an account that still holds rows with an `importId`, sync rows that would be inserted first run the same ladder against those imported rows. An imported row that is the only match receives the sync row's identity keys, `dedupeKey` and bank fields through the ordinary upsert, keeps its `id`, category and manual edits, and loses its `importId`, so undoing the import leaves it. A doubtful result adopts nothing and the sync row is inserted. This is the only place amount/date look-alikes merge, and only because an imported row and its synced twin are one payment that the two sources describe with different dates.
- Date hydration depends on PostgreSQL `DateStyle`: use `to_char(date, 'YYYY-MM-DD')` in migrations and trust the stored group key during reconciliation.

## Provider field normalization

- Normalize currency and debit/credit codes at the authorization/sync persistence boundary. Prove it with padded, mixed-case provider input in real-PostgreSQL E2E; fixtures saved already uppercase prove nothing.
- Counterparty locality comes from the party the direction names: creditor for `DBIT`, debtor for `CRDT`. If that party is missing or the direction unknown, store no location; the other party may be the account holder. Keep only city, region and a valid two-letter country.

## Totals and financial events

Defined in `services/bank-transaction-filters.ts`; read `SQL_SPENDING` / `SQL_INCOME` before claiming how a category affects totals.

- Spending is every non-internal debit, and `REFUND` credits are counted with spending, not income; income is every non-internal credit except `REFUND`. "Internal" means own transfer (`ownTransferEvidence`) or currency exchange (`financialEventType`), never the category. A `TRANSFER_OUT` to a person is spending.
- Currency exchanges are a financial event, not a category: `financialEventType = CURRENCY_EXCHANGE`, category status `NOT_APPLICABLE`. Detection is an exact provider marker (`bank-transaction-financial-event.ts`); never match a broad "exchange" substring or amount/date alone. A card payment carrying FX data is not an exchange.
- Apply the event before the categorization hash, then guard the reset with `categorySource IS DISTINCT FROM 'MANUAL'`. Block event rows at every AI boundary (enqueue, reconciliation, worker claim, before web search): stale jobs bypass a single guard.
- Own transfers: evidence is a counterparty IBAN of another owned account in the same currency, the holder's own name (never for card payments), or an owner override (`MARKED`/`UNMARKED`). `TRANSFER` transaction type, names, or matching amount/date alone are leads, not evidence. Never delete, merge or rewrite either leg.
- Never add amounts across currencies.
- The breakdown (`/bank-transactions/breakdown`) splits cash flow's spending by category and its income by source (`SQL_INCOME_SOURCE`: merchant key, else display name) on the same definitions, so each period's total equals cash flow's. Refund credits stay in their `REFUND` part, which can be negative. A source's part reconciles with the list filtered by `incomeSource` set to its key.
- Merchant totals (`/merchants`) use the same definitions over `SQL_MERCHANT_GROUP` and reconcile with the list filtered by `merchantGroup`; own transfers and currency exchanges belong to no group.
- Cash flow, the breakdown and merchant periods take their period list from `periodWindows`: which periods history covers, each end clamped to the range, and which are complete.

## Alerts

- `alerts/` raises bank alerts (consent ending within 7 days, its last day, no successful sync for `SYNC_BROKEN_AFTER_MS`) by email and push. "Successful" means a SUCCEEDED run: `lastSyncedAt` also advances for PARTIAL runs. `GET /bank-connections` returns that time as `lastSuccessfulSyncAt`, and the web app warns about a failing sync on the same threshold. Each alert is recorded once per episode (the connection's marker columns), in the transaction that queues its jobs. Job ids derive from that identity, so a rolled-back marker, a retry or an overlapping scan never sends twice.
- A push raised between 21:00 and 09:00 Europe/Amsterdam waits until 09:00 as a delayed job. Before sending, the worker checks that the alert still applies (a reauthorized or synced bank sends nothing) and reads the badge count from review counts.
- Push text stays vague: no bank, account or amount. Pushes reach only subscriptions whose session is still signed in as the owner (`modules/notifications`); logout removes that session's subscriptions, and push service 404/410 answers remove the subscription.

## Concurrency patterns used here

- Owner answers that must not race (recurring-series decisions): lock the owner row (`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`) inside the write transaction, re-read the decision state and return 409 when it changed. Test with two simultaneous requests (`Promise.all`) asserting exactly one success and one stored row.
- Own-transfer and currency-exchange recomputes run after the sync/authorization/deletion transaction (`recomputeForOwnerSafely`) and serialize per owner on the advisory lock. A new writer that recomputes inside its own transaction must take that lock before touching transaction rows, or two recomputes can deadlock.
- For conflict upserts, inspect the generated SQL and run it against real PostgreSQL; qualify target-table columns in `ON CONFLICT ... WHERE`, or they become ambiguous with `EXCLUDED`.

## Tests

- E2E against real PostgreSQL/Redis/Mailpit for ownership, cascade, locking and dedupe properties. Unit tests only for ordering invariants before side effects, fault injection and pure functions over provider payloads.
- Compare snapshots read back from the database, not the object `Repository.save` returned: `numeric` columns change their string scale on the first read.
- Build banking rows with `BankingFixtures`; isolate data a test counts under its own seeded owner (the `OWN_TRANSFER_ACCOUNT_*` constants in `seed.constants.ts` are the example) so shared pagination fixtures keep their counts.
- New protected routes go into the tables in `test/e2e/auth/auth-guard.e2e.spec.ts`.
