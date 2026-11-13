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
3. **Route** each statement to an account: the account the request names, else the owner's synced account with the file's IBAN and currency, else an "Imported files" account (connection `provider = 'file'`), created when needed. A file that names no account goes by bank and currency and is confirmed by the wrong-account guard.
4. **Match** against the account's stored rows with the ladder in `banking/bank-transaction-matcher.ts`: bank reference; amount, value date and balance after; the same day; the only candidate within 3 days. Rows whose references differ are never matched. What the ladder cannot decide becomes a doubtful row for the owner.
5. **Write** new rows, the import record and doubtful rows in one transaction, under the same lock a sync takes. A drop is all or nothing.
6. **After the commit**: currency exchanges and own transfers are recomputed, then categorization and merchant logos are queued, in the order a sync does.

The upload answers with the summary (rows added, already present, doubtful, date range, accounts). The uploaded bytes are never stored.

Undo (`DELETE /bank-imports/:id`) deletes the rows that import inserted and nothing else; rows a later sync adopted stay.

## Formats

| Format                    | Reader                                   | Notes                                                                           |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| CAMT.053                  | `camt053.ts`                             | Also zipped, several statements per archive.                                    |
| MT940                     | `mt940.ts`                               | Payee details only where a bank's free-text packing is known (ABN AMRO).        |
| OFX and QFX               | `ofx.ts`                                 | SGML and XML, bank and card statements. `LEDGERBAL` is not read.                |
| ABN AMRO TXT              | `abn-amro-txt.ts`                        |                                                                                 |
| Revolut CSV and Excel     | `revolut.ts`                             | Names no account; one statement per currency.                                   |
| Bank CSV layouts          | `csv-layout-reader.ts`, `csv-layouts.ts` | ING, Rabobank, bunq, Knab, ASN Bank. Layouts are data; every row must validate. |
| The owner's saved layouts | the same reader                          | Learned by the mapper, tried after everything built in, for that owner only.    |

Not read: QIF, PDF, old binary `.xls`. The built-in CSV layouts rest on public samples from 2018 to 2022 (`test/fixtures/file-import/SOURCES.md`); none has been checked against a current export.

Adding a bank's CSV export is a new entry in `csv-layouts.ts` with a fixture and a near-miss fixture, not a new parser. Write a parser only for a file that cannot be described as columns.

## Balances

A synced account keeps the balance sync reports. An imported-files account's balance is an anchor plus the rows booked after it (`banking/services/file-account-balance.service.ts`): the newest end-of-day balance its files state unambiguously, else a balance the owner entered. No balance history rows and no computed per-row balances are stored.

## The column mapper

For a table no reader claims (`layout_unknown`, or `layout_not_recognized` for a known header that does not validate):

1. `POST /bank-imports/layout-proposals` with the one file. The child finds the table; `parsers/table-mask.ts` decides everything the model may learn about it.
2. One Anthropic API call (`mapper/layout-mapper.ts`): no tools, no retry, 30 seconds, a fixed answer schema.
3. The answer becomes a layout, is validated, and must read the whole file. Only then is it offered, with a preview built from the owner's own rows.
4. The owner confirms (naming the bank, and the currency when the file states none). The layout is saved for that owner and the web sends the original drop again.

What the model is sent: the header as written; three rows and the lines around the table with every letter and digit masked; per column, the distinct masked shapes over the whole file and whether every row holds the same value. Sent as written besides the header: ISO currency codes and the few short repeated values of a direction column. This level was chosen by measurement: on 14 synthetic exports, showing the model letters, or everything but account numbers, mapped no file better. The rule for AI features in general is to send what the feature needs to work well and strip what it does not use.

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
