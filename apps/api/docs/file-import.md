# Statement file import

How `src/app/modules/file-import/` brings a bank's export files into the same tables bank sync writes. The banking rules imported and synced rows share are in `banking-invariants.md`.

## Switches

| Variable                     | Default | Effect                                                                                                   |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `FILE_IMPORT_ENABLED`        | `false` | The `/bank-imports` routes exist and the web shows "Import a file".                                      |
| `FILE_IMPORT_MAPPER_ENABLED` | `false` | A table in no known layout can have its columns worked out by one model call. Needs `ANTHROPIC_API_KEY`. |
| `FILE_IMPORT_MAPPER_MODEL`   | Sonnet  | The model of that call.                                                                                  |

Known formats never call a model. With the mapper off, or the API failing or out of credit, an unknown table is refused as not supported yet.

## One drop, start to end

1. **Upload** (`POST /bank-imports`, multipart). At most 20 files of 10 MB, 25 MB together and 20,000 rows (`src/app/modules/file-import/parsers/parse-limits.ts`, mirrored by the web before uploading). The route counts the body as it streams and refuses it with `drop_too_large` past 25 MB plus a 64 KB multipart allowance, whatever `Content-Length` says (a larger declared length before waiting). Files are held in memory only, so at most `MAX_CONCURRENT_UPLOADS` (2) uploads per API process are read and imported at once; later ones wait in arrival order before their body is read, up to 30 seconds (then `import_busy`, HTTP 503 with `Retry-After`), and leave the queue when their client leaves.
2. **Parse** in a short-lived child process (`src/app/modules/file-import/runner/`): 256 MB, 10 seconds, no database or network handle, and it loads the parsers alone (and `src/app/modules/file-import/parsers/parse-limits.ts` alone of the rest). Parsers are pure functions from bytes to `NormalizedStatement[]` (`src/app/modules/file-import/parsers/parse-result.ts`) and decide the format from the content, never the name. A statement stating both balances must reconcile (opening plus its booked entries equals closing), or it is `parse_failed`. The parent validates the child's whole answer before using it.
3. **Join** each account's statements per format, in sequence-number then date order, as if dropped one after another (`src/app/modules/file-import/statement-chain.ts`). One that opens at the previous closing balance is taken whole; otherwise its rows the ladder matches to earlier statements' rows of the same day count as already present. A statement that neither follows on nor repeats a row is a gap: imported, with its days and amount in `statementGaps`; on a synced account only days outside sync coverage, which may split it in two.
4. **Route** each statement to the account the request names (`bankAccountId`, or the `accountChoices` entry `<bank>:<currency>` of a file that names no account), else the owner's synced account with the file's IBAN and currency, else an "Imported files" account (connection `provider = 'file'`), created when needed. A file that names no account goes by bank and currency (to an active account when one fits) and must look like that account before anything is written (`isTargetConfirmed`): in the format with the most rows within the first and last day the account stores, once `UNCONFIRMED_TARGET_MIN_OVERLAP_ROWS` (5) fall there, the plain ladder (never the reference fallback: a file routed by bank alone carries no references) must match at least half of them, else the drop is refused with `target_account_unconfirmed`. A coincidental match or two does not confirm a wrong account. Two fitting synced accounts refuse it with `ambiguous_target_account`. A statement read by an owner's saved layout whose IBAN found an account, synced or imported, is checked the same way (the model chose where that IBAN came from) and asked about under the layout's bank. A statement of a built-in reader or layout goes by its IBAN unchecked. Both refusals list every statement needing an answer with its candidate accounts (inactive ones only when the statement was routed to one). The answer `new` goes to the imported-files account of that bank and currency, created when missing, so a later drop of that bank's files finds it again; once it exists it is a candidate and the question says `new` creates nothing (`newAccount: false`). An answered statement is not checked again.
5. **Match** against the account's stored rows with the ladder in `src/app/modules/banking/bank-transaction-matcher.ts`: bank reference; amount, value date and balance after; the same day; the only candidate within 3 days. The date steps never pair rows whose references are both present and differ; a row whose only nearby candidate has another reference is doubtful. The exception, decided per account and format of a drop, is a statement numbered in another scheme than sync's (`matchWithReferenceFallback`). A file row with a reference is probed when a synced row (no `importId`) of the same amount and currency at most 3 days away has one too. When `REFERENCE_FALLBACK_MIN_PROBED_ROWS` (20) were probed and none of the file's references is one sync stored, sync's references are set aside, the ladder runs with `uniqueCandidatesOnly`, and `pairLookAlikeGroups` pairs each same-day look-alike group as large on both sides, most similar counterparty and description first, then in stored order. A group of unequal size stays doubtful, and one shared reference keeps every reference. Rows an import stored keep theirs (`sameNumbering`), so a file row still conflicts with an earlier statement's row. Rows matched this way count as matched by date, or by balance, which never reads references. This runs only on a synced account the statement's own IBAN confirmed: routed there by it, or named by `bankAccountId` with that IBAN stored or behind its identification hash. Otherwise the plain ladder holds another account's statement rather than taking it as present. What the ladder cannot decide becomes a doubtful row.
6. **Final days.** On a day bank sync is final for (`finalSyncDays`), a row the ladder did not match, new or doubtful, is a payment sync never sent: it is neither added nor asked about (`decideOnFinalDays` in `src/app/modules/file-import/never-sent-rows.ts`). It is kept on the import as a `not_in_bank` row, counted in `rowsNotInBank` and listed under `GET /bank-imports/:importId/never-sent-rows`, where the owner adds rows one by one or a group at a time (`POST .../never-sent-rows/add`, at most 500 per request, all or none). Matched rows are skipped as on any day.
7. **Write** new rows through `persistTransactions` with `importId`, each at the next free occurrence of its group (it never matches, updates or writes a stored row), with the import record, doubtful and never-sent rows, in one transaction under the same lock a sync takes. A drop is all or nothing.
8. **After the commit**: currency exchanges and own transfers are recomputed, then categorization and merchant logos are queued, in the order a sync does.

The upload answers with the summary (rows added, already present, doubtful, never sent by the bank, removed by a later sync, date range, accounts, statement gaps). Uploaded bytes are never stored. `bank_import_doubtful_rows.kind` tells a question (`doubtful`) from a row the bank never sent: one the import left out (`not_in_bank`) or one a later sync removed from a final day (`removed_by_sync`). Both are listed and added through the never-sent endpoints; an added row is resolved `new` with the row it became. Log lines count never-sent and removed rows, never their content.

Undo (`DELETE /bank-imports/:id`) deletes the rows that import inserted (never-sent rows the owner added among them) and its open doubtful and never-sent rows, removed ones included, and nothing else; rows a later sync took over stay.

## Imported rows and later syncs

- **Takeover.** On an account holding imported rows, booked sync rows that would be inserted first run the ladder against them, the roles of step 4 swapped (the imports' references set aside when sync's never equal them). Two indistinguishable rows of one day may swap; nothing is added or lost. A booked row continuing a stored pending row is checked the same way, and its imported look-alike is never merged into it. Only on a day outside coverage does an imported look-alike left unmatched get a question on its import (`bank_import_doubtful_rows.importedTransactionId`, the synced rows as candidates; Check in the web): the same payment deletes the imported row after its manual category and own-transfer override move to the synced row where that has none; different payments keep both. Inside coverage nothing is asked: the day becomes final and the sweep settles it; questions already open there stay until answered or swept. A question goes when sync takes its row over, and with the row on undo.
- **Sweep** (`sweepImportedRows`). A removed row's snapshot stays on its import (`kind = 'removed_by_sync'`, its manual category and own-transfer override in `ownerEdits`), counted in `bank_imports.rowsRemovedBySync` instead of `rowsAdded` and added back with those edits, which also move to the closest synced look-alike that has none of its own (`pickCarryTargets`: same amount and currency within the match window, best pair first, one per removed row, never a row this write took over); recurring hides follow it there or drop the id. Its open questions go; answered ones stop pointing at it. Its former own-transfer counterparts and the override targets join the own-transfer recompute; the exchange recompute covers the owner as always. Never removed: rows this write took over (also one the upsert skipped), and any row a resolution `new` points at through `resolvedTransactionId`: a never-sent row added or added back, a doubtful row answered `new`, an imported row kept as a payment of its own.

## Formats

The formats read, what each reader takes from the text, and the built-in bank CSV layouts: `file-import-formats.md`.

## Balances

An imported-files account's balance is an anchor plus the rows booked after the anchor's day (`src/app/modules/banking/services/file-account-balance.service.ts`), recomputed in the transaction of every import, undo, row added as new and balance entered. The anchor is the newer of the newest of the last 30 booking days with stated balances whose rows close the day unambiguously (`findFileAnchor`) and the newest statement closing balance a live import recorded (CAMT `CLBD`, MT940 `:62F:`, OFX `LEDGERBAL` dated on or after its transactions; `bank_imports.closingBalances`, dated no earlier than the statement's last booking day), the rows' on a tie, else the balance the owner entered (`statedBalanceAmount`, dated their today), else none. `balanceUpdatedAt` is midnight UTC of the later of that day and the newest booking day, from which the balance trend derives its history. Removing a synced connection recomputes the accounts its imports anchored. No balance history rows and no computed per-row balances are stored. An imported row without a booking date takes its value date, else its transaction date, with `bookingDateFilled`.

## The column mapper

For a table no reader claims (`layout_unknown`, or `layout_not_recognized` for a known header that does not validate):

1. `POST /bank-imports/layout-proposals` with the one file. The child finds the table; `src/app/modules/file-import/parsers/table-mask.ts` decides everything the model may learn about it. A table with lines above it that look like rows (two or more cells like values, as rows wider than the rest are) is refused with `layout_not_mappable` before any call: a layout skipping those lines would drop them from every later file.
2. One Anthropic API call (`src/app/modules/file-import/mapper/layout-mapper.ts`): no tools, no retry, 30 seconds, a fixed answer schema.
3. The answer becomes a layout, is validated, and must read the whole file. Only then is it offered, with a preview built from the owner's own rows.
4. The owner confirms (naming the bank, and the currency when the file states none). The layout is saved for that owner and the web sends the original drop again.

What the model is sent: the header as written; three rows and the lines around the table with every letter and digit masked; per column, the distinct masked shapes over the whole file and whether every row holds the same value. Sent as written besides the header: ISO currency codes and the few short repeated values of a direction column. On 14 synthetic exports, showing the model letters, or everything but account numbers, mapped no file better. The rule for AI features in general is to send what the feature needs to work well and strip what it does not use.

A saved layout never skips lines that look like rows either: one that would is passed over, and when no other layout reads the file it is refused with `layout_not_mappable`.

Limits: 5 proposals per owner per day, a proposal lasts an hour, 50 saved layouts per owner. Proposals store the header and column shapes, never row content. Learned layouts are never shared between owners; a layout worth sharing is added to `src/app/modules/file-import/parsers/csv-layouts.ts` by a change like any other.

## Refusals

Every refusal is a typed code (`src/app/modules/file-import/bank-import-refusal.exception.ts`, mirrored in `@tempo/contracts`) and the web has copy for each (`apps/web/src/features/file-import/utils/refusal-copy.ts`). The parse child can only reach the codes in `PARSE_REFUSAL_CODES`.

## Measured (staging, one CPU each for API and database, synthetic data)

| Rows in one drop | Import time | Longest wait for other requests |
| ---------------- | ----------- | ------------------------------- |
| 300              | 0.8 s       | 0.4 s                           |
| 1,000            | 1.3 s       | 0.5 s                           |
| 5,000            | 3.9 s       | 0.6 s                           |
| 20,000           | 13 to 16 s  | 1.7 to 2.2 s                    |

Peak API memory stayed near 420 MB of 768 MB. The import runs inside the upload request: the owner gets the result at once, with no job state or stored uploads, at the cost of the wait above and two imports at a time. Repeat the measurement on any new host.

## Testing

Parsers have unit specs next to them with synthetic fixtures. `test/e2e/file-import/bank-import.e2e.spec.ts` covers the routes end to end with the model mocked (`provider-testing.md`). Fixtures are always synthetic; a real export never enters the repository.
