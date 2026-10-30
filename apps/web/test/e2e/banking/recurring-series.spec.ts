import type {Page} from '@playwright/test';
import {
  type BankTransaction,
  type RecurringSeries,
  type RecurringSeriesList,
  type RecurringSeriesLists,
} from '@tempo/contracts';

import {formatBankTransactionCompactDate} from '../../../src/features/banking/utils/formatters';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// Every API call is mocked, so no seeded session is needed.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const GYM_KEY = 'a'.repeat(32);
const STREAMING_KEY = 'b'.repeat(32);
const ENERGY_KEY = 'c'.repeat(32);
const OLD_KEY = 'd'.repeat(32);
const SALARY_KEY = 'e'.repeat(32);
const PHONE_KEY = 'f'.repeat(32);

function series(overrides: Partial<RecurringSeries> & Pick<RecurringSeries, 'key' | 'name'>) {
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
    status: 'ACTIVE',
    flags: [],
    priceChange: null,
    hidden: false,
    continuation: null,
    amountRange: null,
    recentPayments: [],
    category: 'SUBSCRIPTIONS',
    merchantLogoUrl: null,
    ...overrides,
  } satisfies RecurringSeries;
}

/** The list response: bills and income from one read. */
function listsOf(
  expenses: RecurringSeries[],
  income: RecurringSeries[] = [],
): RecurringSeriesLists {
  return {expenses: listOf(expenses), income: listOf(income)};
}

function listOf(entries: RecurringSeries[]): RecurringSeriesList {
  const counted = entries.filter(({hidden, status}) => !hidden && status === 'ACTIVE');
  const total = counted.reduce((sum, entry) => sum + Number(entry.monthlyEquivalent), 0);
  return {
    // Shown before hidden, as the API sorts them.
    series: [...entries].sort((a, b) => Number(a.hidden) - Number(b.hidden)),
    monthlyTotal: total.toFixed(2),
    unconvertedCount: 0,
    // Synthetic: a third of the month's total paid, the rest still due.
    thisMonth: {
      month: '2026-10',
      paid: (total / 3).toFixed(2),
      remaining: (total - Number((total / 3).toFixed(2))).toFixed(2),
    },
    baseCurrency: 'EUR',
  };
}

/** Synthetic series behind a fake API that hides and unlinks the way the real one does. */
async function mockRecurring(page: Page) {
  const state = {
    expenses: [
      series({
        key: GYM_KEY,
        name: 'Example Gym',
        cadence: 'FOUR_WEEKLY',
        typicalAmount: '24.00',
        latestAmount: '24.00',
        monthlyEquivalent: '26.00',
        firstDate: '2026-04-17',
        lastDate: '2026-09-04',
        nextExpectedDate: '2026-10-02',
      }),
      series({
        key: STREAMING_KEY,
        name: 'Example Streaming',
        typicalAmount: '14.99',
        latestAmount: '14.99',
        monthlyEquivalent: '14.99',
        priceChange: {amount: '2.00', since: '2026-08-03'},
      }),
      series({
        key: ENERGY_KEY,
        name: 'Example Energy',
        amountKind: 'VARIABLE',
        typicalAmount: '78.50',
        latestAmount: '160.00',
        monthlyEquivalent: '85.00',
        amountRange: {low: '48.00', high: '160.00'},
        recentPayments: [
          {date: '2026-04-05', amount: '61.00'},
          {date: '2026-05-05', amount: '95.00'},
          {date: '2026-06-05', amount: '48.00'},
          {date: '2026-07-05', amount: '80.00'},
          {date: '2026-08-05', amount: '77.00'},
          {date: '2026-09-05', amount: '160.00'},
        ],
        flags: ['LATE', 'HIGHER_THAN_USUAL'],
      }),
      series({key: OLD_KEY, name: 'Example Old Plan', status: 'ENDED', lastDate: '2026-03-03'}),
      series({
        key: PHONE_KEY,
        name: 'Example Phone',
        typicalAmount: '5.50',
        latestAmount: '5.50',
        monthlyEquivalent: '5.50',
        priceChange: {amount: '-3.50', since: '2026-01-23'},
      }),
    ] as RecurringSeries[],
    income: [
      series({
        key: SALARY_KEY,
        name: 'Example Employer',
        direction: 'INCOME',
        typicalAmount: '2500.00',
        latestAmount: '2500.00',
        monthlyEquivalent: '2500.00',
        nextExpectedDate: '2026-10-25',
      }),
    ] as RecurringSeries[],
    writes: [] as Array<{key: string; hidden?: boolean; linked?: boolean}>,
    listReads: [] as string[],
  };
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000300',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, () => []);
  // A series' detail reads its payments; specs that check them register their own answer.
  await page.route('**/bank-transactions?**', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? fulfillJson(route, {transactions: [], total: 0})
      : route.continue(),
  );
  await page.route('**/recurring-series?**', (route) => {
    state.listReads.push(new URL(route.request().url()).search);
    return fulfillJson(route, listsOf(state.expenses, state.income));
  });
  await page.route('**/recurring-series/*/hidden', (route) => {
    const parts = route.request().url().split('/');
    const key = parts[parts.length - 2];
    const {hidden} = route.request().postDataJSON() as {hidden: boolean};
    state.writes.push({key, hidden});
    const hide = (entry: RecurringSeries) => (entry.key === key ? {...entry, hidden} : entry);
    state.expenses = state.expenses.map(hide);
    state.income = state.income.map(hide);
    return route.fulfill({status: 204});
  });
  return state;
}

/** Synthetic source rows returned by the drill endpoint, not input to a browser-side detector. */
function payment(
  index: number,
  fields: Pick<
    BankTransaction,
    'bookingDate' | 'displayDescription' | 'amount' | 'bankAccountAlias'
  >,
): BankTransaction {
  return {
    id: `00000000-0000-4000-8000-${String(400 + index).padStart(12, '0')}`,
    transactionDate: fields.bookingDate,
    valueDate: fields.bookingDate,
    description: fields.displayDescription ?? null,
    counterpartyName: fields.displayDescription ?? null,
    currency: 'EUR',
    creditDebitIndicator: 'DBIT',
    direction: 'EXPENSE',
    transactionType: 'DIRECT_DEBIT',
    transactionStatus: 'BOOK',
    providerTransactionDescription: null,
    merchantCategoryCode: null,
    remittanceInformation: null,
    balanceAfterAmount: null,
    balanceAfterCurrency: null,
    instructedAmount: null,
    instructedCurrency: null,
    exchangeRate: null,
    exchangeRateUnitCurrency: null,
    exchangeRateType: null,
    referenceNumber: null,
    referenceNumberScheme: null,
    bankName: 'Example Bank',
    bankCountry: 'NL',
    bankAccountName: 'Example Account',
    category: 'SUBSCRIPTIONS',
    categoryStatus: 'COMPLETED',
    categorySource: 'MANUAL',
    categoryConfidence: null,
    financialEventType: null,
    financialEventSource: null,
    financialEventRuleVersion: null,
    cashFlowTreatment: 'EXPENSE',
    merchantLogoUrl: null,
    ownTransfer: null,
    ownTransferOverride: null,
    currencyExchangeCounterpart: null,
    amountInBaseCurrency: null,
    baseAmountMethod: null,
    baseAmountRateDate: null,
    ...fields,
  };
}

const row = (page: Page, key: string) => page.getByTestId(`recurring-series-${key}`);
const summaryOf = (page: Page) => page.getByTestId('recurring-summary');
const detail = (page: Page) => page.getByRole('region', {name: 'Recurring payment details'});

/** Opens a series' details from its row. */
async function openSeries(page: Page, key: string) {
  await row(page, key).getByRole('button').click();
  await expect(detail(page)).toBeVisible();
}

/** Back from a series' details to its list. */
async function backToList(page: Page, direction: 'bills' | 'income' = 'bills') {
  await detail(page)
    .getByRole('button', {name: `All ${direction}`})
    .click();
  await expect(detail(page)).toBeHidden();
}

/** Each fact is a label over one value: two text lines, never a third, and neither cut off. */
async function expectFactsOnTwoLines(page: Page) {
  const facts = detail(page).getByTestId('recurring-fact');
  await expect(facts).toHaveCount(4);
  for (const fact of await facts.all()) {
    const {lines, cut} = await fact.evaluate((element) => {
      // Distinct line tops of the rendered text, ignoring the boxes around it.
      const tops = new Set<number>();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
      }
      const cut = [...element.children].some((child) => child.scrollWidth > child.clientWidth);
      return {lines: tops.size, cut};
    });
    expect({lines, cut}, await fact.innerText()).toEqual({lines: 2, cut: false});
  }
}

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`counts every payment and hides one as not recurring with undo at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date('2026-10-01T10:00:00Z'));
    const state = await mockRecurring(page);
    await page.goto('/?recurring=open');

    await expect(page.getByRole('dialog', {name: 'Recurring payments'})).toBeVisible();
    // Rows are grouped by when they are next due; today is 1 Oct.
    await expect(page.getByRole('region', {name: 'Late'})).toContainText('Example Energy');
    await expect(page.getByRole('region', {name: 'Next 7 days'})).toContainText('Example Gym');
    await expect(page.getByRole('region', {name: 'Next 7 days'})).toContainText(
      'Example Streaming',
    );
    // Payment amount, monthly contribution and forecast date come from the API independently.
    await expect(row(page, GYM_KEY)).toContainText('Every 4 weeks · Tomorrow');
    await expect(row(page, GYM_KEY)).toContainText('€24.00');
    await expect(row(page, GYM_KEY)).toContainText('€26.00 a month');
    // Bills and income come from one request.
    expect(state.listReads).toHaveLength(1);
    expect(new URLSearchParams(state.listReads[0]).has('direction')).toBe(false);
    // Gym, streaming at its new price, energy and phone; the ended plan does not count.
    await expect(summaryOf(page)).toContainText('€131.49a month · 4 bills');
    await expect(summaryOf(page)).toContainText('€43.83paid in October');
    await expect(summaryOf(page)).toContainText('€87.66still due');
    await expect(row(page, STREAMING_KEY)).toContainText('€14.99');
    await expect(row(page, STREAMING_KEY)).toContainText('+€2.00 since Aug');
    await expect(row(page, PHONE_KEY)).toContainText('−€3.50 since Jan');
    // A late bill says so before anything else on its row.
    await expect(row(page, ENERGY_KEY)).toContainText('≈ €78.50');
    await expect(row(page, ENERGY_KEY)).toContainText('Not paid yet');
    // Rows match transaction rows elsewhere: 60px tall with a 36px tile, even with a second amount line.
    // Measure once the dialog has finished scaling in.
    await page
      .getByRole('dialog', {name: 'Recurring payments'})
      .evaluate((dialog) =>
        Promise.all(dialog.getAnimations({subtree: true}).map((animation) => animation.finished)),
      );
    for (const key of [GYM_KEY, STREAMING_KEY]) {
      const [rowBox, tileBox] = await Promise.all([
        boxOf(row(page, key).getByRole('button')),
        boxOf(row(page, key).getByTestId('merchant-logo-tile')),
      ]);
      expect({row: rowBox.height, tile: [tileBox.width, tileBox.height]}).toEqual({
        row: 60,
        tile: [36, 36],
      });
    }
    // Ended series stay folded away until asked for.
    await expect(row(page, OLD_KEY)).toBeHidden();
    await page.getByText('Ended (1)').click();
    await expect(row(page, OLD_KEY)).toContainText('Last 3 Mar');
    await expectNoHorizontalOverflow(page);

    // A varying bill's details show its range and say its latest payment was high.
    await openSeries(page, ENERGY_KEY);
    await expect(detail(page)).toContainText('Example Energy');
    await expect(detail(page)).toContainText('Usually≈ €79');
    await expect(detail(page)).toContainText('Last 6 €48.00–€160.00');
    await expectFactsOnTwoLines(page);
    await expect(detail(page)).toContainText('Last payment €160.00, higher than usual');
    await expect(detail(page)).toContainText('Expected 3 Oct, not paid yet');
    await expectNoHorizontalOverflow(page);

    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
    await expect(
      detail(page).getByRole('button', {name: 'Count as recurring again'}),
    ).toBeVisible();
    await backToList(page);
    await expect(summaryOf(page)).toContainText('€46.49a month · 3 bills');
    await expect(page.getByRole('region', {name: 'Late'})).toBeHidden();
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(page.getByRole('region', {name: 'Late'})).toContainText('Example Energy');
    await expect(summaryOf(page)).toContainText('€131.49a month · 4 bills');

    // Hiding the four-weekly bill removes its monthly contribution, not its payment amount.
    await openSeries(page, GYM_KEY);
    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await backToList(page);
    await expect(summaryOf(page)).toContainText('€105.49a month · 3 bills');
    await page.getByRole('button', {name: 'Undo'}).last().click();
    await expect(row(page, GYM_KEY)).toContainText('Every 4 weeks');
    await expect(summaryOf(page)).toContainText('€131.49a month · 4 bills');

    // The open details survive a reload; a hidden series can also be restored from its fold.
    await openSeries(page, GYM_KEY);
    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await page.reload();
    await expect(detail(page)).toContainText('Example Gym');
    // Closing the dialog from the details forgets them too.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', {name: 'Recurring payments'})).toBeHidden();
    await expect(page).not.toHaveURL(/[?&](recurring|series)=/);
    await page.goto('/?recurring=open');
    await page.getByText('Hidden (1)').click();
    await openSeries(page, GYM_KEY);
    await detail(page).getByRole('button', {name: 'Count as recurring again'}).click();
    await expect(detail(page).getByRole('button', {name: 'Not recurring'})).toBeVisible();
    await backToList(page);
    await expect(summaryOf(page)).toContainText('€131.49a month · 4 bills');
    await expectNoHorizontalOverflow(page);

    expect(state.writes).toEqual([
      {key: ENERGY_KEY, hidden: true},
      {key: ENERGY_KEY, hidden: false},
      {key: GYM_KEY, hidden: true},
      {key: GYM_KEY, hidden: false},
      {key: GYM_KEY, hidden: true},
      {key: GYM_KEY, hidden: false},
    ]);
  });

  test(`shows a joined history and unlinks it with undo at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    const state = await mockRecurring(page);
    const previousKey = 'e5'.repeat(16);
    const currentKey = 'f6'.repeat(16);
    // The joined series has its own key, which undo must keep using after the split.
    const joinedKey = 'a7'.repeat(16);
    const previous = series({
      key: previousKey,
      name: 'Example Motion Ltd',
      status: 'ENDED',
      transactionCount: 3,
      firstDate: '2026-01-11',
      lastDate: '2026-03-11',
      typicalAmount: '24.00',
      monthlyEquivalent: '24.00',
    });
    const current = series({
      key: currentKey,
      name: 'Example Motion Exampletown',
      transactionCount: 4,
      firstDate: '2026-07-12',
      typicalAmount: '25.00',
      monthlyEquivalent: '25.00',
    });
    const joined = series({
      ...current,
      key: joinedKey,
      transactionCount: 7,
      firstDate: '2026-01-11',
      continuation: {
        previousName: 'Example Motion Ltd',
        previousFirstDate: '2026-01-11',
        previousLastDate: '2026-03-11',
        linked: true,
      },
    });
    const apart = series({...current, continuation: {...joined.continuation!, linked: false}});
    state.expenses = [joined];
    const writes: Array<{key: string; linked: boolean}> = [];
    await page.route('**/recurring-series/*/continuation', (route) => {
      const parts = route.request().url().split('/');
      const key = parts[parts.length - 2];
      const {linked} = route.request().postDataJSON() as {linked: boolean};
      writes.push({key, linked});
      state.expenses = linked ? [joined] : [apart, previous];
      return route.fulfill({status: 204});
    });
    await page.goto('/?recurring=open');

    await expect(row(page, joinedKey)).toContainText('Example Motion Exampletown');
    await openSeries(page, joinedKey);
    await expect(detail(page)).toContainText('Includes earlier payments to Example Motion Ltd');
    await expect(detail(page)).toContainText('7 payments');
    await expectNoHorizontalOverflow(page);

    await detail(page).getByRole('button', {name: 'Unlink Example Motion Ltd'}).click();
    await expect(page.getByText('Unlinked from Example Motion Ltd.')).toBeVisible();
    // The joined series is gone; its newer history stays in the list, kept apart.
    await expect(detail(page)).toBeHidden();
    await expect(row(page, currentKey)).toBeVisible();
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(row(page, joinedKey)).toBeVisible();

    // Without the toast, the newer history still offers to link them again.
    await openSeries(page, joinedKey);
    await detail(page).getByRole('button', {name: 'Unlink Example Motion Ltd'}).click();
    await openSeries(page, currentKey);
    await expect(detail(page)).toContainText('Kept apart from Example Motion Ltd');
    await expect(detail(page)).toContainText('4 payments');
    await detail(page).getByRole('button', {name: 'Link with Example Motion Ltd'}).click();
    await expect(page.getByText('Linked with Example Motion Ltd again.').last()).toBeVisible();
    await expect(row(page, joinedKey)).toBeVisible();

    expect(writes).toEqual([
      {key: joinedKey, linked: false},
      {key: joinedKey, linked: true},
      {key: joinedKey, linked: false},
      {key: currentKey, linked: true},
    ]);
  });
}

test('says so when hiding could not be saved', async ({page}) => {
  await mockRecurring(page);
  await page.route('**/recurring-series/*/hidden', (route) =>
    fulfillJson(route, {statusCode: 404, message: 'Recurring payment not found.'}, 404),
  );
  await page.goto('/?recurring=open');
  await openSeries(page, GYM_KEY);
  await detail(page).getByRole('button', {name: 'Not recurring'}).click();
  await expect(page.getByText('Could not save. Please try again.')).toBeVisible();
  await expect(detail(page).getByRole('button', {name: 'Not recurring'})).toBeEnabled();
});

// The API owns consolidation and eligibility; this only verifies consumption of its DTOs.
test('drills recurring series through to exactly their payments', async ({page}) => {
  const state = await mockRecurring(page);
  const cloudKey = 'a1'.repeat(16);
  const weeklyKey = 'd4'.repeat(16);
  const longKey = 'e5'.repeat(16);
  const histories = [
    {
      entry: series({key: cloudKey, name: 'Example Cloud', typicalAmount: '24.00'}),
      payments: ['04', '05', '06', '07', '08', '09'].map((month, index) =>
        payment(index, {
          bookingDate: `2026-${month}-03`,
          displayDescription: index < 3 ? 'Example Cloud' : 'Example Cloud Billing',
          amount: '-24.00',
          bankAccountAlias: index < 3 ? 'Example Original Account' : 'Example Current Account',
        }),
      ),
    },
    {
      entry: series({
        key: weeklyKey,
        name: 'Example Weekly Bill',
        cadence: 'WEEKLY',
        typicalAmount: '12.00',
        latestAmount: '12.00',
        monthlyEquivalent: '52.00',
        transactionCount: 3,
      }),
      payments: ['01', '08', '15'].map((day, index) =>
        payment(30 + index, {
          bookingDate: `2026-09-${day}`,
          displayDescription: 'Example Weekly Bill',
          amount: '-12.00',
          bankAccountAlias: 'Example Current Account',
        }),
      ),
    },
    {
      entry: state.expenses.find(({key}) => key === GYM_KEY)!,
      payments: [
        '2026-04-17',
        '2026-05-15',
        '2026-06-12',
        '2026-07-10',
        '2026-08-07',
        '2026-09-04',
      ].map((bookingDate, index) =>
        payment(40 + index, {
          bookingDate,
          displayDescription: 'Example Gym',
          amount: '-24.00',
          bankAccountAlias: 'Example Current Account',
        }),
      ),
    },
    {
      // More payments than one page of the details list.
      entry: series({
        key: longKey,
        name: 'Example Insurance',
        typicalAmount: '9.00',
        transactionCount: 25,
        firstDate: '2024-10-03',
      }),
      payments: Array.from({length: 25}, (_, index) => {
        const month = new Date(Date.UTC(2024, 9 + index, 3)).toISOString().slice(0, 10);
        return payment(50 + index, {
          bookingDate: month,
          displayDescription: 'Example Insurance',
          amount: '-9.00',
          bankAccountAlias: 'Example Current Account',
        });
      }),
    },
  ];
  state.expenses = histories.map(({entry}) => entry);
  const drillKeys: Array<string | null> = [];
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const url = new URL(route.request().url());
    // The API accepts only these page sizes.
    if (
      !['5', '10', '20', '30', '40', '50', '100'].includes(
        url.searchParams.get('pagination[pageSize]')!,
      )
    )
      return fulfillJson(route, {statusCode: 400, message: ['pageSize must be valid']}, 400);
    const key = url.searchParams.get('filter[recurringSeriesKey]');
    drillKeys.push(key);
    const payments = [
      ...(histories.find(({entry}) => entry.key === key)?.payments ?? []),
    ].reverse();
    const size = Number(url.searchParams.get('pagination[pageSize]'));
    const start = Number(url.searchParams.get('pagination[pageIndex]')) * size;
    return fulfillJson(route, {
      transactions: payments.slice(start, start + size),
      total: payments.length,
    });
  });
  await page.goto('/?recurring=open');
  await expect(row(page, weeklyKey)).toContainText('Weekly');
  await expect(row(page, weeklyKey)).toContainText('€52.00 a month');

  for (const {entry, payments} of histories) {
    await openSeries(page, entry.key);
    // The details chart the payments the drill lists.
    await expect(
      // The chart shows the latest twelve.
      detail(page).getByRole('img', {
        name: new RegExp(`^${Math.min(payments.length, 12)} payments from`),
      }),
    ).toBeVisible();
    // Every payment is listed in the details, newest first, twenty at a time.
    const list = detail(page).getByRole('list', {name: `Payments to ${entry.name}`});
    const newest = payments[payments.length - 1];
    await expect(list.getByRole('listitem').first()).toContainText(
      formatBankTransactionCompactDate(newest.bookingDate),
    );
    if (payments.length > 20) {
      await expect(list.getByRole('listitem')).toHaveCount(20);
      await detail(page).getByRole('button', {name: 'Load more'}).click();
    }
    await expect(list.getByRole('listitem')).toHaveCount(payments.length);
    await expect(detail(page).getByRole('button', {name: 'Load more'})).toBeHidden();
    await expect(list.getByRole('listitem').last()).toContainText(
      formatBankTransactionCompactDate(payments[0].bookingDate),
    );
    if (payments.length > 20) {
      // A payment loaded later opens like any other.
      await page.route(`**/bank-transactions/${payments[0].id}`, (route) =>
        fulfillJson(route, payments[0]),
      );
      await list.getByRole('listitem').last().getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`transactionId=${payments[0].id}`));
      await expect(page.getByRole('dialog', {name: entry.name})).toContainText('-€9.00');
      await page.goBack();
      await expect(detail(page)).toBeVisible();
    }
    await detail(page).getByRole('link', {name: 'Open in Transactions', exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`recurringSeriesKey=${entry.key}`));
    await expect.poll(() => drillKeys[drillKeys.length - 1]).toBe(entry.key);
    const transactionRows = page.getByTestId(/^bank-transaction-row-/);
    // The Transactions page shows its own first page of ten.
    await expect(transactionRows).toHaveCount(Math.min(payments.length, 10));
    for (const source of payments.slice(-10)) {
      await expect(page.getByTestId(`bank-transaction-row-${source.id}`)).toBeVisible();
    }
    // Back returns to the same details.
    await page.goBack();
    await expect(detail(page)).toContainText(entry.name);
    await backToList(page);
    await expect(summaryOf(page)).toContainText('4 bills');
  }
});

for (const wakeAfterMidnight of [false, true]) {
  test(`refreshes the local date and stops counting an ended payment ${wakeAfterMidnight ? 'when waking next day' : 'after midnight'}`, async ({
    page,
  }) => {
    await page.clock.install({time: new Date('2026-06-18T21:59:50Z')});
    await mockRecurring(page);
    const dates: string[] = [];
    await page.route('**/recurring-series?**', (route) => {
      const url = new URL(route.request().url());
      const asOf = url.searchParams.get('asOf')!;
      dates.push(asOf);
      const ended = asOf >= '2026-06-19';
      return fulfillJson(
        route,
        listsOf([
          series({
            key: GYM_KEY,
            name: 'Example Gym',
            status: ended ? 'ENDED' : 'ACTIVE',
            nextExpectedDate: '2026-06-13',
            flags: ended ? [] : ['LATE'],
          }),
        ]),
      );
    });
    await page.goto('/?recurring=open');
    await expect(row(page, GYM_KEY)).toBeVisible();
    await expect(summaryOf(page)).toContainText('€30.00');

    if (wakeAfterMidnight) {
      await page.clock.setSystemTime(new Date('2026-06-18T22:00:05Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } else {
      await page.clock.fastForward(15_000);
    }
    await expect.poll(() => dates[dates.length - 1]).toBe('2026-06-19');
    await expect(row(page, GYM_KEY)).toBeHidden();
    await page.getByText('Ended (1)').click();
    await expect(row(page, GYM_KEY)).toContainText('Last 3 Sep');
  });
}

test('lists recurring income on its own tab', async ({page}) => {
  await mockRecurring(page);
  await page.goto('/?recurring=open');
  const income = page.getByRole('radio', {name: /^Income/});
  await expect(income).toHaveText('Income1');
  await income.click();
  await expect(row(page, SALARY_KEY)).toContainText('+€2,500.00');
  await expect(summaryOf(page)).toContainText('+€2,500.00a month · 1 source');
  await expect(row(page, GYM_KEY)).toBeHidden();
  await openSeries(page, SALARY_KEY);
  await backToList(page, 'income');
  await expect(row(page, SALARY_KEY)).toBeVisible();
  // Details restored by a reload go back to their own tab.
  await openSeries(page, SALARY_KEY);
  await page.reload();
  await backToList(page, 'income');
  await expect(row(page, SALARY_KEY)).toBeVisible();
  await expect(income).toBeChecked();
});

test('opens a series as a removable filter on the transactions list', async ({page}) => {
  await mockRecurring(page);
  const listRequests: URL[] = [];
  const lastSeriesFilter = () =>
    listRequests[listRequests.length - 1]?.searchParams.get('filter[recurringSeriesKey]');
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    listRequests.push(new URL(route.request().url()));
    return fulfillJson(route, {transactions: [], total: 0});
  });
  await page.goto('/?recurring=open');

  await openSeries(page, GYM_KEY);
  await detail(page).getByRole('link', {name: 'Open in Transactions'}).click();
  await expect(page).toHaveURL(new RegExp(`recurringSeriesKey=${GYM_KEY}`));
  await expect.poll(lastSeriesFilter).toBe(GYM_KEY);

  await page.getByRole('button', {name: 'Remove filter: One recurring payment'}).click();
  await expect(page).not.toHaveURL(/recurringSeriesKey/);
  await expect.poll(lastSeriesFilter).toBeNull();
});

test('lets a drill be cleared when its series is no longer found', async ({page}) => {
  await mockRecurring(page);
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const url = new URL(route.request().url());
    // A correction moved a payment out, so the series is gone; a rate limit keeps the test from waiting out retries.
    return url.searchParams.get('filter[recurringSeriesKey]')
      ? fulfillJson(route, {statusCode: 429, message: 'ThrottlerException: Too Many Requests'}, 429)
      : fulfillJson(route, {transactions: [], total: 0});
  });
  await page.goto(`/bank-transactions?recurringSeriesKey=${GYM_KEY}`);
  await expect(page.getByText('Could not load bank transactions')).toBeVisible();

  await page.getByRole('button', {name: 'Clear filters'}).click();
  await expect(page).not.toHaveURL(/recurringSeriesKey/);
  await expect(page.getByText('Could not load bank transactions')).toBeHidden();
});

test('says so when nothing recurring is found and when loading fails', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000301',
    name: 'Alex Example',
    email: 'user@example.com',
    isEmailVerified: true,
  });
  await mockBankConnections(page, () => []);
  let fail = false;
  // A rate limit is final, so the page shows the error without waiting out the retries.
  await page.route('**/recurring-series?**', (route) =>
    fail
      ? fulfillJson(route, {statusCode: 429, message: 'ThrottlerException: Too Many Requests'}, 429)
      : fulfillJson(route, listsOf([])),
  );
  await page.goto('/?recurring=open');
  await expect(page.getByText('No recurring payments found yet')).toBeVisible();
  await expect(
    page.getByText('Annual subscriptions count after two payments', {exact: false}),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  fail = true;
  await page.reload();
  await expect(page.getByText('Recurring payments are unavailable right now')).toBeVisible();
  fail = false;
  await page.getByRole('button', {name: 'Try again'}).click();
  await expect(page.getByText('No recurring payments found yet')).toBeVisible();
});

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`scrolls a long list inside the dialog at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await mockRecurring(page);
    const many = Array.from({length: 30}, (_, index) =>
      series({key: index.toString(16).padStart(32, 'c'), name: `Example Bill ${index + 1}`}),
    );
    await page.route('**/recurring-series?**', (route) => fulfillJson(route, listsOf(many)));
    await page.goto('/?recurring=open');

    const dialog = page.getByRole('dialog', {name: 'Recurring payments'});
    const last = row(page, many[many.length - 1].key);
    await expect(row(page, many[0].key)).toBeInViewport();
    await expect(last).not.toBeInViewport();
    // The dialog itself stays on screen; only its list moves, by wheel or swipe rather than from code.
    // Wait for the sheet to finish sliding in before measuring it.
    await expect
      .poll(async () => {
        const {y, height} = (await dialog.boundingBox())!;
        return Math.round(y + height);
      })
      .toBeLessThanOrEqual(viewport.height + 1);
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 10; step++) await page.mouse.wheel(0, 600);
    await expect(last).toBeInViewport();
  });
}

for (const locale of ['en-GB', 'de-DE']) {
  test.describe(`in ${locale}`, () => {
    test.use({locale});

    test('keeps every fact on two lines on a narrow phone', async ({page}) => {
      await page.setViewportSize({width: 320, height: 700});
      await page.clock.setFixedTime(new Date('2026-10-28T10:00:00Z'));
      const state = await mockRecurring(page);
      // The widest a fact gets: a large varying bill in a three-letter currency, due in weeks.
      state.expenses = [
        series({
          key: GYM_KEY,
          name: 'Example Insurance',
          amountKind: 'VARIABLE',
          currency: 'CHF',
          typicalAmount: '11482.40',
          latestAmount: '11482.40',
          monthlyEquivalent: '11482.40',
          amountRange: {low: '1648.00', high: '11694.00'},
          // The longest "Next" label: three-digit days late.
          nextExpectedDate: '2026-06-28',
          flags: ['LATE'],
          firstDate: '2016-09-27',
          transactionCount: 1234,
        }),
      ];
      await page.goto('/?recurring=open');
      await openSeries(page, GYM_KEY);
      await expect(detail(page)).toContainText('Next · 122 days late');
      await expectFactsOnTwoLines(page);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test('hiding a series does not reload its payments', async ({page}) => {
  await mockRecurring(page);
  const paymentReads: string[] = [];
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    // Home's recent transactions share the endpoint; only the series' own reads count.
    if (new URL(route.request().url()).searchParams.has('filter[recurringSeriesKey]'))
      paymentReads.push(route.request().url());
    return fulfillJson(route, {transactions: [], total: 0});
  });
  await page.goto('/?recurring=open');
  await openSeries(page, GYM_KEY);
  await expect.poll(() => paymentReads.length).toBe(1);
  await detail(page).getByRole('button', {name: 'Not recurring'}).click();
  await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
  await expect(detail(page).getByRole('button', {name: 'Count as recurring again'})).toBeEnabled();
  // Hiding changes what counts, not which payments belong to the series.
  expect(paymentReads).toHaveLength(1);
});
