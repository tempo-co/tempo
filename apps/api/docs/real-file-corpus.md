# Real-file corpus check

Synthetic fixtures prove each reader; this check proves the readers on real exports. A verified bank in `BANK_LIST` (`packages/contracts/src/banks.ts`) is one whose real export reads correctly here.

The corpus lives in the private repository tempo-co/tempo-import-corpus: public, anonymised real exports and bank-published example files, never a user's own export. Real files and anything taken from their rows never enter this repository or its tests.

## Running it

```sh
WISP_IMPORT_CORPUS=/path/to/corpus npm --prefix apps/api run test:corpus
WISP_IMPORT_CORPUS=/path/to/corpus npm --prefix apps/api run test:corpus -- -t pl-mbank   # one file
```

Point it at a clone of the corpus repository. It takes seconds. Without `WISP_IMPORT_CORPUS` it passes with a skip message. CI runs it as `API real-file corpus` (`docs/ci-and-images.md`). Its output is counts plus the id and problem of each failing file, never a row's content, since CI logs are public.

## What it checks

For every corpus file, `test/corpus/import-corpus.spec.ts` (harness in `test/corpus/import-corpus.ts`):

- reads it with `parseFile`, as an upload does, and compares every row field by field with the file's truth: date, value date, amount, currency, account, counterparty, the description texts and, for CSV files, the running balance. A file the truth expects refused must be refused with its code;
- imports it into an empty imported-files account the way an upload does (statements grouped and joined per account and format, the duplicate ladder against the stored rows, the new ones stored), then again: the second import adds nothing;
- computes the account balance as an import does and compares it with the balance the file states (the newest closing balance, or the running balance after the newest row);
- refuses three damaged copies, an altered amount, a removed middle row and a file cut mid-row, wherever the file's balances allow detecting them (a balance on every row, or an opening and a closing balance on every statement). Other files' damaged copies are counted, not required.

It fails when a verified bank has no passing file read by one of the readers the list names for it. Files of banks the list does not verify are checked, not required.

## The corpus repository

- corpus.json: one entry per file, with its id, path and bank id (a `BANK_LIST` id, or the id a later layout will use), and under `ownerProven` the verified banks proven only on the owner's own export, which never enters the corpus: the check names each instead of requiring a file;
- files/: the files, as published apart from the repairs SOURCES.md records;
- truth/: one truth file per entry, written by tools/truth.py from readers that share no code with Wisp (Python's csv module with a hand-written column spec per CSV file; readers written from the CAMT, MT940 and OFX specifications);
- SOURCES.md: per file its bank, source, licence, why it is included and any repair. A file damaged only by its anonymisation or publishing (hand-edited balances, invalid IBAN check digits, a garbled header, a line a sample repository added) is kept with only that damage repaired; a row the bank wrote is never changed beyond that.

Adding a bank's file: copy it in, add its entry (and a column spec for a CSV file), run tools/truth.py for it, read the truth against the file by eye, add its SOURCES.md row, run the check, then open a PR on the corpus repository. CI reads the corpus's `main`, so a change that alters a file's truth together with Wisp's readers merges in the same sitting as the Wisp PR, corpus first.

## Mapper rerun

`WISP_IMPORT_CORPUS_MAPPER=subscription` also asks the column mapper to map each CSV file and compares the layout's rows with the truth. It calls the local `claude` CLI on the signed-in subscription, with `ANTHROPIC_API_KEY` removed, never the paid API, and only when set by hand: each run costs model calls. `FILE_IMPORT_MAPPER_MODEL` picks the model.
