// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankAccount, BankConnection} from '@wisp/contracts';

import {groupAccounts} from '../../src/features/accounts/utils/account-groups';
import {MOCK_CONNECTION} from '../data/bank-connection.data';

const [current, savings] = MOCK_CONNECTION.bankAccounts;
const card: BankAccount = {
  ...current,
  id: '00000000-0000-4000-8000-0000000000c1',
  cashAccountType: 'CARD',
  currentBalanceAmount: '-312.40',
};
const files: BankConnection = {
  ...MOCK_CONNECTION,
  id: '00000000-0000-4000-8000-0000000000f1',
  provider: 'file',
  aspspName: 'Imported files',
  bankAccounts: [{...savings, id: '00000000-0000-4000-8000-0000000000f2', cashAccountType: null}],
};

const ids = (accounts: {account: BankAccount}[]) => accounts.map(({account}) => account.id);

test('accounts group by type, cash before credit, with each group and all of them totalled', () => {
  const result = groupAccounts([{...MOCK_CONNECTION, bankAccounts: [card, current]}, files]);
  // An account of no known type counts as cash.
  expect(result.groups.map(({type, label}) => [type, label])).toEqual([
    ['cash', 'Cash'],
    ['credit', 'Credit'],
  ]);
  expect(ids(result.groups[0].accounts)).toEqual([current.id, files.bankAccounts[0].id]);
  expect(ids(result.groups[1].accounts)).toEqual([card.id]);
  expect(result.groups.map(({total}) => total)).toEqual([
    {amount: 1335, currency: 'EUR'},
    {amount: -312.4, currency: 'EUR'},
  ]);
  expect(result.total).toEqual({amount: 1022.6, currency: 'EUR'});
  expect(result.unlinked).toEqual([]);
});

test('accounts of a connection in trouble come first in their group', () => {
  const healthy = {...MOCK_CONNECTION, id: 'healthy', bankAccounts: [current]};
  const expired = {
    ...MOCK_CONNECTION,
    id: 'expired',
    status: 'EXPIRED' as const,
    bankAccounts: [savings],
  };
  expect(ids(groupAccounts([healthy, expired]).groups[0].accounts)).toEqual([
    savings.id,
    current.id,
  ]);
});

test('balances in one currency add up in it; mixed currencies only in the reporting currency', () => {
  const inCurrencies = (base: string | null, accounts: Partial<BankAccount>[]) =>
    groupAccounts([
      {
        ...MOCK_CONNECTION,
        baseCurrency: base,
        bankAccounts: accounts.map((overrides, index) => ({
          ...current,
          id: String(index),
          ...overrides,
        })),
      },
    ]).total;

  expect(inCurrencies(null, [{currency: 'USD'}, {currency: 'USD'}])).toEqual({
    amount: 2469.12,
    currency: 'USD',
  });
  expect(inCurrencies(null, [{currency: 'EUR'}, {currency: 'USD'}])).toBeNull();
  expect(
    inCurrencies('EUR', [
      {currency: 'EUR', currentBalanceAmount: '100.00'},
      {currency: 'USD', currentBalanceAmount: '50.00', currentBalanceInBaseCurrency: '46.00'},
    ]),
  ).toEqual({amount: 146, currency: 'EUR'});
  // A balance without a conversion leaves the total unknown, except a zero, which needs none.
  expect(
    inCurrencies('EUR', [
      {currency: 'EUR'},
      {currency: 'USD', currentBalanceAmount: '50.00', currentBalanceInBaseCurrency: null},
    ]),
  ).toBeNull();
  expect(
    inCurrencies('EUR', [
      {currency: 'EUR', currentBalanceAmount: '10.00'},
      {currency: 'USD', currentBalanceAmount: '0.00', currentBalanceInBaseCurrency: null},
    ]),
  ).toEqual({amount: 10, currency: 'EUR'});
  // Accounts with no balance are left out; with none known there is no total.
  expect(
    inCurrencies('EUR', [
      {currentBalanceAmount: '10.00'},
      {currentBalanceAmount: null, latestBalances: []},
    ]),
  ).toEqual({amount: 10, currency: 'EUR'});
  expect(inCurrencies('EUR', [{currentBalanceAmount: null, latestBalances: []}])).toBeNull();
});

test('a bank connection without accounts is listed apart; an empty imported-files one is not', () => {
  const empty: BankConnection = {...MOCK_CONNECTION, id: 'empty', bankAccounts: []};
  const result = groupAccounts([empty, {...files, bankAccounts: []}]);
  expect(result.groups).toEqual([]);
  expect(result.unlinked.map(({id}) => id)).toEqual(['empty']);
  expect(result.total).toBeNull();
});
