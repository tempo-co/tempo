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

## Background sync

- Automatic only. There is no user-facing manual refresh; page loads read Tempo's database and never call the provider.
- A recurring dispatcher (`BANKING_SYNC_DISPATCH_INTERVAL`) enqueues due AUTHORIZED connections; the per-connection gate is `nextSyncAt` (`BANKING_SYNC_INTERVAL`).
- An ASPSP rate limit stops the remaining provider calls in that run and persists `Retry-After` as the next gate. Do not retry in a tight loop.
- The first sync uses `strategy: 'longest'`; later syncs start from the previous successful run minus `INCREMENTAL_OVERLAP_DAYS` and rely on dedupe. Drain every continuation key, including pages with no rows.
- Keep provider calls outside database transactions; enqueue categorization only after the rows commit.

## Transaction identity

- Rows are unique on `(bankAccountId, dedupeKey)`. The key comes from `bank-transaction-identity.ts`: a stable core group of provider-independent fields plus an occurrence number. Descriptions, counterparty and references only disambiguate occurrences inside a group.
- Provider transaction ids and entry references are hints, scoped to their account, never globally unique.
- When a row keeps its key while moving groups, reserve every occupied key in the account, not just the candidates of a narrow query, or an upsert can overwrite a different payment.
- A pending payment can move group when `valueDate` becomes populated on booking. Never merge amount/date look-alikes to fix that; genuinely repeated payments must survive.
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

## Concurrency patterns used here

- Owner answers that must not race (recurring-series decisions): lock the owner row (`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`) inside the write transaction, re-read the decision state and return 409 when it changed. Test with two simultaneous requests (`Promise.all`) asserting exactly one success and one stored row.
- Own-transfer and currency-exchange recomputes run after the sync/authorization/deletion transaction (`recomputeForOwnerSafely`) and serialize per owner on the advisory lock. A new writer that recomputes inside its own transaction must take that lock before touching transaction rows, or two recomputes can deadlock.
- For conflict upserts, inspect the generated SQL and run it against real PostgreSQL; qualify target-table columns in `ON CONFLICT ... WHERE`, or they become ambiguous with `EXCLUDED`.

## Tests

- E2E against real PostgreSQL/Redis/Mailpit for ownership, cascade, locking and dedupe properties. Unit tests only for ordering invariants before side effects, fault injection and pure functions over provider payloads.
- Compare snapshots read back from the database, not the object `Repository.save` returned: `numeric` columns change their string scale on the first read.
- Build banking rows with `BankingFixtures`; isolate data a test counts under its own seeded owner (the `OWN_TRANSFER_ACCOUNT_*` constants in `seed.constants.ts` are the example) so shared pagination fixtures keep their counts.
- New protected routes go into the tables in `test/e2e/auth/auth-guard.e2e.spec.ts`.
