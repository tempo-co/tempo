import type {Locator, Page} from '@playwright/test';
import {
  type BankTransaction,
  type RecurringSeries,
  type RecurringSeriesList,
  type RecurringSeriesLists,
} from '@tempo/contracts';

import {formatBankTransactionCompactDate} from '../../../src/features/banking/utils/formatters';
import {createAccount} from '../../data/account.data';
import {createBankTransaction} from '../../data/bank-transaction.data';
import {expect, test} from '../../fixtures';
import {
  expectFailedPageRetried,
  failLaterPages,
  fulfillJson,
  mockBankConnections,
  mockJson,
} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// Every API call is mocked, so no seeded session is needed.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const GYM_KEY = 'a'.repeat(32);
const STREAMING_KEY = 'b'.repeat(32);
const ENERGY_KEY = 'c'.repeat(32);
const OLD_KEY = 'd'.repeat(32);
const SALARY_KEY = 'e'.repeat(32);
const PHONE_KEY = 'f'.repeat(32);
const INSURANCE_KEY = '9'.repeat(32);

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

/** The list response: bills and income from one read. */
function listsOf(
  expenses: RecurringSeries[],
  income: RecurringSeries[] = [],
): RecurringSeriesLists {
  return {expenses: listOf(expenses), income: listOf(income)};
}

const toFixed = (amounts: (string | null)[]) =>
  (amounts.reduce((sum, amount) => sum + Math.round(Number(amount ?? 0) * 100), 0) / 100).toFixed(
    2,
  );

/** As the API answers: only counted series have a month, and the list's month adds theirs up. */
function listOf(entries: RecurringSeries[]): RecurringSeriesList {
  const shown = entries.map((entry) =>
    !entry.hidden && entry.status === 'ACTIVE' ? entry : {...entry, thisMonth: null},
  );
  const counted = shown.filter(({thisMonth}) => thisMonth !== null);
  const total = counted.reduce((sum, entry) => sum + Number(entry.monthlyEquivalent), 0);
  const months = counted.map(({thisMonth}) => thisMonth!);
  return {
    // Shown before hidden, as the API sorts them.
    series: [...shown].sort((a, b) => Number(a.hidden) - Number(b.hidden)),
    monthlyTotal: total.toFixed(2),
    unconvertedCount: 0,
    thisMonth: {
      month: '2026-10',
      paid: toFixed(months.flatMap(({paid}) => paid.map(({amount}) => amount))),
      remaining: toFixed(months.flatMap(({due}) => due.map(({amount}) => amount))),
    },
    baseCurrency: 'EUR',
  };
}

/** Synthetic series on 15 October behind a fake API that hides and unlinks the way the real one does. */
async function mockRecurring(page: Page) {
  const state = {
    expenses: [
      series({
        key: GYM_KEY,
        name: 'Example Gym',
        cadence: 'FOUR_WEEKLY',
        anchorDay: null,
        typicalAmount: '24.00',
        latestAmount: '24.00',
        monthlyEquivalent: '26.00',
        firstDate: '2026-04-17',
        lastDate: '2026-10-02',
        nextExpectedDate: '2026-10-30',
        // Paid early in the month, and due again before it ends.
        thisMonth: {
          paid: [{date: '2026-10-02', amount: '24.00'}],
          due: [{date: '2026-10-30', amount: '24.00', late: false}],
        },
      }),
      series({
        key: STREAMING_KEY,
        name: 'Example Streaming',
        typicalAmount: '14.99',
        latestAmount: '14.99',
        monthlyEquivalent: '14.99',
        lastDate: '2026-10-03',
        nextExpectedDate: '2026-11-03',
        priceChange: {amount: '2.00', since: '2026-08-03'},
        thisMonth: {paid: [{date: '2026-10-03', amount: '14.99'}], due: []},
      }),
      series({
        key: ENERGY_KEY,
        name: 'Example Energy',
        amountKind: 'VARIABLE',
        typicalAmount: '78.50',
        latestAmount: '160.00',
        monthlyEquivalent: '85.00',
        nextExpectedDate: '2026-10-05',
        anchorDay: 5,
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
        thisMonth: {paid: [], due: [{date: '2026-10-05', amount: '78.50', late: true}]},
      }),
      series({key: OLD_KEY, name: 'Example Old Plan', status: 'ENDED', lastDate: '2026-03-03'}),
      series({
        key: PHONE_KEY,
        name: 'Example Phone',
        typicalAmount: '5.50',
        latestAmount: '5.50',
        monthlyEquivalent: '5.50',
        nextExpectedDate: '2026-10-23',
        anchorDay: 23,
        priceChange: {amount: '-3.50', since: '2026-01-23'},
        thisMonth: {paid: [], due: [{date: '2026-10-23', amount: '5.50', late: false}]},
      }),
      series({
        key: INSURANCE_KEY,
        name: 'Example Insurance',
        cadence: 'YEARLY',
        typicalAmount: '120.00',
        latestAmount: '120.00',
        monthlyEquivalent: '10.00',
        firstDate: '2025-03-10',
        lastDate: '2026-03-10',
        nextExpectedDate: '2027-03-10',
        anchorDay: 10,
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
        anchorDay: 25,
        thisMonth: {paid: [], due: [{date: '2026-10-25', amount: '2500.00', late: false}]},
      }),
    ] as RecurringSeries[],
    writes: [] as Array<{key: string; hidden?: boolean; linked?: boolean}>,
    listReads: [] as string[],
  };
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000300',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
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
  return createBankTransaction({
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
    bankName: 'Example Bank',
    bankCountry: 'NL',
    bankAccountName: 'Example Account',
    category: 'ENTERTAINMENT',
    categoryStatus: 'COMPLETED',
    categorySource: 'MANUAL',
    categoryConfidence: null,
    cashFlowTreatment: 'EXPENSE',
    ...fields,
  });
}

/** A series' row; on This month, scope it to its group, since a series can be in two. */
const row = (scope: Page | Locator, key: string) => scope.getByTestId(`recurring-series-${key}`);
const group = (page: Page, name: 'Late' | 'Coming up' | 'Paid') =>
  page.getByRole('region', {name, exact: true});
const card = (page: Page, name: 'Bills' | 'Income') =>
  page.getByRole('region', {name, exact: true});
const summaryOf = (page: Page) => page.getByTestId('recurring-summary');
const detail = (page: Page) => page.getByRole('region', {name: 'Recurring payment details'});
const calendarDay = (page: Page, date: string) => page.getByTestId(`recurring-day-${date}`);
/** The month labels under a series' payment chart, oldest first. */
const monthLabels = (page: Page) => detail(page).locator('.recharts-xAxis-tick-labels text');

/** Opens a series' details from its row. */
async function openSeries(page: Page, key: string) {
  await row(page, key).first().getByRole('button').click();
  await expect(detail(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]series=${key}`));
}

/** Closes a series' details, back to the list. */
async function closeDetails(page: Page) {
  await page.getByRole('button', {name: 'Close details'}).click();
  await expect(detail(page)).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]series=/);
}

/** The toast uses the app's type and card radius, and its action is a full-size touch target. */
async function expectToastStyle(page: Page, action: string, width: number) {
  const toast = page.locator('[data-sonner-toast]').filter({hasText: action}).last();
  const style = await toast.evaluate((element) => {
    const button = element.querySelector('[data-button]')!;
    return {
      font: getComputedStyle(element).fontFamily.split(',')[0].replace(/"/g, ''),
      size: getComputedStyle(element).fontSize,
      radius: getComputedStyle(element).borderRadius,
      buttonSize: getComputedStyle(button).fontSize,
      buttonHeight: button.getBoundingClientRect().height,
    };
  });
  expect(style).toEqual({
    font: 'Inter Variable',
    size: '14px',
    radius: '8px',
    buttonSize: '13px',
    buttonHeight: width < 640 ? 44 : 32,
  });
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
  const wide = viewport.width >= 1024;

  test(`shows this month's bills by status and on a calendar, opens a series at its address and hides it with undo at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
    const state = await mockRecurring(page);
    await page.goto('/recurring');

    await expect(page.getByRole('heading', {name: 'Recurring', level: 1})).toBeVisible();
    await expect(page.getByRole('tab', {name: 'This month'})).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Bills and income come from one request.
    expect(state.listReads).toHaveLength(1);
    // The month's bills, what is paid and what is still to pay: the list's figures.
    await expect(summaryOf(page)).toContainText('Bills in October€146.99');
    await expect(summaryOf(page)).toContainText('Paid€38.99');
    await expect(summaryOf(page)).toContainText('Still to pay€108.00');
    await expect(summaryOf(page)).toContainText('Income +€2,500.00 · €2,500.00 still to come');

    // Each group's bills add up to the figure it belongs to: late and coming up to what is still to pay.
    await expect(group(page, 'Late').getByRole('heading')).toHaveText('Late€78.50');
    await expect(row(group(page, 'Late'), ENERGY_KEY)).toContainText('Monthly · expected 5 Oct');
    await expect(row(group(page, 'Late'), ENERGY_KEY)).toContainText('≈ €78.50');
    await expect(group(page, 'Coming up').getByRole('heading')).toHaveText('Coming up€29.50');
    await expect(row(group(page, 'Coming up'), PHONE_KEY)).toContainText('Monthly · next 23 Oct');
    await expect(row(group(page, 'Coming up'), SALARY_KEY)).toContainText('+€2,500.00');
    // Paid early in the month and due again before it ends, the gym is in both groups.
    await expect(row(group(page, 'Coming up'), GYM_KEY)).toContainText(
      'Every 4 weeks · next 30 Oct',
    );
    await expect(group(page, 'Paid').getByRole('heading')).toHaveText('Paid€38.99');
    await expect(row(group(page, 'Paid'), GYM_KEY)).toContainText('Every 4 weeks · paid 2 Oct');
    await expect(row(group(page, 'Paid'), STREAMING_KEY)).toContainText('€14.99');
    // Within each group, by date.
    await expect(group(page, 'Coming up').getByTestId(/^recurring-series-/)).toHaveText([
      /Example Phone/,
      /Example Employer/,
      /Example Gym/,
    ]);
    // A yearly bill between payments is listed apart; an ended one is not.
    await expect(page.getByRole('region', {name: 'Not this month'})).toContainText(
      'Example Insurance',
    );
    await expect(page.getByRole('region', {name: 'Not this month'})).not.toContainText(
      'Example Old Plan',
    );
    await expect(page.getByRole('region', {name: 'A year of bills'})).toContainText('€1,698');
    // Rows match transaction rows elsewhere: 60px tall with a 36px tile.
    for (const key of [GYM_KEY, STREAMING_KEY]) {
      const paidRow = row(group(page, 'Paid'), key);
      const [rowBox, tileBox] = await Promise.all([
        boxOf(paidRow.getByRole('button')),
        boxOf(paidRow.getByTestId('merchant-logo-tile')),
      ]);
      expect({row: rowBox.height, tile: [tileBox.width, tileBox.height]}).toEqual({
        row: 60,
        tile: [36, 36],
      });
    }
    await expectNoHorizontalOverflow(page);

    // The calendar places each payment on its paid or expected day. On a phone a day is too narrow to tap one
    // payment in, so tapping the day lists its payments under the calendar.
    await page.getByRole('radio', {name: 'Calendar'}).click();
    await expect(page).toHaveURL(/[?&]view=calendar/);
    await expect(group(page, 'Late')).toBeHidden();
    await expect(calendarDay(page, '2026-10-15')).toHaveAttribute('aria-current', 'date');
    const payment = async (date: string, name: string, amount: string, kind: string) => {
      if (viewport.width >= 768)
        return calendarDay(page, date).getByRole('button', {name: `${name}, ${amount}, ${kind}`});
      await calendarDay(page, date).getByRole('button').click();
      return page
        .getByRole('region', {name: /^Payments on /})
        .getByRole('button', {name: new RegExp(`^${name}, .* · ${kind} .*, ${amount}$`)});
    };
    await expect(await payment('2026-10-02', 'Example Gym', '€24.00', 'paid')).toBeVisible();
    await expect(await payment('2026-10-30', 'Example Gym', '€24.00', 'coming up')).toBeVisible();
    const energy = await payment('2026-10-05', 'Example Energy', '≈ €78.50', 'late');
    await expect(energy).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A series opens at its own address: in the rail beside the calendar, or a sheet on a phone.
    await energy.click();
    await expect(page).toHaveURL(new RegExp(`[?&]series=${ENERGY_KEY}`));
    await expect(detail(page)).toContainText('Example Energy');
    if (wide) {
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(calendarDay(page, '2026-10-05')).toBeVisible();
    } else {
      await expect(
        page.getByRole('dialog').getByRole('region', {name: 'Recurring payment details'}),
      ).toBeVisible();
    }
    // A varying bill's details show its range and say its latest payment was high.
    await expect(detail(page)).toContainText('Usually≈ €79');
    await expect(detail(page)).toContainText('A year≈ €1,020');
    await expect(detail(page)).toContainText('Last 6 €48.00–€160.00');
    await expectFactsOnTwoLines(page);
    await expect(detail(page)).toContainText('Last payment €160.00, higher than usual');
    await expect(detail(page)).toContainText('Expected 5 Oct, not paid yet');
    await expectNoHorizontalOverflow(page);

    // The address opens the same details after a reload.
    await page.reload();
    await expect(detail(page)).toContainText('Example Energy');

    // Hiding takes it out of the month's figures and groups; Undo brings it back.
    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
    await expect(
      detail(page).getByRole('button', {name: 'Count as recurring again'}),
    ).toBeVisible();
    await closeDetails(page);
    await page.getByRole('radio', {name: 'List'}).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(summaryOf(page)).toContainText('Still to pay€29.50');
    await expect(group(page, 'Late')).toBeHidden();
    await expectToastStyle(page, 'Undo', viewport.width);
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(row(group(page, 'Late'), ENERGY_KEY)).toBeVisible();
    await expect(summaryOf(page)).toContainText('Still to pay€108.00');

    // All recurring holds the whole catalogue with its flags; a hidden series waits in its fold.
    await page.getByRole('tab', {name: /^All recurring/}).click();
    await expect(page).toHaveURL(/[?&]tab=all/);
    await expect(page.getByRole('tab', {name: /^All recurring/})).toContainText('7');
    await expect(card(page, 'Bills').getByRole('heading')).toHaveText('Bills€141.49 a month');
    await expect(row(page, ENERGY_KEY)).toContainText('Late');
    await expect(row(page, ENERGY_KEY)).toContainText('Pricier');
    await expect(row(page, STREAMING_KEY)).toContainText('Pricier');
    await expect(row(page, STREAMING_KEY)).toContainText('+€2.00 since Aug');
    await expect(row(page, PHONE_KEY)).not.toContainText('Pricier');
    await expect(row(page, PHONE_KEY)).toContainText('−€3.50 since Jan');
    await expect(row(page, OLD_KEY)).toContainText('Ended');
    await expect(row(page, OLD_KEY)).toContainText('Monthly · last paid 3 Mar');
    await expect(row(page, GYM_KEY)).toContainText('€26.00 a month');
    await expect(row(card(page, 'Income'), SALARY_KEY)).toContainText('+€2,500.00');
    await expectNoHorizontalOverflow(page);

    // A four-weekly bill costs thirteen payments a year: twelve of its monthly contribution.
    await openSeries(page, GYM_KEY);
    await expect(detail(page)).toContainText('A year€312');
    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await closeDetails(page);
    await expect(card(page, 'Bills').getByRole('heading')).toHaveText('Bills€115.49 a month');
    await expect(row(page, GYM_KEY)).toBeHidden();
    await page.getByText('Hidden (1)', {exact: true}).focus();
    await page.keyboard.press('Enter');
    await openSeries(page, GYM_KEY);
    await detail(page).getByRole('button', {name: 'Count as recurring again'}).click();
    await expect(detail(page).getByRole('button', {name: 'Not recurring'})).toBeVisible();
    await closeDetails(page);
    await expect(card(page, 'Bills').getByRole('heading')).toHaveText('Bills€141.49 a month');

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
    await page.goto('/recurring?tab=all');

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
  await page.goto('/recurring?tab=all');
  await openSeries(page, GYM_KEY);
  await detail(page).getByRole('button', {name: 'Not recurring'}).click();
  await expect(page.getByText('Could not save. Try again.')).toBeVisible();
  await expect(detail(page).getByRole('button', {name: 'Not recurring'})).toBeEnabled();
});

// The API owns consolidation and eligibility; this only verifies consumption of its DTOs.
test('drills recurring series through to exactly their payments', async ({page}) => {
  // Four histories opened and drilled one after another, then one again on a phone.
  test.slow();
  const state = await mockRecurring(page);
  const cloudKey = 'a1'.repeat(16);
  const weeklyKey = 'd4'.repeat(16);
  const yearlyKey = 'b8'.repeat(16);
  const longKey = 'e5'.repeat(16);
  // Each history's chart names the month every payment pays, once, oldest first.
  const histories = [
    {
      // Due on the 31st, or the last day of a shorter month: September's payment was taken on
      // 1 October and December's two weeks late, on 14 January.
      entry: series({
        key: cloudKey,
        name: 'Example Cloud',
        typicalAmount: '24.00',
        latestAmount: '24.00',
        monthlyEquivalent: '24.00',
        firstDate: '2025-08-31',
        lastDate: '2026-01-31',
        nextExpectedDate: '2026-02-28',
        anchorDay: 31,
      }),
      year: '€288',
      months: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'],
      payments: [
        '2025-08-31',
        '2025-10-01',
        '2025-10-31',
        '2025-11-30',
        '2026-01-14',
        '2026-01-31',
      ].map((bookingDate, index) =>
        payment(index, {
          bookingDate,
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
        anchorDay: null,
        typicalAmount: '12.00',
        latestAmount: '12.00',
        monthlyEquivalent: '52.00',
        transactionCount: 3,
      }),
      year: '€624',
      // Three payments in one month: one label.
      months: ['Sep'],
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
      year: '€312',
      months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
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
        monthlyEquivalent: '9.00',
        transactionCount: 25,
        firstDate: '2024-10-03',
      }),
      year: '€108',
      // The latest twelve run from November 2025 to October 2026.
      months: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
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
  histories.push({
    // Over more than a year, each month carries its year.
    entry: series({
      key: yearlyKey,
      name: 'Example Domain',
      cadence: 'YEARLY',
      typicalAmount: '12.00',
      latestAmount: '12.00',
      monthlyEquivalent: '1.00',
      transactionCount: 3,
      firstDate: '2024-03-10',
      lastDate: '2026-03-10',
      nextExpectedDate: '2027-03-10',
      anchorDay: 10,
    }),
    year: '€12',
    months: ['Mar 24', 'Mar 25', 'Mar 26'],
    payments: ['2024-03-10', '2025-03-10', '2026-03-10'].map((bookingDate, index) =>
      payment(80 + index, {
        bookingDate,
        displayDescription: 'Example Domain',
        amount: '-12.00',
        bankAccountAlias: 'Example Current Account',
      }),
    ),
  });
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
  await page.goto('/recurring?tab=all');
  await expect(row(page, weeklyKey)).toContainText('Weekly');
  await expect(row(page, weeklyKey)).toContainText('€52.00 a month');

  for (const {entry, payments, year, months} of histories) {
    await openSeries(page, entry.key);
    await expect(detail(page)).toContainText(`A year${year}`);
    // The details chart the payments the drill lists.
    await expect(
      // The chart shows the latest twelve.
      detail(page).getByRole('img', {
        name: new RegExp(`^${Math.min(payments.length, 12)} payments from`),
      }),
    ).toBeVisible();
    await expect(monthLabels(page)).toHaveText(months);
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
    // The Transactions page shows its own first page of fifty: every payment here.
    await expect(transactionRows).toHaveCount(payments.length);
    for (const source of payments) {
      await expect(page.getByTestId(`bank-transaction-row-${source.id}`)).toBeVisible();
    }
    // Back returns to the same details.
    await page.goBack();
    await expect(detail(page)).toContainText(entry.name);
    await closeDetails(page);
  }

  // A phone labels every other bar, counted back from the latest.
  await page.setViewportSize({width: 390, height: 844});
  await openSeries(page, longKey);
  await expect(monthLabels(page)).toHaveText(['Dec', 'Feb', 'Apr', 'Jun', 'Aug', 'Oct']);
  // The sheet stays on screen and scrolls its payments by wheel down to its last action.
  const sheet = page.getByRole('dialog');
  const notRecurring = detail(page).getByRole('button', {name: 'Not recurring'});
  await expect(
    detail(page).getByRole('list', {name: 'Payments to Example Insurance'}).getByRole('listitem'),
  ).toHaveCount(25);
  await expect
    .poll(async () => {
      const {y, height} = await boxOf(sheet);
      return Math.round(y + height);
    })
    .toBeLessThanOrEqual(844 + 1);
  await expect(notRecurring).not.toBeInViewport();
  const box = await boxOf(sheet);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 10; step++) await page.mouse.wheel(0, 600);
  await expect(notRecurring).toBeInViewport();
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
    await page.goto('/recurring?tab=all');
    await expect(row(page, GYM_KEY)).toContainText('Late');
    await expect(card(page, 'Bills').getByRole('heading')).toHaveText('Bills€30.00 a month');

    if (wakeAfterMidnight) {
      await page.clock.setSystemTime(new Date('2026-06-18T22:00:05Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } else {
      await page.clock.fastForward(15_000);
    }
    await expect.poll(() => dates[dates.length - 1]).toBe('2026-06-19');
    await expect(row(page, GYM_KEY)).toContainText('Ended');
    await expect(row(page, GYM_KEY)).toContainText('last paid 3 Sep');
    await expect(card(page, 'Bills').getByRole('heading')).toHaveText('Bills€0.00 a month');
  });
}

test('a later page of a series’ payments that fails keeps the loaded ones and tries that page again', async ({
  page,
}) => {
  // The failed page is retried by the query client before Load more reports it.
  test.slow();
  await mockRecurring(page);
  const payments = Array.from({length: 25}, (_, index) =>
    payment(index, {
      bookingDate: new Date(Date.UTC(2026, 8, 25 - index)).toISOString().slice(0, 10),
      displayDescription: 'Example Gym',
      amount: '-24.00',
      bankAccountAlias: 'Example Current Account',
    }),
  );
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const params = new URL(route.request().url()).searchParams;
    if (!params.has('filter[recurringSeriesKey]'))
      return fulfillJson(route, {transactions: [], total: 0});
    const size = Number(params.get('pagination[pageSize]'));
    const start = Number(params.get('pagination[pageIndex]')) * size;
    return fulfillJson(route, {transactions: payments.slice(start, start + size), total: 25});
  });
  const later = await failLaterPages(page, '**/bank-transactions?**', (params) => {
    const index = params.get('pagination[pageIndex]');
    return params.has('filter[recurringSeriesKey]') && index && index !== '0' ? index : null;
  });
  await page.goto('/recurring?tab=all');
  await openSeries(page, GYM_KEY);

  const list = detail(page).getByRole('list', {name: 'Payments to Example Gym'});
  await expectFailedPageRetried(detail(page), list.getByRole('listitem'), later, {
    loaded: 20,
    after: 25,
  });
  await expect(list.getByRole('listitem').last()).toContainText(
    formatBankTransactionCompactDate(payments[24].bookingDate),
  );
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
  await page.goto('/recurring?tab=all');

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
  await page.goto(`/transactions?recurringSeriesKey=${GYM_KEY}`);
  await expect(page.getByText("Couldn't load transactions")).toBeVisible();

  await page.getByRole('button', {name: 'Clear filters'}).click();
  await expect(page).not.toHaveURL(/recurringSeriesKey/);
  await expect(page.getByText("Couldn't load transactions")).toBeHidden();
});

test('says so when nothing recurring is found and when loading fails', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockJson(
    page,
    '**/accounts/me',
    createAccount({
      id: '00000000-0000-4000-8000-000000000301',
      name: 'Alex Example',
      email: 'user@example.com',
    }),
  );
  await mockBankConnections(page, () => []);
  let fail = false;
  // A rate limit is final, so the page shows the error without waiting out the retries.
  await page.route('**/recurring-series?**', (route) =>
    fail
      ? fulfillJson(route, {statusCode: 429, message: 'ThrottlerException: Too Many Requests'}, 429)
      : fulfillJson(route, listsOf([])),
  );
  await page.goto('/recurring?tab=all');
  await expect(page.getByText('No recurring payments found yet')).toBeVisible();
  await expect(
    page.getByText('A yearly payment of the same amount counts after two payments', {exact: false}),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  fail = true;
  await page.reload();
  await expect(page.getByText("Couldn't load recurring payments")).toBeVisible();
  fail = false;
  await page.getByRole('button', {name: 'Try again'}).click();
  await expect(page.getByText('No recurring payments found yet')).toBeVisible();
});

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
      await page.goto('/recurring?tab=all');
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
  await page.goto('/recurring?tab=all');
  await openSeries(page, GYM_KEY);
  await expect.poll(() => paymentReads.length).toBe(1);
  await detail(page).getByRole('button', {name: 'Not recurring'}).click();
  await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
  await expect(detail(page).getByRole('button', {name: 'Count as recurring again'})).toBeEnabled();
  // Hiding changes what counts, not which payments belong to the series.
  expect(paymentReads).toHaveLength(1);
});
