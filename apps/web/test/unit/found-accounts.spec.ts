// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankImportPreviewAccount} from '@tempo/contracts';

import {importedAccountIds} from '../../src/features/file-import/utils/found-accounts';

const found = (fields: Partial<BankImportPreviewAccount>): BankImportPreviewAccount => ({
  id: null,
  name: 'Example Bank EUR',
  alias: null,
  details: null,
  cashAccountType: null,
  maskedIdentifier: null,
  currency: 'EUR',
  bankName: 'Example Bank',
  imported: true,
  rowCount: 3,
  dateFrom: '2026-03-02',
  dateTo: '2026-03-10',
  ...fields,
});

const summaryAccount = (id: string, created: boolean, name = 'Example Bank EUR') => ({
  id,
  name,
  currency: 'EUR',
  created,
});

test('each previewed account maps to the account its import wrote to, same-named new ones in order', () => {
  const accounts = [
    found({id: 'kept-account'}),
    found({}),
    found({}),
    found({name: 'Example Bank USD', currency: 'USD'}),
  ];
  const summary = {
    accounts: [
      summaryAccount('kept-account', false),
      summaryAccount('first-new', true),
      summaryAccount('second-new', true),
    ],
  };

  // The USD account was not in the import, so it has nothing to rename.
  expect(importedAccountIds(accounts, summary)).toEqual([
    'kept-account',
    'first-new',
    'second-new',
    null,
  ]);
  // Imported again after a reply that was lost, the account the first try created is found, not created.
  expect(importedAccountIds([found({})], {accounts: [summaryAccount('first-new', false)]})).toEqual(
    ['first-new'],
  );
  // Even when the summary lists them the other way round, a found account is never a new one's.
  expect(
    importedAccountIds([found({}), found({id: 'kept-account'})], {
      accounts: [summaryAccount('kept-account', false), summaryAccount('first-new', false)],
    }),
  ).toEqual(['first-new', 'kept-account']);
  // A found account the import did not write to has nothing to rename either.
  expect(importedAccountIds([found({id: 'other-account'})], summary)).toEqual([null]);
});
