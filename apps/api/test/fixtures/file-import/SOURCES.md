# Sources of the bank CSV and OFX fixtures

Every file here is synthetic: accounts are invented IBANs with valid check digits or published example IBANs, and names, amounts and references are made up. No public sample file was copied as it is. The bank CSV and OFX fixtures below reproduce the shape (columns, order, header, delimiter, quoting, encoding, date and amount format) of the public sources listed, which are also what each layout in `src/app/modules/file-import/parsers/csv-layouts.ts` rests on. Sources under a licence other than MIT were read for their facts only.

| Fixture | Shape taken from | Licence | Sample data from |
| --- | --- | --- | --- |
| `ing-synthetic.csv` | `tests/samples/ing_ok.csv` and `src/ofxstatement/plugins/nl/ing.py` in [gpaulissen/ofxstatement-dutch](https://github.com/gpaulissen/ofxstatement-dutch) at `1f4d6877d8033362df9e7160424c38449aead460`; the `[NL ING]` sections of `bank2ynab/data/bank2ynab.conf` in [bank2ynab/bank2ynab](https://github.com/bank2ynab/bank2ynab) at `9f3b3e89ea3d559d6c8e132d21d59659d45b7e82` | GPL-3.0 (facts only); MIT | 2019 and 2020 |
| `rabobank-synthetic.csv` | `test/test-data/CSV_A_20180414_112204.csv` and the `[NL Rabobank-2018]` section of `bank2ynab.conf` in bank2ynab at `9f3b3e89ea3d559d6c8e132d21d59659d45b7e82`; `nl/rabobank/rabobank-new-csv-format.json` in [firefly-iii/import-configurations](https://github.com/firefly-iii/import-configurations) at `cea1aa12a6ff5332b5f69a51f409eba5cd4b5135` | MIT; CC BY-SA 4.0 (facts only) | 2018 |
| `bunq-nl-synthetic.csv`, `bunq-en-synthetic.csv` | `test/test-data/2018-04-14_10-52-13_bunq-transactieoverzicht.csv` and `test/test-data/2019-03-02_11-50-46_bunq-statement.csv` in bank2ynab at `9f3b3e89ea3d559d6c8e132d21d59659d45b7e82` | MIT | 2018 and 2019 |
| `knab-synthetic.csv` | `tests/samples/Knab_transactieoverzicht_ok.csv` and `src/ofxstatement/plugins/nl/knab.py` in ofxstatement-dutch at `1f4d6877d8033362df9e7160424c38449aead460`; the `[NL KNAB]` section of `bank2ynab.conf` | GPL-3.0 (facts only); MIT | 2019 |
| `asn-synthetic.csv` | `tests/samples/transactie-historie_NL00ASNB9999999999_20220717204133.csv` and the field table in `src/ofxstatement/plugins/nl/asn.py` in ofxstatement-dutch at `1f4d6877d8033362df9e7160424c38449aead460`; `nl/asnbank/default.json` in firefly-iii/import-configurations | GPL-3.0 (facts only); CC BY-SA 4.0 (facts only) | 2022 |
| `ofx-sgml-synthetic.ofx` | `packages/loot-core/src/mocks/files/data.ofx` and `1252.qfx` in [actualbudget/actual](https://github.com/actualbudget/actual) at `435750e0c16b0119d8c9d1749a530b3bbe7d32af` | MIT | 2019 and 2022 |
| `ofx-card-synthetic.ofx` | `packages/loot-core/src/mocks/files/credit-card.ofx` in actualbudget/actual | MIT | 2023 |
| `qfx-synthetic.qfx` | `packages/loot-core/src/mocks/files/html-vals.qfx` in actualbudget/actual | MIT | 2023 |
| `ofx-xml-synthetic.ofx` | The OFX 2.x element names of the files above, written as XML | MIT | |

The OFX reader in `src/app/modules/file-import/parsers/ofx.ts` follows the structure of `packages/loot-core/src/server/transactions/import/ofx2json.ts` in actualbudget/actual at the same commit (MIT): the statement paths, the declared-charset decoding and the decimal comma. Its tokenizer is written for Tempo; no code was copied.

SNS Bank and RegioBank share ASN Bank's export family, but no public sample of their export was found, so no layout reads them.
