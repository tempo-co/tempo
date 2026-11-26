// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import type {BankBalanceTrend} from '@tempo/contracts';

import {accountBalancePoints} from '../../src/features/accounts/utils/account-balance-points';

const period = (end: string, balances: Record<string, string | null>, complete = true) => ({
  start: `${end.slice(0, 7)}-01`,
  end,
  complete,
  total: null,
  accounts: Object.entries(balances).map(([id, balance]) => ({id, balance})),
});

test("an account's balance line starts where its history does and keeps later gaps", () => {
  const trend: BankBalanceTrend = {
    baseCurrency: 'EUR',
    interval: 'month',
    periods: [
      period('2026-08-31', {other: '10.00', mine: null}),
      period('2026-09-30', {other: '10.00', mine: '1200.50'}),
      period('2026-10-31', {other: '10.00', mine: null}),
      period('2026-11-26', {other: '10.00', mine: '-40.05'}, false),
    ],
  };
  expect(accountBalancePoints(trend, 'mine')).toEqual([
    {month: '2026-09', end: '2026-09-30', complete: true, balance: 120050},
    {month: '2026-10', end: '2026-10-31', complete: true, balance: null},
    {month: '2026-11', end: '2026-11-26', complete: false, balance: -4005},
  ]);
  expect(accountBalancePoints(trend, 'missing')).toEqual([]);
});
