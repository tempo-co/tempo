# Statement file formats

The files `src/app/modules/file-import/parsers/` reads, for the import described in `file-import.md`.

| Format                    | Reader                              | Notes                                                                           |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| CAMT.053 and camt.052     | `src/app/modules/file-import/parsers/camt053.ts`                     | Also zipped, several statements per archive. Booked entries only.               |
| MT940                     | `src/app/modules/file-import/parsers/mt940.ts`, `src/app/modules/file-import/parsers/mt940-information.ts` | UTF-8 or latin-1. Payee from the three published `:86:` layouts (below). |
| OFX and QFX               | `src/app/modules/file-import/parsers/ofx.ts`                         | SGML and XML, bank and card statements. `LEDGERBAL` is not read.                |
| ABN AMRO TXT              | `src/app/modules/file-import/parsers/abn-amro-txt.ts`                |                                                                                 |
| Revolut CSV and Excel     | `src/app/modules/file-import/parsers/revolut.ts`                     | Names no account; one statement per currency.                                   |
| Bank CSV layouts          | `src/app/modules/file-import/parsers/csv-layout-reader.ts`, `src/app/modules/file-import/parsers/csv-layouts.ts` | The banks below. Layouts are data; every row must validate. |
| The owner's saved layouts | the same reader                      | Learned by the mapper, tried after everything built in, for that owner only.    |

What the standard readers take from the text, by general rule and never per bank:

- **MT940 `:86:`.** German `?nn` subfields (DK): name in `?32`/`?33`, account in `?31`, purpose in `?20` to `?29` and `?60` to `?63` (`SVWZ+` as the payment text, `EREF+` as the reference), posting text in `?00`; a full 27-character subfield runs on into the next without a space, and the description carries no subfield codes. SWIFT-style codes (`/CNTP/account/BIC/name/city/`, `/BENM//NAME/`, `/ORDP//NAME/`, `/REMI/`, `/EREF/`), written continuously, so wrapped lines join without a space. Otherwise free text, whose first line names the counterparty when it leads with an IBAN or is followed by more lines. ABN AMRO keeps its own reader (`src/app/modules/file-import/parsers/abn-amro.ts`).
- **MT940 `:61:`.** Spaces in place of the entry date, a space before the transaction type and a two-letter type padded with a space are read; an entry without an entry date is booked on its value date (ABN AMRO: on the statement's date). A value date of the 29th to 31st in a shorter month (30/360 closing entries, such as 30 February) is that month's last day. A statement whose entries do not add up to its closing balance is refused.
- **CAMT.** The remittance text is the unstructured lines, then structured text (`AddtlRmtInf`) and creditor references (`Ref` in `CdtrRefInf`: Belgian structured communication, RF, Swiss QR) as written. The ultimate creditor or debtor is the counterparty when no direct one is named, and is added to the description when it differs from the named one. A camt.052 report (`Rpt`) is read like a statement: pending entries are skipped, and balances come only from the opening and closing booked balances, never an interim one (`ITBD`).
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

Adding a bank's CSV export is a new entry in `src/app/modules/file-import/parsers/csv-layouts.ts` with a fixture and a near-miss fixture, not a new parser. Write a parser only for a file that cannot be described as columns.
