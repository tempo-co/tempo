# Statement file import

How `src/app/modules/file-import/` brings a bank's export files into the same tables bank sync writes. The rules that keep imported and synced data consistent are in `banking-invariants.md`; this page is the map.

## Switches

| Variable                     | Default | Effect                                                                                                   |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `FILE_IMPORT_ENABLED`        | `false` | The `/bank-imports` routes exist and the web shows "Import a file".                                      |
| `FILE_IMPORT_MAPPER_ENABLED` | `false` | A table in no known layout can have its columns worked out by one model call. Needs `ANTHROPIC_API_KEY`. |
| `FILE_IMPORT_MAPPER_MODEL`   | Sonnet  | The model of that call.                                                                                  |

Known formats never call a model. With the mapper off, or the API failing or out of credit, an unknown table is refused as not supported yet.

## One drop, start to end

1. **Upload** (`POST /bank-imports`, multipart). At most 20 files of 10 MB, 25 MB together and 20,000 rows (`parsers/parse-limits.ts`). Two uploads are held at a time; a third waits up to 30 seconds and is then refused with `import_busy`.
2. **Parse** in a short-lived child process (`runner/`): 256 MB, 10 seconds, no database or network handle, and it loads the parsers alone. Parsers are pure functions from bytes to `NormalizedStatement[]` (`parsers/parse-result.ts`) and decide the format from the content, never the name. The parent validates the child's whole answer before using it.
3. **Route** each statement to an account: the account the request names, else the owner's synced account with the file's IBAN and currency, else an "Imported files" account (connection `provider = 'file'`), created when needed. A file that names no account goes by bank and currency and is confirmed by the wrong-account guard (`isTargetConfirmed`: at least half of its rows within the dates the account holds, once 5 fall there, are stored there). So is a statement read by an owner's saved layout whose IBAN found an account, synced or imported, since the model chose the column or line that IBAN came from; when it is not confirmed the owner is asked under the layout's bank, and `new` puts it in the imported-files account of that bank and currency, where its later files then go. A statement of a built-in reader or layout goes by its IBAN unchecked.
4. **Match** against the account's stored rows with the ladder in `banking/bank-transaction-matcher.ts`: bank reference; amount, value date and balance after; the same day; the only candidate within 3 days. Rows whose references differ are never matched, except against references bank sync stored that the file never shares: some banks number their files in another scheme, so per account and format, when at least 20 rows were probed and none of the file's references is one sync stored, sync's references are set aside: rows match by balance or date, and a same-day look-alike group as large on both sides pairs, most similar counterparty and description first, then in stored order (`matchWithReferenceFallback` with `pairLookAlikeGroups`). This happens only on a synced account the statement's own IBAN confirmed: routed there by it, or named by `bankAccountId` with that IBAN stored or behind its identification hash. A statement sent to an account by `bankAccountId` or `accountChoices` without an agreeing IBAN keeps the plain ladder, so another account's statement is held rather than taken as present. What the ladder cannot decide becomes a doubtful row for the owner.
5. **Final days.** On a day bank sync is final for (`finalSyncDays`, see `banking-invariants.md`), a row the ladder did not match, new or doubtful, is a payment sync never sent: it is neither added nor asked about (`decideOnFinalDays` in `never-sent-rows.ts`). It is kept on the import as a `not_in_bank` row, counted in `rowsNotInBank` and listed under `GET /bank-imports/:importId/never-sent-rows`, where the owner adds rows one by one or a group at a time (`POST .../never-sent-rows/add`, at most 500 per request, all or none). Matched rows are skipped as on any day. Imported-files accounts and days outside the final range work as above.
6. **Write** new rows, the import record, doubtful and never-sent rows in one transaction, under the same lock a sync takes. A drop is all or nothing.
7. **After the commit**: currency exchanges and own transfers are recomputed, then categorization and merchant logos are queued, in the order a sync does.

The upload answers with the summary (rows added, already present, doubtful, never sent by the bank, removed by a later sync, date range, accounts). The uploaded bytes are never stored. `bank_import_doubtful_rows.kind` tells a question (`doubtful`) from a row the bank never sent: one the import left out (`not_in_bank`) or one of its rows a later sync removed from a final day (`removed_by_sync`, see `banking-invariants.md`). Both are listed under `GET /bank-imports/:importId/never-sent-rows` (each with its `kind`) and added through the same endpoint; a removed row comes back with its manual category and own-transfer override. An added never-sent row is resolved `new` with the row it became. No sync removes a row a resolution `new` points at, of any kind: a never-sent row added or added back, a doubtful row answered `new`, or an imported row a sync asked about and the owner kept as a payment of its own. The import's log line counts its never-sent rows, and the sync's log line counts the rows it removed, never their content. The import's summary shows `rowsRemovedBySync`; the list of imports does not.

Undo (`DELETE /bank-imports/:id`) deletes the rows that import inserted (never-sent rows the owner added among them) and its open doubtful and never-sent rows, removed ones included, and nothing else; rows a later sync adopted stay. When a later sync brings look-alikes it cannot match one to one on a day outside its coverage, it stores them as the bank sends them and asks about the imported row under its import (Check): the same payment removes the imported row, different payments keep both. Inside its coverage it asks nothing: the day becomes final, and the sweep settles it. Sync never waits for the answer.

## Formats

| Format                    | Reader                                   | Notes                                                                           |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| CAMT.053 and camt.052     | `camt053.ts`                             | Also zipped, several statements per archive. Booked entries only.               |
| MT940                     | `mt940.ts`, `mt940-information.ts`       | UTF-8 or latin-1. Payee from the three published `:86:` layouts (below).        |
| OFX and QFX               | `ofx.ts`                                 | SGML and XML, bank and card statements. `LEDGERBAL` is not read.                |
| ABN AMRO TXT              | `abn-amro-txt.ts`                        |                                                                                 |
| Revolut CSV and Excel     | `revolut.ts`                             | Names no account; one statement per currency.                                   |
| Bank CSV layouts          | `csv-layout-reader.ts`, `csv-layouts.ts` | The banks below. Layouts are data; every row must validate.                     |
| The owner's saved layouts | the same reader                          | Learned by the mapper, tried after everything built in, for that owner only.    |

What the standard readers take from the text, by general rule and never per bank:

- **MT940 `:86:`.** German `?nn` subfields (DK): name in `?32`/`?33`, account in `?31`, purpose in `?20` to `?29` and `?60` to `?63` (`SVWZ+` as the payment text, `EREF+` as the reference), posting text in `?00`; a full 27-character subfield runs on into the next without a space, and the description carries no subfield codes. SWIFT-style codes (`/CNTP/account/BIC/name/city/`, `/BENM//NAME/`, `/ORDP//NAME/`, `/REMI/`, `/EREF/`), written continuously, so wrapped lines join without a space. Otherwise free text, whose first line names the counterparty when it leads with an IBAN or is followed by more lines. ABN AMRO keeps its own reader (`abn-amro.ts`).
- **MT940 `:61:`.** Spaces in place of the entry date, a space before the transaction type and a two-letter type padded with a space are read; an entry without an entry date is booked on its value date (ABN AMRO: on the statement's date). A value date of the 29th to 31st in a shorter month (30/360 closing entries, such as 30 February) is that month's last day. A statement whose entries do not add up to its closing balance is still refused.
- **CAMT.** The remittance text is the unstructured lines, then structured text (`AddtlRmtInf`) and creditor references (`CdtrRefInf/Ref`: Belgian structured communication, RF, Swiss QR) as written. The ultimate creditor or debtor is the counterparty when no direct one is named, and is added to the description when it differs from the named one. A camt.052 report (`Rpt`) is read like a statement: pending entries are skipped, and balances come only from the opening and closing booked balances, never an interim one (`ITBD`).
- **OFX.** CDATA is text. A `BANKTRANLIST` left without its end tag is closed by the statement's end tag; every other aggregate needs its own. A bank account without an IBAN is named by `BANKID`, `BRANCHID` and `ACCTID` together, since an account number is unique only at its bank (UK sort codes, French bank and branch codes); a card by its `ACCTID`.

The built-in bank CSV layouts:

| Bank                     | Layouts                                                                                    | Notes                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| ING                      | `ing-nl` (comma, 9 columns), `ing-nl-11` (semicolon, 11 columns), `ing-en-11`, `ing-en`    | Dutch and English downloads. The 11-column export states the balance after each row.      |
| Rabobank                 | `rabobank-nl`, `rabobank-en`, `rabobank-creditcard`                                        | The credit card export names no account: it goes by bank and currency, as Revolut does, and an owner's layout naming no account cannot be called Rabobank. Several cards in one export are one account. |
| bunq                     | `bunq-nl`, `bunq-en` (6 columns), `bunq-en-7`, `bunq-en-7-semicolon` (with Interest Date)  | Amounts may group thousands with `.`.                                                     |
| Knab                     | `knab-nl` (with the `KNAB EXPORT` line), `knab-nl-no-preamble`                             | Amounts may group thousands with `.`.                                                     |
| ASN Bank, SNS, RegioBank | `asn-nl`                                                                                   | No header; the account is held at `ASNB`, `SNSB` or `RBRB`.                               |
| Triodos Bank             | `triodos-nl`                                                                               | No header; the account is held at `TRIO`; the other party's cell holds its BIC and IBAN. |

In any layout, a counterparty cell holding a BIC, a space and an IBAN (as Triodos writes it) is read as that IBAN.

Not read: QIF, PDF, old binary `.xls` (ABN AMRO's Excel download is one; its CAMT.053 and TXT are read). The built-in CSV layouts rest on public descriptions and samples from 2017 to 2026 (`test/fixtures/file-import/SOURCES.md`); none has been checked against a current export.

Adding a bank's CSV export is a new entry in `csv-layouts.ts` with a fixture and a near-miss fixture, not a new parser. Write a parser only for a file that cannot be described as columns.

## Balances

A synced account keeps the balance sync reports. An imported-files account's balance is an anchor plus the rows booked after it (`banking/services/file-account-balance.service.ts`): the newest end-of-day balance its files state unambiguously, else a balance the owner entered. No balance history rows and no computed per-row balances are stored.

## The column mapper

For a table no reader claims (`layout_unknown`, or `layout_not_recognized` for a known header that does not validate):

1. `POST /bank-imports/layout-proposals` with the one file. The child finds the table; `parsers/table-mask.ts` decides everything the model may learn about it. A table with lines above it that look like rows (two or more cells like values, as rows wider than the rest are) is refused with `layout_not_mappable` before any call: a layout skipping those lines would drop them from every later file.
2. One Anthropic API call (`mapper/layout-mapper.ts`): no tools, no retry, 30 seconds, a fixed answer schema.
3. The answer becomes a layout, is validated, and must read the whole file. Only then is it offered, with a preview built from the owner's own rows.
4. The owner confirms (naming the bank, and the currency when the file states none). The layout is saved for that owner and the web sends the original drop again.

What the model is sent: the header as written; three rows and the lines around the table with every letter and digit masked; per column, the distinct masked shapes over the whole file and whether every row holds the same value. Sent as written besides the header: ISO currency codes and the few short repeated values of a direction column. This level was chosen by measurement: on 14 synthetic exports, showing the model letters, or everything but account numbers, mapped no file better. The rule for AI features in general is to send what the feature needs to work well and strip what it does not use.

A saved layout never skips lines that look like rows either: one that would is passed over, and when no other layout reads the file it is refused with `layout_not_mappable`.

Limits: 5 proposals per owner per day, a proposal lasts an hour, 50 saved layouts per owner. Proposals store the header and column shapes, never row content. Learned layouts are never shared between owners; a layout worth sharing is added to `csv-layouts.ts` by a change like any other.

## Refusals

Every refusal is a typed code (`bank-import-refusal.exception.ts`, mirrored in `@tempo/contracts`) and the web has copy for each (`apps/web/src/features/file-import/utils/refusal-copy.ts`). The parse child can only reach the codes in `PARSE_REFUSAL_CODES`.

## Measured (staging, one CPU each for API and database, synthetic data, November 2026)

| Rows in one drop | Import time | Longest wait for other requests |
| ---------------- | ----------- | ------------------------------- |
| 300              | 0.8 s       | 0.4 s                           |
| 1,000            | 1.3 s       | 0.5 s                           |
| 5,000            | 3.9 s       | 0.6 s                           |
| 20,000           | 13 to 16 s  | 1.7 to 2.2 s                    |

Peak API memory stayed near 420 MB of 768 MB. The import runs inside the upload request by choice: it gives the owner the result at once and needs no job state or stored uploads. Its costs are the brief wait above and two imports at a time. Repeat the measurement on any new host; background processing is expected to arrive with PDF import.

## Testing

Parsers have unit specs next to them with synthetic fixtures. `test/e2e/file-import/bank-import.e2e.spec.ts` covers the routes end to end with the model mocked (`provider-testing.md`). Fixtures are always synthetic; a real export never enters the repository.
