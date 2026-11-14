// Pure modules' contracts: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankImportError} from '@tempo/contracts';

import {
  formatDateRange,
  nothingNewCopy,
  undoDescription,
} from '../../src/features/file-import/utils/import-format';
import {
  describeRefusal,
  refuseBySize,
  toBankImportError,
} from '../../src/features/file-import/utils/refusal-copy';

const refusal = (fields: Partial<BankImportError>): BankImportError => ({
  statusCode: 422,
  message: 'Refused.',
  code: 'parse_failed',
  file: null,
  ...fields,
});

test('a refusal names its file only among several, and always says nothing was imported', () => {
  const names = ['statement-april.xml', 'statement-march.xml'];
  expect(describeRefusal(refusal({file: 2}), names)).toEqual({
    kind: 'refused',
    code: 'parse_failed',
    title: "This file couldn't be read",
    description:
      "statement-march.xml: Something in it doesn't add up. Download it again from your bank and retry. Nothing was imported.",
    retry: false,
    mapFile: null,
  });
  // One file needs no name; a refusal of the whole drop has none.
  for (const [file, fileNames] of [
    [1, ['statement-april.xml']],
    [null, names],
  ] as const) {
    expect(describeRefusal(refusal({file}), fileNames)).toMatchObject({
      description:
        "Something in it doesn't add up. Download it again from your bank and retry. Nothing was imported.",
    });
  }
  // A busy bank or a busy import is worth trying again with the same files; the rest need other files.
  expect(describeRefusal(refusal({code: 'account_busy', statusCode: 409}), names)).toMatchObject({
    title: 'This bank is syncing right now',
    description: 'Try again in a minute. Nothing was imported.',
    retry: true,
  });
  expect(describeRefusal(refusal({code: 'import_busy', statusCode: 503}), names)).toMatchObject({
    title: 'Other files are being imported',
    description: 'Try again in a minute. Nothing was imported.',
    retry: true,
  });
  expect(describeRefusal(refusal({code: 'drop_too_large', statusCode: 413}), names)).toEqual({
    kind: 'refused',
    code: 'drop_too_large',
    title: 'These files are too large together',
    description: 'Import them in smaller batches. Nothing was imported.',
    retry: false,
    mapFile: null,
  });
  // More files than one drop holds, or one archive with more statements than it may hold.
  expect(describeRefusal(refusal({code: 'too_many_files'}), names)).toMatchObject({
    title: 'Too many files at once',
    description:
      'One import can hold 20 files. Import them in smaller batches. Nothing was imported.',
  });
  expect(
    describeRefusal(refusal({code: 'too_many_files', file: 1}), ['statements.zip']),
  ).toMatchObject({
    title: 'This archive holds too many statements',
    description:
      'One archive can hold 500 statements. Split it into smaller archives. Nothing was imported.',
  });
});

test('a table in no layout Tempo knows is offered to have its columns worked out, only while that is on', () => {
  const names = ['statement-april.xml', 'export.csv'];
  expect(
    describeRefusal(refusal({code: 'layout_unknown', file: 2}), names, {mapper: true}),
  ).toEqual({
    kind: 'refused',
    code: 'layout_unknown',
    title: "Tempo doesn't know this file's layout yet",
    description:
      'export.csv: Tempo can work out which column is which. It sends the column headings and the shape of a few rows, with letters and digits masked, to its AI service. Nothing was imported.',
    retry: false,
    mapFile: 2,
  });
  // A file that only looks like a bank's export keeps that bank's advice beside the offer.
  expect(
    describeRefusal(refusal({code: 'layout_not_recognized', file: 1, layout: 'ing-nl'}), names, {
      mapper: true,
    }),
  ).toMatchObject({
    title: "This file doesn't look the way ING's exports usually do",
    description:
      'statement-april.xml: Try exporting it again, or use CAMT.053 or MT940 if your bank offers them. Tempo can also work out which column is which. It sends the column headings and the shape of a few rows, with letters and digits masked, to its AI service. Nothing was imported.',
    mapFile: 1,
  });
  expect(describeRefusal(refusal({code: 'layout_unknown', file: 1}), ['export.csv'])).toMatchObject(
    {
      description: "It isn't a layout Tempo knows yet. Nothing was imported.",
      mapFile: null,
    },
  );
  expect(
    describeRefusal(refusal({code: 'layout_not_recognized', file: 1, layout: 'ing-nl'}), ['a.csv']),
  ).toMatchObject({
    title: "This file doesn't look the way ING's exports usually do",
    mapFile: null,
  });
  expect(
    describeRefusal(refusal({code: 'layout_not_mappable', file: 1}), ['a.csv'], {mapper: true}),
  ).toMatchObject({
    description:
      'Nothing was imported. Try another export format from your bank, such as CAMT.053 or MT940.',
    mapFile: null,
  });
  // A failed try says so and is offered again.
  expect(
    describeRefusal(refusal({code: 'mapper_unavailable', file: 1}), ['a.csv'], {mapper: true}),
  ).toMatchObject({
    title: "Working out the columns didn't work this time",
    description:
      'Try again later. Each try counts towards the 5 allowed in 24 hours. Nothing was imported.',
    mapFile: 1,
  });
});

test('a choice of files too large for one drop is refused before uploading, as the API would', () => {
  const MB = 1024 * 1024;
  const sized = (...megabytes: number[]) => megabytes.map((size) => ({size: size * MB}));
  expect(refuseBySize(sized(10, 10, 5))).toBeNull();
  expect(refuseBySize(Array.from({length: 20}, () => ({size: 1})))).toBeNull();
  expect(refuseBySize(sized(10, 10, 5).concat({size: 1}))).toMatchObject({
    code: 'drop_too_large',
    file: null,
  });
  // The file over 10 MB is named by its position, like the API's refusal.
  expect(refuseBySize(sized(1).concat({size: 10 * MB + 1}))).toMatchObject({
    code: 'file_too_large',
    file: 2,
  });
  expect(refuseBySize(Array.from({length: 21}, () => ({size: 1})))).toMatchObject({
    code: 'too_many_files',
  });
});

test('an account question asks, unless it has nothing to ask', () => {
  const questions = [
    {
      bank: 'Example Bank',
      currency: 'EUR',
      candidates: [
        {
          bankAccountId: '00000000-0000-4000-8000-000000000301',
          name: 'Everyday',
          currency: 'EUR',
          bankName: 'Example Bank',
          imported: false,
        },
      ],
    },
  ];
  expect(
    describeRefusal(refusal({code: 'target_account_unconfirmed', accountQuestions: questions}), []),
  ).toEqual({kind: 'question', code: 'target_account_unconfirmed', questions});
  // A statement that names its own account is not asked about; its refusal is told plainly.
  expect(
    describeRefusal(refusal({code: 'ambiguous_target_account', accountQuestions: []}), []),
  ).toMatchObject({
    kind: 'refused',
    title: 'This file fits more than one account',
    description:
      'More than one of your accounts has the account number this file names. Nothing was imported.',
  });
});

test('only typed refusals and a proxy size limit count as refusals', () => {
  expect(toBankImportError(422, refusal({code: 'too_many_rows'}))?.code).toBe('too_many_rows');
  // The proxy's limit is on the whole upload, so its refusal reads like the API's for files too large together.
  expect(toBankImportError(413, {message: 'Request Entity Too Large'})?.code).toBe(
    'drop_too_large',
  );
  expect(toBankImportError(400, {message: 'Choose at least one file to import.'})).toBeNull();
  expect(toBankImportError(422, {code: 'something_new'})).toBeNull();
});

test('a drop that added nothing says what it found', () => {
  expect(nothingNewCopy({filesCount: 2, rowsAlreadyPresent: 1313})).toEqual({
    title: 'Nothing new in these files',
    description: 'All 1,313 transactions are already in Tempo.',
  });
  expect(nothingNewCopy({filesCount: 1, rowsAlreadyPresent: 1}).description).toBe(
    'The only transaction is already in Tempo.',
  );
  expect(nothingNewCopy({filesCount: 1, rowsAlreadyPresent: 0})).toEqual({
    title: 'Nothing new in this file',
    description: 'There are no transactions in this file.',
  });
});

test('the date range names the year once when both dates share it', () => {
  expect(formatDateRange('2026-05-01', '2026-10-30')).toBe('1 May – 30 Oct 2026');
  expect(formatDateRange('2025-12-01', '2026-01-31')).toBe('1 Dec 2025 – 31 Jan 2026');
  expect(formatDateRange('2026-05-01', '2026-05-01')).toBe('1 May 2026');
  expect(formatDateRange(null, null)).toBeNull();
});

test('undoing says what goes and what stays', () => {
  const account = (created: boolean) => ({
    id: '00000000-0000-4000-8000-000000000302',
    name: null,
    currency: 'EUR',
    created,
  });
  expect(
    undoDescription({rowsAdded: 212, accounts: [account(false)]}, {intoSyncedAccount: true}),
  ).toBe(
    'This removes the 212 transactions it added. Any that bank sync has picked up since then are kept.',
  );
  expect(
    undoDescription({rowsAdded: 1, accounts: [account(true)]}, {intoSyncedAccount: false}),
  ).toBe(
    'This removes the transaction it added. The account it created is removed too, unless another import also added transactions to it.',
  );
  expect(
    undoDescription(
      {rowsAdded: 0, accounts: [account(true), account(true)]},
      {intoSyncedAccount: false},
    ),
  ).toBe(
    'It added no transactions, so none are removed. The accounts it created are removed too, unless another import also added transactions to them.',
  );
});
