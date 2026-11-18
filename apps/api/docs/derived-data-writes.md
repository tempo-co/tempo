# Derived data writes

Rules for code that writes values computed from bank transactions: categories, own transfers, currency exchanges, recurring series and merchant keys, whether from the worker, sync, a recompute, a rule or a migration. Identity, totals and concurrency are in `docs/banking-invariants.md`; the categorization lifecycle is in `docs/categorization.md`.

## Owner choices

- `updateCategory` → `setManualCategory` updates the one row and fans out only to the ids passed in `applyToTransactionIds`. A follow-up for those ids is retried via the queue if it fails; when the owner's choices for the merchant agree it writes `categorySource = 'HISTORY'`, and when they disagree it only sets those `HISTORY` rows back to `PENDING` for the model (`src/app/modules/banking/categorization/manual-category-follow-up.ts`).
- A correction changes only that row and the rows the owner selected. A past manual choice is never applied to new, re-synced or re-processed sibling rows; it reaches the model only as a history hint. Anything that writes categories outside this path (scripts, migrations) mirrors its field resets exactly and leaves rows that were not selected alone.
- Each write path has its own provenance marker. The own-transfer rule writes `categoryProvider = 'own-transfer'` with rule version `own-transfer-category-v1` and no `categorySource` (`src/app/modules/banking/own-transfer/own-transfer-category.ts`); applied follow-ups write `HISTORY`; the model writes `AI`; the owner writes `MANUAL`. A new path that reuses another's markers cannot be told apart from it by a later cleanup.
- Decisions about groups computed on read store the decided member ids. A hidden recurring series keeps the payments it was hidden on (`src/app/modules/banking/recurring/recurring-series-hide.entity.ts`), because a series' key changes when it is reclassified.

## Writes

- A rule-based bulk update is a single-table `UPDATE` with every guard (manual source, evidence, event type) on the target row and the new value as a `CASE` in `SET`. After a concurrent update, Postgres re-checks only the target row's own conditions, so a guard in a self-joined subquery lets a manual edit that committed first be overwritten. The own-transfer rule and `src/app/modules/banking/currency-exchange/currency-exchange-recompute.ts` follow this.
- Add `IS DISTINCT FROM` on the new value, so a rerun writes 0 rows.
- Exclude pending rows with a NULL-safe test, such as `UPPER("transactionStatus") IS DISTINCT FROM 'PDNG'` or `UPPER(BTRIM(COALESCE("transactionStatus", ''))) <> 'PDNG'`. A plain `<> 'PDNG'` also drops rows whose status is NULL.
- On a provider failure, keep a derived value that is still valid for the current input and mark the row failed for retry; blanking it lets an outage during a bulk recheck wipe every row.
- A rule that moves rows out of its own result hands them back: the own-transfer rule returns rows it categorized that are no longer own transfers to `PENDING`, clears their category, and enqueues them after the transaction commits.
