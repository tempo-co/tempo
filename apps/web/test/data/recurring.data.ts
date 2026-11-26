import type {Page} from '@playwright/test';
import type {
  RecurringPaidPayment,
  RecurringSeries,
  RecurringSeriesList,
  RecurringSeriesLists,
} from '@tempo/contracts';

import {fulfillJson, mockBankConnections, mockJson} from '../utils/api-mocks';
import {createAccount} from './account.data';

/** A synthetic monthly bill, due on the 3rd; tests override what they check. */
export function recurringSeries(
  overrides: Partial<RecurringSeries> & Pick<RecurringSeries, 'key' | 'name'>,
) {
  return {
    direction: 'EXPENSE',
    cadence: 'MONTHLY',
    amountKind: 'FIXED',
    currency: 'EUR',
    typicalAmount: '30.00',
    latestAmount: '30.00',
    monthlyEquivalent: '30.00',
    transactionCount: 6,
    firstDate: '2026-04-03',
    lastDate: '2026-09-03',
    nextExpectedDate: '2026-10-03',
    anchorDay: 3,
    status: 'ACTIVE',
    flags: [],
    priceChange: null,
    hidden: false,
    continuation: null,
    amountRange: null,
    recentPayments: [],
    category: 'ENTERTAINMENT',
    merchantLogoUrl: null,
    thisMonth: {paid: [], due: []},
    ...overrides,
  } satisfies RecurringSeries;
}

const sum = (payments: Pick<RecurringPaidPayment, 'amount'>[]) =>
  (
    payments.reduce((total, {amount}) => total + Math.round(Number(amount ?? 0) * 100), 0) / 100
  ).toFixed(2);

/** One direction as the API answers it: only counted series have a month, and the list's month adds theirs up. */
function recurringList(entries: RecurringSeries[], month: string): RecurringSeriesList {
  const shown = entries.map((entry) =>
    !entry.hidden && entry.status === 'ACTIVE' ? entry : {...entry, thisMonth: null},
  );
  const months = shown.flatMap(({thisMonth}) => (thisMonth ? [thisMonth] : []));
  const total = shown
    .filter(({thisMonth}) => thisMonth !== null)
    .reduce((cents, entry) => cents + Math.round(Number(entry.monthlyEquivalent ?? 0) * 100), 0);
  return {
    // Shown before hidden, as the API sorts them.
    series: [...shown].sort((a, b) => Number(a.hidden) - Number(b.hidden)),
    monthlyTotal: (total / 100).toFixed(2),
    unconvertedCount: shown.filter(
      ({thisMonth, monthlyEquivalent}) => thisMonth !== null && monthlyEquivalent === null,
    ).length,
    thisMonth: {
      month,
      paid: sum(months.flatMap(({paid}) => paid)),
      remaining: sum(months.flatMap(({due}) => due)),
    },
    baseCurrency: 'EUR',
  };
}

/** The list response: bills and income from one read. */
export function recurringLists(
  expenses: RecurringSeries[],
  income: RecurringSeries[] = [],
  month = '2026-10',
): RecurringSeriesLists {
  return {expenses: recurringList(expenses, month), income: recurringList(income, month)};
}

const key = (index: number) => index.toString(16).padStart(32, 'a');

/** A demo month on 15 October: a few bills paid, one late, some to come, and a salary. */
export function demoRecurring(): RecurringSeriesLists {
  return recurringLists(
    [
      recurringSeries({
        key: key(1),
        name: 'Example Landlord',
        typicalAmount: '1150.00',
        latestAmount: '1150.00',
        monthlyEquivalent: '1150.00',
        category: 'HOUSING_AND_UTILITIES',
        lastDate: '2026-10-01',
        nextExpectedDate: '2026-11-01',
        anchorDay: 1,
        thisMonth: {paid: [{date: '2026-10-01', amount: '1150.00'}], due: []},
      }),
      recurringSeries({
        key: key(2),
        name: 'Example Gym',
        typicalAmount: '34.95',
        latestAmount: '34.95',
        monthlyEquivalent: '34.95',
        nextExpectedDate: '2026-10-12',
        anchorDay: 12,
        flags: ['LATE'],
        thisMonth: {paid: [], due: [{date: '2026-10-12', amount: '34.95', late: true}]},
      }),
      recurringSeries({
        key: key(3),
        name: 'Example Mobile',
        typicalAmount: '24.00',
        latestAmount: '24.00',
        monthlyEquivalent: '24.00',
        nextExpectedDate: '2026-10-23',
        anchorDay: 23,
        thisMonth: {paid: [], due: [{date: '2026-10-23', amount: '24.00', late: false}]},
      }),
      recurringSeries({
        key: key(4),
        name: 'Example Water',
        cadence: 'QUARTERLY',
        typicalAmount: '61.20',
        latestAmount: '61.20',
        monthlyEquivalent: '20.40',
        nextExpectedDate: '2026-12-31',
        anchorDay: 31,
      }),
    ],
    [
      recurringSeries({
        key: key(5),
        name: 'Example Employer',
        direction: 'INCOME',
        typicalAmount: '3150.00',
        latestAmount: '3150.00',
        monthlyEquivalent: '3150.00',
        category: 'INCOME',
        lastDate: '2026-10-04',
        nextExpectedDate: '2026-11-04',
        anchorDay: 4,
        thisMonth: {paid: [{date: '2026-10-04', amount: '3150.00'}], due: []},
      }),
    ],
  );
}

/**
 * The worst realistic month, all synthetic: a long legal payee name with two flags, a weekly bill paid four times,
 * a large bill in another currency, one not converted yet, a non-Latin name, a one-letter name, eight bills on the
 * 1st, one still late from September, a six-figure salary and forty more bills.
 */
export function worstCaseRecurring(): RecurringSeriesLists {
  const onTheFirst = Array.from({length: 8}, (_, index) =>
    recurringSeries({
      key: key(100 + index),
      name: `Example Subscription Service ${index + 1}`,
      typicalAmount: '9.99',
      latestAmount: '9.99',
      monthlyEquivalent: '9.99',
      lastDate: '2026-10-01',
      nextExpectedDate: '2026-11-01',
      anchorDay: 1,
      thisMonth: {paid: [{date: '2026-10-01', amount: '9.99'}], due: []},
    }),
  );
  const more = Array.from({length: 40}, (_, index) =>
    recurringSeries({
      key: key(200 + index),
      name: `Example Bill ${index + 1}`,
      cadence: 'YEARLY',
      typicalAmount: '1234.56',
      latestAmount: '1234.56',
      monthlyEquivalent: '102.88',
      nextExpectedDate: '2027-02-14',
      anchorDay: 14,
    }),
  );
  return recurringLists(
    [
      recurringSeries({
        key: key(10),
        name: 'Example International Holdings Netherlands B.V. Facilities Department',
        amountKind: 'VARIABLE',
        typicalAmount: '98765.43',
        latestAmount: '123456.78',
        monthlyEquivalent: '98765.43',
        amountRange: {low: '87654.32', high: '123456.78'},
        nextExpectedDate: '2026-10-07',
        anchorDay: 7,
        flags: ['LATE', 'HIGHER_THAN_USUAL'],
        thisMonth: {paid: [], due: [{date: '2026-10-07', amount: '98765.43', late: true}]},
      }),
      recurringSeries({
        key: key(11),
        name: 'Example Weekly Vegetable Box Delivery',
        cadence: 'WEEKLY',
        anchorDay: null,
        typicalAmount: '42.50',
        latestAmount: '42.50',
        monthlyEquivalent: '184.17',
        lastDate: '2026-10-14',
        nextExpectedDate: '2026-10-21',
        priceChange: {amount: '2.50', since: '2026-09-02'},
        thisMonth: {
          paid: ['2026-10-01', '2026-10-07', '2026-10-14'].map((date) => ({
            date,
            amount: '42.50',
          })),
          due: ['2026-10-21', '2026-10-28'].map((date) => ({date, amount: '42.50', late: false})),
        },
      }),
      recurringSeries({
        key: key(12),
        name: 'Example Zürich Versicherungs-Gesellschaft',
        currency: 'CHF',
        cadence: 'QUARTERLY',
        typicalAmount: '11482.40',
        latestAmount: '11482.40',
        monthlyEquivalent: '4083.12',
        nextExpectedDate: '2026-10-28',
        anchorDay: 28,
        thisMonth: {paid: [], due: [{date: '2026-10-28', amount: '12249.36', late: false}]},
      }),
      recurringSeries({
        key: key(13),
        name: 'Example Overseas Hosting',
        currency: 'USD',
        typicalAmount: '19.00',
        latestAmount: '19.00',
        monthlyEquivalent: null,
        lastDate: '2026-10-09',
        nextExpectedDate: '2026-11-09',
        anchorDay: 9,
        thisMonth: {paid: [{date: '2026-10-09', amount: null}], due: []},
      }),
      recurringSeries({
        key: key(14),
        name: '東京ガス株式会社',
        typicalAmount: '88.00',
        latestAmount: '88.00',
        monthlyEquivalent: '88.00',
        nextExpectedDate: '2026-09-30',
        anchorDay: 30,
        flags: ['LATE'],
        thisMonth: {
          paid: [],
          due: [
            {date: '2026-09-30', amount: '88.00', late: true},
            {date: '2026-10-30', amount: '88.00', late: false},
          ],
        },
      }),
      recurringSeries({
        key: key(15),
        name: 'Q',
        typicalAmount: '1.00',
        latestAmount: '1.00',
        monthlyEquivalent: '1.00',
        nextExpectedDate: '2026-10-31',
        anchorDay: 31,
        thisMonth: {paid: [], due: [{date: '2026-10-31', amount: '1.00', late: false}]},
      }),
      recurringSeries({
        key: key(16),
        name: 'Example Discontinued Magazine Subscription Ltd',
        status: 'ENDED',
        lastDate: '2026-03-03',
      }),
      recurringSeries({
        key: key(17),
        name: 'Example Hidden Transfer',
        hidden: true,
        nextExpectedDate: '2026-10-20',
      }),
      ...onTheFirst,
      ...more,
    ],
    [
      recurringSeries({
        key: key(20),
        name: 'Example International Holdings Netherlands B.V. Payroll Department',
        direction: 'INCOME',
        typicalAmount: '123456.78',
        latestAmount: '123456.78',
        monthlyEquivalent: '123456.78',
        category: 'INCOME',
        nextExpectedDate: '2026-10-25',
        anchorDay: 25,
        thisMonth: {paid: [], due: [{date: '2026-10-25', amount: '123456.78', late: false}]},
      }),
    ],
  );
}

/** Answers the Recurring page's reads from `lists`, with no payments behind any series. */
export async function mockRecurringPage(page: Page, lists: RecurringSeriesLists) {
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000302',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
  await mockBankConnections(page, () => []);
  await page.route('**/bank-transactions?**', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? fulfillJson(route, {transactions: [], total: 0})
      : route.continue(),
  );
  await page.route('**/recurring-series?**', (route) => fulfillJson(route, lists));
}
