import type {Page} from '@playwright/test';

import {
  type BankTransaction,
  BankTransactionDirection,
} from '../../../src/features/banking/types/bank-transaction';
import type {
  RecurringSeries,
  RecurringSeriesList,
  RecurringSeriesLists,
} from '../../../src/features/banking/types/recurring-series';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

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
    baseCurrency: 'EUR',
  };
}

/** Synthetic series behind a fake API that hides and unlinks the way the real one does. */
async function mockRecurring(page: Page) {
  const state = {
    expenses: [
      series({key: GYM_KEY, name: 'Example Gym'}),
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
    direction: BankTransactionDirection.EXPENSE,
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
    ...fields,
  };
}

const row = (page: Page, key: string) => page.getByTestId(`recurring-series-${key}`);

/** Opens a row's menu and picks an item with the keyboard, which works under a phone toast. */
async function chooseFromRowMenu(page: Page, name: string, item: string) {
  await page.getByRole('button', {name: `More for ${name}`}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', {name: item}).click();
}

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  test(`counts every payment and hides one as not recurring with undo at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const state = await mockRecurring(page);
    await page.goto('/?recurring=open');

    await expect(page.getByRole('dialog', {name: 'Recurring payments'})).toBeVisible();
    // Bills and income come from one request.
    await expect(page.getByRole('region', {name: 'Income'})).toBeVisible();
    expect(state.listReads).toHaveLength(1);
    expect(new URLSearchParams(state.listReads[0]).has('direction')).toBe(false);
    // Gym, streaming at its new price, energy and phone; the ended plan does not count.
    await expect(page.getByTestId('recurring-summary')).toHaveText(
      '€135.49 a month across 4 payments.',
    );
    for (const name of ['Confirm', 'Dismiss', 'Link', 'Keep separate']) {
      await expect(page.getByRole('button', {name, exact: true})).toHaveCount(0);
    }
    await expect(row(page, STREAMING_KEY)).toContainText('€14.99');
    await expect(row(page, STREAMING_KEY)).toContainText('+€2.00 since Aug');
    await expect(row(page, STREAMING_KEY)).not.toContainText('Price went up');
    await expect(row(page, PHONE_KEY)).toContainText('−€3.50 since Jan');
    // A varying bill shows its usual amount as an estimate, with its range, and flags a high latest payment.
    await expect(row(page, ENERGY_KEY)).toContainText('≈ €78.50');
    await expect(row(page, ENERGY_KEY)).toContainText('€48.00 – €160.00');
    await expect(row(page, ENERGY_KEY)).toContainText('Higher than usual');
    await expect(row(page, ENERGY_KEY)).toContainText('Late');
    await expect(row(page, ENERGY_KEY)).not.toContainText('Variable amount');
    // Its recent payments open on request.
    const history = row(page, ENERGY_KEY).getByRole('button', {name: 'Recent payments'});
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await history.click();
    await expect(history).toHaveAttribute('aria-expanded', 'true');
    const payments = row(page, ENERGY_KEY).getByRole('list', {
      name: 'Recent payments to Example Energy',
    });
    await expect(payments.getByRole('listitem')).toHaveCount(6);
    // Newest first.
    await expect(payments.getByRole('listitem').first()).toContainText('€160.00');
    // The payment that made it higher than usual stands out.
    await expect(payments.getByRole('listitem').first()).toHaveAttribute('data-unusual', 'true');
    await expect(payments.getByRole('listitem').nth(1)).not.toHaveAttribute('data-unusual');
    await expect(payments.getByRole('listitem').last()).toContainText('€61.00');
    // A fixed price stays exact: no estimate sign, range or history.
    await expect(row(page, GYM_KEY)).toContainText('€30.00');
    await expect(row(page, GYM_KEY)).not.toContainText('≈');
    await expect(row(page, GYM_KEY).getByRole('button', {name: 'Recent payments'})).toHaveCount(0);
    // Ended series stay folded away until asked for.
    await expect(row(page, OLD_KEY)).toBeHidden();
    await page.getByText('Ended (1)').click();
    await expect(row(page, OLD_KEY)).toContainText('Last paid');
    await expectNoHorizontalOverflow(page);

    await chooseFromRowMenu(page, 'Example Energy', 'Not recurring');
    await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
    await expect(page.getByTestId('recurring-summary')).toHaveText(
      '€50.49 a month across 3 payments.',
    );
    await expect(row(page, ENERGY_KEY)).toBeHidden();
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(row(page, ENERGY_KEY)).toBeVisible();
    await expect(page.getByTestId('recurring-summary')).toHaveText(
      '€135.49 a month across 4 payments.',
    );

    // A hidden series can be restored from its fold.
    await chooseFromRowMenu(page, 'Example Gym', 'Not recurring');
    await expect(page.getByTestId('recurring-summary')).toContainText('3 payments');
    await page.getByText('Hidden (1)').click();
    await row(page, GYM_KEY).getByRole('button', {name: 'Show Example Gym again'}).click();
    await expect(page.getByTestId('recurring-summary')).toContainText('4 payments');
    await expectNoHorizontalOverflow(page);

    expect(state.writes).toEqual([
      {key: ENERGY_KEY, hidden: true},
      {key: ENERGY_KEY, hidden: false},
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

    await expect(row(page, joinedKey)).toContainText(
      'Includes earlier payments to Example Motion Ltd',
    );
    await expect(
      page.getByRole('link', {name: 'Example Motion Exampletown, 7 payments'}),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await chooseFromRowMenu(page, 'Example Motion Exampletown', 'Unlink Example Motion Ltd');
    await expect(page.getByText('Unlinked from Example Motion Ltd.')).toBeVisible();
    await expect(
      page.getByRole('link', {name: 'Example Motion Exampletown, 4 payments'}),
    ).toBeVisible();
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(
      page.getByRole('link', {name: 'Example Motion Exampletown, 7 payments'}),
    ).toBeVisible();

    // Without the toast, the newer history still offers to link them again.
    await chooseFromRowMenu(page, 'Example Motion Exampletown', 'Unlink Example Motion Ltd');
    await expect(
      page.getByRole('link', {name: 'Example Motion Exampletown, 4 payments'}),
    ).toBeVisible();
    await expect(row(page, currentKey)).toContainText('Kept apart from Example Motion Ltd');
    await chooseFromRowMenu(page, 'Example Motion Exampletown', 'Link with Example Motion Ltd');
    await expect(page.getByText('Linked with Example Motion Ltd again.').last()).toBeVisible();
    await expect(
      page.getByRole('link', {name: 'Example Motion Exampletown, 7 payments'}),
    ).toBeVisible();

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
  await chooseFromRowMenu(page, 'Example Gym', 'Not recurring');
  await expect(page.getByText('Could not save. Please try again.')).toBeVisible();
  await expect(row(page, GYM_KEY)).toBeVisible();
});

// The API owns consolidation and eligibility; this only verifies consumption of its DTOs.
test('drills a series and a weekly bill through to exactly their payments', async ({page}) => {
  const state = await mockRecurring(page);
  const cloudKey = 'a1'.repeat(16);
  const weeklyKey = 'd4'.repeat(16);
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
  ];
  state.expenses = histories.map(({entry}) => entry);
  const drillKeys: Array<string | null> = [];
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const key = new URL(route.request().url()).searchParams.get('filter[recurringSeriesKey]');
    drillKeys.push(key);
    const payments = histories.find(({entry}) => entry.key === key)?.payments ?? [];
    return fulfillJson(route, {transactions: [...payments].reverse(), total: payments.length});
  });
  await page.goto('/?recurring=open');
  await expect(row(page, weeklyKey)).toContainText('Weekly');
  await expect(row(page, weeklyKey)).toContainText('≈ €52.00 a month');

  for (const {entry, payments} of histories) {
    await row(page, entry.key)
      .getByRole('link', {name: `${entry.name}, ${payments.length} payments`, exact: true})
      .click();
    await expect(page).toHaveURL(new RegExp(`recurringSeriesKey=${entry.key}`));
    await expect.poll(() => drillKeys[drillKeys.length - 1]).toBe(entry.key);
    const transactionRows = page.getByTestId(/^bank-transaction-row-/);
    await expect(transactionRows).toHaveCount(payments.length);
    await page.goBack();
    await expect(page.getByTestId('recurring-summary')).toContainText('2 payments');
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
    await expect(page.getByTestId('recurring-summary')).toContainText('€30.00');

    if (wakeAfterMidnight) {
      await page.clock.setSystemTime(new Date('2026-06-18T22:00:05Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } else {
      await page.clock.fastForward(15_000);
    }
    await expect.poll(() => dates[dates.length - 1]).toBe('2026-06-19');
    await expect(row(page, GYM_KEY)).toBeHidden();
    await page.getByText('Ended (1)').click();
    await expect(row(page, GYM_KEY)).toContainText('Last paid');
  });
}

test('lists recurring income next to bills', async ({page}) => {
  await mockRecurring(page);
  await page.goto('/?recurring=open');
  const income = page.getByRole('region', {name: 'Income'});
  await expect(income.getByText('Example Employer')).toBeVisible();
  await expect(income).toContainText('€2,500.00 a month');
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

  await page.getByRole('link', {name: 'Example Gym, 6 payments'}).click();
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
