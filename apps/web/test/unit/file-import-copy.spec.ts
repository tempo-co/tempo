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
  // A busy bank is worth trying again with the same files; the rest need other files.
  expect(describeRefusal(refusal({code: 'account_busy', statusCode: 409}), names)).toMatchObject({
    title: 'This bank is syncing right now',
    description: 'Try again in a minute. Nothing was imported.',
    retry: true,
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
  expect(toBankImportError(413, {message: 'Request Entity Too Large'})?.code).toBe(
    'file_too_large',
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
