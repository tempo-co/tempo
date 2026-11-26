import type {Locator, Page} from '@playwright/test';
import type {
  BankConnection,
  BankTransaction,
  BankTransactionBulkCategoryPreview,
  BankTransactionCategoryImpact,
  BankTransactionDayTotals,
  BankTransactionTotals,
} from '@tempo/contracts';

import {createAccount} from '../../data/account.data';
import {MOCK_CONNECTION} from '../../data/bank-connection.data';
import {createBankTransaction} from '../../data/bank-transaction.data';
import {expect, test} from '../../fixtures';
import {
  EMPTY_REVIEW_COUNTS,
  expectFailedPageRetried,
  failLaterPages,
  fulfillJson,
  mockBankConnections,
  mockBankRefresh,
  mockJson,
} from '../../utils/api-mocks';
import {animationsSettled, boxOf, expectNoHorizontalOverflow} from '../../utils/layout';
import {openTransactionFilter} from '../../utils/transaction-filters';

// The Transactions page against synthetic lists: day groups, paging, the rail, To check, filter chips and layout.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const NOW = new Date('2026-11-10T12:00:00+01:00');
const [CURRENT_ACCOUNT, SAVINGS_ACCOUNT] = MOCK_CONNECTION.bankAccounts;
/** A closed account at the same bank and in the same currency: its rows stay in the list. */
const CLOSED_ACCOUNT = {
  ...SAVINGS_ACCOUNT,
  id: '00000000-0000-4000-8000-000000000099',
  name: 'Mock closed account',
  isActive: false,
};

type Row = BankTransaction;

/** One synthetic row on `bookingDate`, booked to the current account unless it says otherwise. */
const row = (index: number, bookingDate: string, overrides: Partial<Row> = {}): Row => ({
  ...createBankTransaction({
    id: `00000000-0000-4000-8000-${String(5000 + index).padStart(12, '0')}`,
    bookingDate,
    transactionDate: bookingDate,
    displayDescription: `Example Shop ${index + 1}`,
    amount: '-10.00',
    amountInBaseCurrency: '-10.00',
    category: 'GROCERIES',
    categoryStatus: 'COMPLETED',
    categorySource: 'AI',
    bankName: MOCK_CONNECTION.aspspName,
    bankAccountId: CURRENT_ACCOUNT.id,
    bankAccountName: CURRENT_ACCOUNT.name,
  }),
  ...overrides,
});

/** The rows To check holds: the AI could not place them, or their categorisation failed. */
const toCheck = (candidate: Row) =>
  candidate.category === 'NEEDS_REVIEW' ||
  (candidate.categoryStatus === 'FAILED' && candidate.category === null);

/** 120 rows: two today, two yesterday, two on Sunday, a block on 1 October and the rest last year. */
const history = (): Row[] =>
  Array.from({length: 120}, (_, index) =>
    row(
      index,
      index < 2
        ? '2026-11-10'
        : index < 4
          ? '2026-11-09'
          : index < 6
            ? '2026-11-08'
            : index < 48
              ? '2026-10-01'
              : index < 50
                ? '2025-12-31'
                : '2025-06-01',
      // Three rows to check: two the AI could not place, one of them income, and one that failed.
      index === 1
        ? {category: 'NEEDS_REVIEW'}
        : index === 4
          ? {category: null, categoryStatus: 'FAILED'}
          : index === 5
            ? {
                amount: '25.00',
                amountInBaseCurrency: '25.00',
                creditDebitIndicator: 'CRDT',
                direction: 'INCOME',
                cashFlowTreatment: 'INCOME',
                category: 'NEEDS_REVIEW',
              }
            : index % 3 === 0
              ? {category: 'SHOPPING'}
              : {},
    ),
  );

const connection = (accounts: 'one' | 'several'): BankConnection => ({
  ...MOCK_CONNECTION,
  bankAccounts:
    accounts === 'one' ? [CURRENT_ACCOUNT] : [CURRENT_ACCOUNT, SAVINGS_ACCOUNT, CLOSED_ACCOUNT],
});

/**
 * Answers the list, its totals, its day totals, the review counts, each row's details and category corrections from
 * `rows`, the way the API filters, pages and saves them. A correction's preview offers the other rows with the same
 * name.
 */
async function mockLedger(
  page: Page,
  rows: Row[],
  {accounts = 'one', bulkOthers = []}: {accounts?: 'one' | 'several'; bulkOthers?: Row[]} = {},
) {
  const requests = {
    list: [] as URLSearchParams[],
    totals: [] as URLSearchParams[],
    dayTotals: [] as URLSearchParams[],
    writes: [] as Array<{id: string; category: string; applyToTransactionIds: string[]}>,
  };
  await page.clock.setFixedTime(NOW);
  await mockJson(page, '**/accounts/me', createAccount({baseCurrency: 'EUR'}));
  await mockBankConnections(page, [connection(accounts)]);
  await mockBankRefresh(page);
  await page.route('**/bank-transactions/review-counts', (route) => {
    const count = rows.filter(toCheck).length;
    return fulfillJson(route, {...EMPTY_REVIEW_COUNTS, needsReview: count, needsAttention: count});
  });
  const matching = (params: URLSearchParams) => {
    const categories = params.getAll('filter[categories][]');
    const baseAmount = params.get('filter[baseAmount]');
    const from = params.get('filter[date][from]');
    const to = params.get('filter[date][to]');
    return rows.filter(
      (candidate) =>
        (params.get('filter[needsAttention]') !== 'true' || toCheck(candidate)) &&
        (categories.length === 0 || categories.includes(String(candidate.category))) &&
        (!baseAmount || (baseAmount === 'MISSING') === (candidate.amountInBaseCurrency === null)) &&
        (!from || candidate.date! >= from) &&
        (!to || candidate.date! <= to),
    );
  };
  /** Spent and earned in EUR, as the API sums them: rows without a EUR amount count in neither. */
  const sums = (selected: Row[]) => {
    const sum = (sign: number) =>
      selected
        .filter((candidate) => candidate.amountInBaseCurrency !== null)
        .map((candidate) => Number(candidate.amountInBaseCurrency))
        .filter((amount) => Math.sign(amount) === sign)
        .reduce((total, amount) => total + Math.abs(amount), 0);
    return {
      spending: sum(-1).toFixed(2),
      income: sum(1).toFixed(2),
      net: (sum(1) - sum(-1)).toFixed(2),
    };
  };
  await page.route('**/bank-transactions?**', (route) => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const params = new URL(route.request().url()).searchParams;
    requests.list.push(params);
    const selected = [...matching(params)];
    if (params.get('sort[by]') === 'amount') {
      const direction = params.get('sort[order]') === 'ASC' ? 1 : -1;
      selected.sort((a, b) => direction * (Number(a.amount) - Number(b.amount)));
    }
    const size = Number(params.get('pagination[pageSize]'));
    const start = Number(params.get('pagination[pageIndex]')) * size;
    return fulfillJson(route, {
      transactions: selected.slice(start, start + size),
      total: selected.length,
    });
  });
  await page.route('**/bank-transactions/totals?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.totals.push(params);
    const selected = matching(params);
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      ...sums(selected),
      count: selected.length,
      excluded: {
        missingBaseAmount: selected.filter((candidate) => candidate.amountInBaseCurrency === null)
          .length,
      },
    } satisfies BankTransactionTotals);
  });
  await page.route('**/bank-transactions/day-totals?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.dayTotals.push(params);
    const selected = matching(params);
    const days = [...new Set(selected.map((candidate) => candidate.date!))].sort().reverse();
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      days: days.map((date) => ({
        date,
        ...sums(selected.filter((candidate) => candidate.date === date)),
      })),
    } satisfies BankTransactionDayTotals);
  });
  await page.route(/\/bank-transactions\/[\da-f-]{36}$/, (route) =>
    fulfillJson(
      route,
      rows.find((candidate) => route.request().url().endsWith(candidate.id)),
    ),
  );
  await page.route(/\/bank-transactions\/[\da-f-]{36}\/category-impact\?/, (route) => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split('/');
    const id = segments[segments.length - 2];
    const category = url.searchParams.get('category') as Row['category'];
    const corrected = rows.find((candidate) => candidate.id === id)!;
    const others = rows.filter(
      (candidate) =>
        candidate.id !== id &&
        candidate.displayDescription === corrected.displayDescription &&
        candidate.category !== category,
    );
    return fulfillJson(route, {
      action: others.length > 0 ? 'APPLY' : null,
      category: others.length > 0 ? category : null,
      total: others.length,
      transactions: others.map((other) => ({
        id: other.id,
        displayDescription: other.displayDescription,
        transactionDate: other.transactionDate,
        bookingDate: other.bookingDate,
        amount: other.amount,
        currency: other.currency,
        category: other.category,
        categorySource: other.categorySource,
        categoryStatus: other.categoryStatus,
      })),
    } satisfies BankTransactionCategoryImpact);
  });
  // A bulk category's preview offers the rows the test puts in `bulkOthers`.
  await page.route('**/bank-transactions/bulk-category/preview', (route) =>
    fulfillJson(route, {
      transactions: bulkOthers.map((other) => ({
        id: other.id,
        displayDescription: other.displayDescription,
        transactionDate: other.transactionDate,
        bookingDate: other.bookingDate,
        amount: other.amount,
        currency: other.currency,
        category: other.category,
        categorySource: other.categorySource,
        categoryStatus: other.categoryStatus,
        action: other.category === 'TRANSFER_OUT' ? 'RECHECK' : 'APPLY',
        appliedCategory: other.category === 'TRANSFER_OUT' ? null : 'HOUSING_AND_UTILITIES',
      })),
      total: bulkOthers.length,
    } satisfies BankTransactionBulkCategoryPreview),
  );
  await page.route(/\/bank-transactions\/[\da-f-]{36}\/category$/, (route) => {
    const segments = new URL(route.request().url()).pathname.split('/');
    const id = segments[segments.length - 2];
    const body = route.request().postDataJSON() as Omit<(typeof requests.writes)[number], 'id'>;
    requests.writes.push({id, ...body});
    for (const [index, candidate] of rows.entries())
      if (candidate.id === id || body.applyToTransactionIds.includes(candidate.id))
        rows[index] = {
          ...candidate,
          category: body.category as Row['category'],
          categoryStatus: 'COMPLETED',
          categorySource: 'MANUAL',
        };
    return fulfillJson(
      route,
      rows.find((candidate) => candidate.id === id),
    );
  });
  return requests;
}

const listRows = (page: Page) => page.getByTestId(/^bank-transaction-row-/);
const ledger = (page: Page) => page.getByTestId('bank-transaction-ledger');
const viewTotals = (page: Page) => page.getByTestId('bank-transactions-view-totals');
const last = <T>(items: T[]) => items[items.length - 1];
/** What a card reads, one space between its lines. */
const textOf = (locator: Locator) =>
  locator.evaluate((element: HTMLElement) => element.innerText.replace(/\s+/g, ' ').trim());

const ALL_TOTALS = 'This view 120 transactions Spent €1,190.00 Income +€25.00 Net -€1,165.00';
const SHOPPING_TOTALS = 'This view 40 transactions Spent €400.00 Income €0.00 Net -€400.00';

test('groups rows by day under each day’s total and loads fifty more at a time', async ({page}) => {
  // Rows sit under the day they were made: a row not yet booked under today, and a card payment made on Sunday
  // but booked today under Sunday.
  const unbooked = row(120, '2026-11-10', {
    bookingDate: null,
    displayDescription: 'Example Pending',
  });
  const paidSunday = row(121, '2026-11-10', {
    transactionDate: '2026-11-08',
    date: '2026-11-08',
    displayDescription: 'Example Paid Sunday',
  });
  // They take the place of two 1 October rows, so the first page still ends in December.
  const ledgerRows = history();
  const rows = [
    ...ledgerRows.slice(0, 2),
    unbooked,
    ...ledgerRows.slice(2, 6),
    paidSunday,
    ...ledgerRows.slice(8),
  ];
  const requests = await mockLedger(page, rows);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/transactions');

  await expect(listRows(page)).toHaveCount(50);
  await expect(ledger(page).getByRole('heading')).toHaveText([
    'Today',
    'Yesterday',
    'Sunday 8 November',
    'Thursday 1 October',
    'Wednesday 31 December 2025',
  ]);
  // Each day header carries what that day spent and earned, over the days the list has loaded.
  await expect(ledger(page).getByTestId('ledger-day-total')).toHaveText([
    'Day total -€30.00',
    'Day total -€20.00',
    'Day total -€20.00 · +€25.00',
    'Day total -€400.00',
    'Day total -€20.00',
  ]);
  expect(last(requests.dayTotals)?.get('filter[date][from]')).toBe('2025-12-31');
  expect(last(requests.dayTotals)?.get('filter[date][to]')).toBe('2026-11-10');
  // With nothing open, the rail shows the whole list's totals.
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);
  // A day's money in is green, like income in the rail.
  const colorOf = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).color);
  const income = await colorOf(viewTotals(page).getByText('+€25.00', {exact: true}));
  const sundayIn = page
    .getByRole('region', {name: 'Sunday 8 November', exact: true})
    .getByTestId('ledger-day-total')
    .getByText('+€25.00', {exact: true});
  expect(await colorOf(sundayIn)).toBe(income);
  expect(await colorOf(ledger(page).getByTestId('ledger-day-total').first())).not.toBe(income);

  const loadMore = page.getByRole('button', {name: 'Load more'});
  await loadMore.click();
  await expect(listRows(page)).toHaveCount(100);
  expect(last(requests.list)?.get('pagination[pageIndex]')).toBe('1');
  expect(last(requests.list)?.get('pagination[pageSize]')).toBe('50');
  await loadMore.click();
  await expect(listRows(page)).toHaveCount(120);
  await expect(loadMore).toBeHidden();
  await expect.poll(() => last(requests.dayTotals)?.get('filter[date][from]')).toBe('2025-06-01');
  // A day that runs across pages stays one card, under one total.
  const june = page.getByRole('region', {name: 'Sunday 1 June 2025', exact: true});
  await expect(june).toHaveCount(1);
  await expect(june.getByTestId('ledger-day-total')).toHaveText('Day total -€700.00');
  const today = page.getByRole('region', {name: 'Today', exact: true});
  await expect(today).toHaveCount(1);
  await expect(today.getByTestId(/^bank-transaction-row-/)).toHaveCount(3);
  await expect(today.getByTestId(`bank-transaction-row-${unbooked.id}`)).toBeVisible();
  const sunday = page.getByRole('region', {name: 'Sunday 8 November', exact: true});
  await expect(sunday.getByTestId(`bank-transaction-row-${paidSunday.id}`)).toBeVisible();

  // A row loaded later opens at once from the list while its details load.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const later = ledgerRows[110];
  await page.route(`**/bank-transactions/${later.id}`, async (route) => {
    await held;
    await fulfillJson(route, later);
  });
  try {
    await page.getByTestId(`bank-transaction-row-${later.id}`).getByRole('button').click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector.getByRole('heading', {name: 'Example Shop 111'})).toBeVisible();
  } finally {
    release();
  }
  await page.keyboard.press('Escape');

  // Ordered by amount the list is one card, each row with its date beside the counterparty.
  await page.getByRole('button', {name: 'Order: Newest first'}).click();
  await page.getByRole('menuitemradio', {name: 'Largest in first'}).click();
  await expect(ledger(page).getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('list', {name: 'Transactions'})).toBeVisible();
  await expect(listRows(page).first()).toContainText('Example Shop 6');
  await expect(listRows(page).first()).toContainText('8 Nov');
  await expect(listRows(page)).toHaveCount(50);
});

test('the rail’s totals follow the filters, swapping once both list and totals arrive', async ({
  page,
}) => {
  const requests = await mockLedger(page, history());
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/transactions');
  const totals = viewTotals(page);
  await expect.poll(() => textOf(totals)).toBe(ALL_TOTALS);

  // Record every reading the card shows from here on.
  await totals.evaluate((element: HTMLElement) => {
    const read = () => element.innerText.replace(/\s+/g, ' ').trim();
    const lines: string[] = [read()];
    Object.assign(window, {totalsLines: lines});
    new MutationObserver(() => {
      const line = read();
      if (line !== lines[lines.length - 1]) lines.push(line);
    }).observe(element, {subtree: true, childList: true, characterData: true});
  });
  // The totals arrive after the list; until both are in, the previous figures stay.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/bank-transactions/totals?**', async (route) => {
    await held;
    await route.fallback();
  });
  await openTransactionFilter(page, 'Categories');
  await page.getByRole('option', {name: 'Shopping', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bank-transaction-filters')).toBeHidden();
  try {
    await expect.poll(() => last(requests.list)?.get('filter[categories][]')).toBe('SHOPPING');
    await expect(listRows(page).nth(1)).toContainText('Example Shop 4');
    expect(await textOf(totals)).toBe(ALL_TOTALS);
  } finally {
    release();
  }
  await expect.poll(() => textOf(totals)).toBe(SHOPPING_TOTALS);
  expect(await page.evaluate(() => Reflect.get(window, 'totalsLines') as string[])).toEqual([
    ALL_TOTALS,
    SHOPPING_TOTALS,
  ]);
  expect(last(requests.totals)?.get('filter[categories][]')).toBe('SHOPPING');
  // A day header shows only its own filter's total: none while it loads, never the previous filter's.
  let releaseDays!: () => void;
  const daysHeld = new Promise<void>((resolve) => (releaseDays = resolve));
  await page.route('**/bank-transactions/day-totals?**', async (route) => {
    await daysHeld;
    await route.fallback();
  });
  await openTransactionFilter(page, 'Categories');
  await page.getByRole('option', {name: 'Groceries', exact: true}).click();
  await page.keyboard.press('Escape');
  try {
    await expect
      .poll(() => last(requests.list)?.getAll('filter[categories][]'))
      .toEqual(['SHOPPING', 'GROCERIES']);
    await expect(listRows(page)).toHaveCount(50);
    await expect(page.getByRole('region', {name: 'Today', exact: true})).toBeVisible();
    await expect(ledger(page).getByTestId('ledger-day-total')).toHaveCount(0);
  } finally {
    releaseDays();
  }
  await expect(
    page.getByRole('region', {name: 'Today', exact: true}).getByTestId('ledger-day-total'),
  ).toHaveText('Day total -€10.00');
  await page.getByRole('button', {name: 'Remove filter: Shopping, Groceries'}).click();
  await expect.poll(() => textOf(totals)).toBe(ALL_TOTALS);
});

test('names the rows a total leaves out without an amount in the reporting currency, and lists them', async ({
  page,
}) => {
  // Two shopping rows in another currency that has no EUR amount yet.
  const rows = history().map((candidate, index) =>
    index === 9 || index === 12
      ? {...candidate, currency: 'CHF', amount: '-30.00', amountInBaseCurrency: null}
      : candidate,
  );
  const requests = await mockLedger(page, rows);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(`/transactions?categories=${encodeURIComponent('["SHOPPING"]')}`);
  const totals = viewTotals(page);
  await expect
    .poll(() => textOf(totals))
    .toBe(
      'This view 40 transactions Spent €380.00 Income €0.00 Net -€380.00 2 transactions aren’t included in EUR totals',
    );
  const missing = page.getByRole('link', {name: '2 transactions aren’t included in EUR totals'});

  await missing.click();

  await expect(page).toHaveURL(/baseAmount=MISSING/);
  expect(last(requests.list)?.get('filter[categories][]')).toBe('SHOPPING');
  await expect(listRows(page)).toHaveCount(2);
  await expect(totals.getByText('2 transactions', {exact: true})).toBeVisible();
  await expect(missing).toHaveCount(0);
  await page.getByRole('button', {name: 'Remove filter: Missing EUR amount'}).click();
  await expect(page).not.toHaveURL(/baseAmount/);
  await expect(totals.getByText('40 transactions', {exact: true})).toBeVisible();
});

test('opens a row in the rail beside the list, checks To check rows by picking a category, and keeps chips in the address', async ({
  page,
}) => {
  // The failed row has the same payee as one the AI could not place, so checking one offers the other.
  const rows = history();
  rows[4] = {...rows[4], displayDescription: rows[1].displayDescription};
  const requests = await mockLedger(page, rows);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/transactions');
  await expect(listRows(page)).toHaveCount(50);
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);
  const toCheckCard = page.getByRole('region', {name: 'To check', exact: true});
  await expect(toCheckCard).toContainText('3 to check');

  // A row opens in the rail, beside the list and never over it, at its own address.
  const opened = page.getByTestId(`bank-transaction-row-${rows[2].id}`).getByRole('button');
  await opened.click();
  await expect(page).toHaveURL(new RegExp(`transactionId=${rows[2].id}`));
  const rail = page.getByRole('complementary', {name: 'Transaction details'});
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  await expect(opened).toHaveAttribute('aria-current', 'true');
  const [list, railBox] = await Promise.all([boxOf(ledger(page)), boxOf(rail)]);
  expect(railBox.x).toBeGreaterThanOrEqual(list.x + list.width);
  await expect(viewTotals(page)).toHaveCount(0);
  await page.reload();
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  // Moving from row to row in the rail, one Close still returns to the list's totals.
  await page.getByTestId(`bank-transaction-row-${rows[3].id}`).getByRole('button').click();
  await expect(rail.getByRole('heading', {name: 'Example Shop 4'})).toBeVisible();
  await rail.getByRole('button', {name: 'Close transaction details'}).click();
  await expect(page).not.toHaveURL(/transactionId/);
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);

  // To check is a tab with its count; its rows show no guessed category.
  const tab = page.getByRole('tab', {name: /^To check/});
  await expect(tab).toHaveText(/^To check\s*3$/);
  await toCheckCard.getByRole('button', {name: 'Check'}).click();
  await expect(page).toHaveURL(/needsAttention=true/);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(listRows(page)).toHaveCount(3);
  expect(last(requests.list)?.get('filter[needsAttention]')).toBe('true');
  await expect.poll(() => textOf(viewTotals(page))).toContain('This view 3 transactions');
  for (const index of [1, 4, 5])
    await expect(
      page.getByTestId(`bank-transaction-row-${rows[index].id}`).getByTestId('ledger-row-category'),
    ).toHaveText('To check');
  await expect(toCheckCard).toHaveCount(0);

  // Checking a row is picking its category; there is no guess to confirm.
  await page.getByTestId(`bank-transaction-row-${rows[1].id}`).getByRole('button').click();
  const category = rail.getByRole('combobox', {name: 'Transaction category'});
  await expect(category).toHaveText('Pick a category');
  await expect(rail.getByTestId('bank-transaction-category-status')).toHaveText('To check');
  await expect(page.getByRole('button', {name: /Looks right|Mark checked/})).toHaveCount(0);
  await category.click();
  await expect(page.getByRole('option', {name: 'Needs review'})).toHaveCount(0);
  await page.getByRole('option', {name: 'Groceries', exact: true}).click();
  // Updating the payee's other transactions happens in the rail.
  const step = rail.getByRole('region', {
    name: 'Move other Example Shop 2 payments to Groceries too?',
  });
  await expect(step).toContainText('1 other Example Shop 2 payment can follow:');
  // The corrected row leaves To check at once, before the list's refresh answers.
  let releaseRefresh!: () => void;
  const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve));
  await page.route('**/bank-transactions?**', async (route) => {
    if (requests.writes.length > 0) await refreshHeld;
    await route.fallback();
  });
  await step.getByRole('button', {name: 'Move all 1 to Groceries', exact: true}).click();
  try {
    await expect.poll(() => requests.writes.length).toBe(1);
    await expect(page.getByTestId(`bank-transaction-row-${rows[1].id}`)).toHaveCount(0);
  } finally {
    releaseRefresh();
  }
  await expect(step).toBeHidden();
  await expect(category).toHaveText('Groceries');
  expect(requests.writes).toEqual([
    {id: rows[1].id, category: 'GROCERIES', applyToTransactionIds: [rows[4].id]},
  ]);
  // Both rows leave To check, and its count follows.
  await expect(listRows(page)).toHaveCount(1);
  await expect(tab).toHaveText(/^To check\s*1$/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/transactionId/);

  // The list stays usable beside an open row; Close then keeps the list as it was changed.
  await page.getByTestId(`bank-transaction-row-${rows[5].id}`).getByRole('button').click();
  await expect(rail.getByRole('heading', {name: 'Example Shop 6'})).toBeVisible();
  await page.getByRole('tab', {name: 'All'}).click();
  await expect(page).not.toHaveURL(/needsAttention/);
  await expect(listRows(page)).toHaveCount(50);
  await expect(rail.getByRole('heading', {name: 'Example Shop 6'})).toBeVisible();
  await rail.getByRole('button', {name: 'Close transaction details'}).click();
  await expect(page).not.toHaveURL(/transactionId/);
  await expect(page.getByRole('tab', {name: 'All'})).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);

  // Filters are chips kept in the address; the totals follow them.
  await openTransactionFilter(page, 'Categories');
  await page.getByRole('option', {name: 'Shopping', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/categories=%5B%22SHOPPING%22%5D/);
  await expect.poll(() => textOf(viewTotals(page))).toBe(SHOPPING_TOTALS);
  expect(last(requests.dayTotals)?.get('filter[categories][]')).toBe('SHOPPING');
  await page.reload();
  await expect(page.getByRole('button', {name: 'Remove filter: Shopping'})).toBeVisible();
  await page.getByRole('button', {name: 'Remove filter: Shopping'}).click();
  await expect(page).not.toHaveURL(/categories=/);
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);
});

test('one Close leaves the rail and keeps a list changed beside it, after a link to a row or a link inside its details', async ({
  page,
}) => {
  // Two legs of an own transfer, each linking to the other from its details.
  const rows = history();
  const leg = (from: Row, to: Row): Row => ({
    ...from,
    cashFlowTreatment: 'INTERNAL',
    category: null,
    ownTransfer: {
      evidence: 'IBAN',
      counterpart: {
        id: to.id,
        bankName: to.bankName,
        bankAccountName: to.bankAccountName,
        bankAccountAlias: to.bankAccountAlias,
        amount: to.amount,
        currency: to.currency,
        bookingDate: to.bookingDate,
      },
    },
  });
  [rows[2], rows[3]] = [leg(rows[2], rows[3]), leg(rows[3], rows[2])];
  await mockLedger(page, rows);
  // A transfer's details show each leg's bank.
  await mockJson(page, '**/bank-connections/aspsps', []);
  await page.setViewportSize({width: 1440, height: 900});
  const rail = page.getByRole('complementary', {name: 'Transaction details'});
  const toCheckTab = page.getByRole('tab', {name: /^To check/});

  const close = rail.getByRole('button', {name: 'Close transaction details'});

  // A link to one row, then another row opened from the list: after a reload, one Close leaves the rail.
  await page.goto(`/transactions?transactionId=${rows[2].id}`);
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  await page.getByTestId(`bank-transaction-row-${rows[0].id}`).getByRole('button').click();
  await expect(rail.getByRole('heading', {name: 'Example Shop 1'})).toBeVisible();
  await page.reload();
  await expect(rail.getByRole('heading', {name: 'Example Shop 1'})).toBeVisible();
  await close.click();
  await expect(page).not.toHaveURL(/transactionId/);
  await expect.poll(() => textOf(viewTotals(page))).toBe(ALL_TOTALS);

  // A link to one row, then the list changed beside it.
  await page.goto(`/transactions?transactionId=${rows[2].id}`);
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  await toCheckTab.click();
  await expect(listRows(page)).toHaveCount(3);
  // A reload keeps what Close does.
  await page.reload();
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  await close.click();
  await expect(page).not.toHaveURL(/transactionId/);
  await expect(page).toHaveURL(/needsAttention=true/);
  await expect.poll(() => textOf(viewTotals(page))).toContain('This view 3 transactions');

  // A row opened from the list, the list changed, then a link inside the details to the other leg.
  await page.getByRole('tab', {name: 'All'}).click();
  await page.getByTestId(`bank-transaction-row-${rows[2].id}`).getByRole('button').click();
  await expect(rail.getByRole('heading', {name: 'Example Shop 3'})).toBeVisible();
  await toCheckTab.click();
  await expect(listRows(page)).toHaveCount(3);
  await rail.getByTestId('movement-counterpart').click();
  await expect(rail.getByRole('heading', {name: 'Example Shop 4'})).toBeVisible();
  await close.click();
  await expect(page).not.toHaveURL(/transactionId/);
  await expect(toCheckTab).toHaveAttribute('aria-selected', 'true');
});

test('To check says all checked and shows no count while nothing waits', async ({page}) => {
  await mockLedger(
    page,
    history().map((candidate) =>
      toCheck(candidate)
        ? {...candidate, category: 'GROCERIES', categoryStatus: 'COMPLETED'}
        : candidate,
    ),
  );
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/transactions');
  await expect(listRows(page)).toHaveCount(50);
  const tab = page.getByRole('tab', {name: /^To check/});
  await expect(tab).toHaveText('To check');
  await expect(page.getByRole('region', {name: 'To check', exact: true})).toHaveCount(0);
  await tab.click();
  await expect(page.getByRole('heading', {name: 'All checked'})).toBeVisible();
  await expect(listRows(page)).toHaveCount(0);
});

test('+ Add filter lists the filters, then one filter’s options at the same size, whose options alone scroll', async ({
  page,
}) => {
  await mockLedger(page, history(), {accounts: 'several'});
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/transactions');

  await page.getByTestId('bank-transaction-filters-trigger').click();
  const panel = page.getByTestId('bank-transaction-filters');
  await animationsSettled(panel);
  const filters = panel.getByRole('listitem').getByRole('button');
  await expect(filters).toHaveText([
    /^Date\s*Any/,
    /^Categories\s*Any/,
    /^Cash flow\s*Any/,
    /^Bank accounts\s*Any/,
    /^Category source\s*Any/,
  ]);
  const panelBox = await boxOf(panel);
  await openTransactionFilter(page, 'Categories');
  // One scroll region: the chosen filter's options, never a box of their own inside it.
  const scrollers = () =>
    panel.evaluate((root) => ({
      areas: root.querySelectorAll('[data-radix-scroll-area-viewport]').length,
      nested: [...root.querySelectorAll('*')].filter((element) => {
        const {overflowY} = getComputedStyle(element);
        return (
          /(auto|scroll)/.test(overflowY) &&
          element.scrollHeight > element.clientHeight + 1 &&
          !element.matches('[data-radix-scroll-area-viewport]')
        );
      }).length,
    }));
  await expect.poll(scrollers).toEqual({areas: 1, nested: 0});
  const viewport = panel.locator('[data-radix-scroll-area-viewport]');
  expect(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const heading = panel.getByRole('heading', {name: 'Categories', exact: true});
  const headingBefore = await boxOf(heading);
  await viewport.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  // The step's header stays put, and the step keeps the control's size.
  expect((await boxOf(heading)).y).toBeCloseTo(headingBefore.y, 0);
  expect((await boxOf(panel)).height).toBeCloseTo(panelBox.height, 0);

  await panel.getByRole('option', {name: 'Groceries', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Remove filter: Groceries'})).toBeVisible();
  await panel.getByRole('button', {name: 'Back to filters'}).click();
  await expect(filters.nth(1)).toHaveText(/^Categories\s*Groceries/);
  await openTransactionFilter(page, 'Bank accounts');
  await expect.poll(scrollers).toEqual({areas: 1, nested: 0});
  expect((await boxOf(panel)).height).toBeCloseTo(panelBox.height, 0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/categories=%5B%22GROCERIES%22%5D/);
});

test('shows every filter in force as a removable chip, Home drills included, and Clear removes them', async ({
  page,
}) => {
  const requests = await mockLedger(page, history());
  const params = new URLSearchParams({
    merchantGroup: `k_${'a'.repeat(32)}`,
    incomeSource: 'Example Employer',
    recurringSeriesKey: 'b'.repeat(32),
    categoryStatuses: JSON.stringify(['FAILED']),
    categories: JSON.stringify(['GROCERIES', 'SHOPPING', 'HEALTH']),
    date: JSON.stringify({from: '2026-10-03', to: '2026-10-20'}),
    baseAmount: 'PRESENT',
    search: 'Example',
    needsAttention: 'true',
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(`/transactions?${params}`);

  const chips = page
    .getByRole('list', {name: 'Filters in force'})
    .getByRole('button', {name: /^Remove filter/});
  // To check is a tab and the search has its box, so neither is a chip.
  await expect(chips).toHaveText([
    '3 Oct 2026 – 20 Oct 2026',
    '3 categories',
    'Included in EUR totals',
    'Not categorized',
    'One recurring payment',
    'One merchant',
    'One income source',
  ]);
  await page.getByRole('button', {name: 'Remove filter: One merchant'}).click();
  await expect(page).not.toHaveURL(/merchantGroup/);
  await expect.poll(() => last(requests.list)?.has('filter[merchantGroup]')).toBe(false);
  expect(last(requests.list)?.get('filter[incomeSource]')).toBe('Example Employer');
  await expect(chips).toHaveCount(6);

  await page.setViewportSize({width: 390, height: 844});
  await expect(chips).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', {name: 'Clear', exact: true}).click();
  await expect(chips).toHaveCount(0);
  await expect(page).toHaveURL(/search=Example/);
  await expect(page).toHaveURL(/needsAttention=true/);
  await expect(page).not.toHaveURL(/[?&](date|categories|baseAmount|incomeSource)=/);
  await expect(page.getByRole('button', {name: 'Clear', exact: true})).toHaveCount(0);
});

test('on a phone, a row opens in a bottom sheet a reload keeps, and To check is checked one by one', async ({
  page,
}) => {
  // The failed row has the same payee as the first one the AI could not place.
  const rows = history();
  rows[4] = {...rows[4], displayDescription: rows[1].displayDescription};
  const requests = await mockLedger(page, rows);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/transactions');
  await expect(listRows(page)).toHaveCount(50);
  const strip = page.getByTestId('bank-transactions-summary-strip');
  await expect.poll(() => textOf(strip)).toBe('120 transactions €1,190.00 spent +€25.00 in');
  await expect(page.getByRole('complementary')).toHaveCount(0);

  await page.getByTestId(`bank-transaction-row-${rows[2].id}`).getByRole('button').click();
  const sheet = page.getByRole('dialog', {name: 'Example Shop 3'});
  await expect(sheet).toBeVisible();
  await page.reload();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/transactionId/);

  const tab = page.getByRole('tab', {name: /^To check/});
  await tab.click();
  await expect(listRows(page)).toHaveCount(3);
  await expect.poll(() => textOf(strip)).toBe('3 transactions €20.00 spent +€25.00 in');

  await page.getByRole('button', {name: 'One by one'}).click();
  const walk = page.getByTestId('to-check-one-by-one');
  const progress = walk.getByTestId('one-by-one-progress');
  await expect(progress).toHaveText('1 of 3');
  const card = walk.getByTestId('one-by-one-card');
  await expect(card.getByRole('heading', {name: 'Example Shop 2'})).toBeVisible();
  // Six likely categories for money going out, then all the others; never the AI's own Needs review.
  await expect(card.getByRole('button', {pressed: false})).toHaveText([
    'Groceries',
    'Eating out',
    'Shopping',
    'Transportation',
    'Housing and utilities',
    'Services',
    'All categories',
  ]);
  await card.getByRole('button', {name: 'All categories'}).click();
  const all = card.getByRole('group', {name: 'All categories'});
  await expect(all.getByRole('button', {name: 'Travel'})).toBeVisible();
  await expect(all.getByRole('button', {name: 'Needs review'})).toHaveCount(0);
  await card.getByRole('button', {name: 'All categories'}).click();

  // Picking a category asks, inline, whether the payee's other row to check follows; both leave the walk.
  await card.getByRole('button', {name: 'Groceries'}).click();
  const others = card.getByRole('group', {
    name: 'Also put 1 other Example Shop 2 payment in Groceries?',
  });
  await others.getByRole('button', {name: 'All 2'}).click();
  await expect(progress).toHaveText('3 of 3');
  expect(requests.writes).toEqual([
    {id: rows[1].id, category: 'GROCERIES', applyToTransactionIds: [rows[4].id]},
  ]);
  // Money coming in is offered income's likely categories.
  await expect(card.getByRole('heading', {name: 'Example Shop 6'})).toBeVisible();
  await expect(card.getByRole('button', {name: 'Income', exact: true})).toBeVisible();
  await walk.getByRole('button', {name: 'Skip for now'}).click();

  await expect(walk.getByRole('heading', {name: 'All checked'})).toBeVisible();
  await expect(walk).toContainText('2 sorted · 1 skipped, still in To check');
  await walk.getByRole('button', {name: 'Back to Transactions'}).click();
  await expect(walk).toBeHidden();
  await expect(tab).toHaveText(/^To check\s*1$/);
  await expect(listRows(page)).toHaveCount(1);
  await expect(page.getByTestId(`bank-transaction-row-${rows[5].id}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('one by one goes on past the first hundred rows to check until To check is empty', async ({
  page,
}) => {
  // 150 rows to check: 99 from one payee, then a payee of its own, then 50 from another payee.
  const rows = Array.from({length: 150}, (_, index) =>
    row(index, '2026-11-10', {
      category: 'NEEDS_REVIEW',
      displayDescription:
        index < 99 ? 'Example Bulk' : index === 99 ? 'Example Single' : 'Example Later',
    }),
  );
  await mockLedger(page, rows);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/transactions?needsAttention=true');
  await page.getByRole('button', {name: 'One by one'}).click();
  const walk = page.getByTestId('to-check-one-by-one');
  const progress = walk.getByTestId('one-by-one-progress');
  const card = walk.getByTestId('one-by-one-card');
  await expect(progress).toHaveText('1 of 150');

  await card.getByRole('button', {name: 'Groceries'}).click();
  await card.getByRole('button', {name: 'All 99'}).click();
  await expect(progress).toHaveText('100 of 150');
  await expect(card.getByRole('heading', {name: 'Example Single'})).toBeVisible();
  // The rows after the first hundred load once the walk reaches them; a failed load waits for Try again.
  const failed = {count: 0, failing: true};
  await page.route('**/bank-transactions?**', (route) => {
    if (!failed.failing || !route.request().url().includes('needsAttention'))
      return route.fallback();
    failed.count++;
    return fulfillJson(route, {message: 'Synthetic rate limit'}, 429);
  });
  await walk.getByRole('button', {name: 'Skip for now'}).click();
  await expect(walk.getByText("Couldn't load transactions to check")).toBeVisible();
  await expect(walk.getByRole('button', {name: 'Try again'})).toBeVisible();
  expect(failed.count).toBe(1);
  failed.failing = false;
  await walk.getByRole('button', {name: 'Try again'}).click();

  await expect(progress).toHaveText('101 of 150');
  await expect(card.getByRole('heading', {name: 'Example Later'})).toBeVisible();
  await card.getByRole('button', {name: 'Groceries'}).click();
  await card.getByRole('button', {name: 'All 50'}).click();
  await expect(walk.getByRole('heading', {name: 'All checked'})).toBeVisible();
  await expect(walk).toContainText('149 sorted · 1 skipped, still in To check');
});

test('a later page that fails keeps the loaded rows and tries that page again', async ({page}) => {
  // The failed page is retried by the query client before Load more reports it.
  test.slow();
  await mockLedger(page, history());
  const later = await failLaterPages(page, '**/bank-transactions?**', (params) => {
    const index = params.get('pagination[pageIndex]');
    return index && index !== '0' ? index : null;
  });
  await page.goto('/transactions');
  await expectFailedPageRetried(page.locator('main'), listRows(page), later, {
    loaded: 50,
    after: 100,
  });
});

/**
 * Realistic extremes: long names, an unbreakable reference, huge amounts in several currencies, no merchant, a row to
 * check, and day and view totals in the tens of millions.
 */
const worstCase = (): Row[] => [
  row(0, '2026-11-10', {
    displayDescription: 'Aleksandra Wiśniewska-Kowalczyk Interior Design and Renovation Studio',
    counterpartyName: 'Bartholomew Fitzgerald Northwind Industries Holdings',
    amount: '-12345678.90',
    amountInBaseCurrency: '-12345678.90',
    currency: 'EUR',
  }),
  row(1, '2026-11-10', {
    displayDescription: '/TRTP/SEPA-TRANSFER/IBAN/NL91ABNA0417164300/REMI/INV-2026-000123456789',
    amount: '98765432.10',
    amountInBaseCurrency: '98765432.10',
    currency: 'EUR',
    creditDebitIndicator: 'CRDT',
    direction: 'INCOME',
    cashFlowTreatment: 'INCOME',
    category: null,
    categoryStatus: 'PROCESSING',
    bankAccountId: SAVINGS_ACCOUNT.id,
    bankAccountName: SAVINGS_ACCOUNT.name!,
  }),
  row(2, '2026-11-09', {
    displayDescription: 'Jo',
    amount: '-12345678.90',
    amountInBaseCurrency: '-13234567.89',
    currency: 'CHF',
    category: 'NEEDS_REVIEW',
  }),
  row(3, '2026-11-09', {
    displayDescription: 'Café 🍕 東京ラーメン',
    amount: '-1234567.89',
    amountInBaseCurrency: '-108642.17',
    currency: 'SEK',
    category: 'PERSONAL_CARE',
    bankAccountId: CLOSED_ACCOUNT.id,
    bankAccountName: CLOSED_ACCOUNT.name,
  }),
];

/** Other rows from the worst-case payees: a long name, an unbreakable reference with a huge amount, a recheck. */
const worstCaseOthers = (): Row[] => [
  row(10, '2026-10-30', {
    displayDescription: 'Aleksandra Wiśniewska-Kowalczyk Interior Design and Renovation Studio',
    amount: '-12345678.90',
    currency: 'EUR',
    category: 'HOME_IMPROVEMENT',
  }),
  row(11, '2026-10-29', {
    displayDescription: '/TRTP/SEPA-TRANSFER/IBAN/NL91ABNA0417164300/REMI/INV-2026-000123456789',
    amount: '-98765432.10',
    currency: 'CHF',
    category: 'TRANSFER_OUT',
    categorySource: 'HISTORY',
  }),
  row(12, '2026-10-28', {displayDescription: 'Jo', amount: '-1.00', category: null}),
];

/** Visible amounts inside `scope` that break across lines or run out of their box. */
const brokenAmounts = (scope: Locator) =>
  scope.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('.numeric'))
      .filter((element) => element.offsetParent !== null && element.children.length === 0)
      .filter((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const lines = new Set(
          Array.from(range.getClientRects()).map((rect) => Math.round(rect.bottom)),
        );
        const text = range.getBoundingClientRect();
        const box = element.parentElement!.getBoundingClientRect();
        return lines.size > 1 || text.left < box.left - 1 || text.right > box.right + 1;
      })
      .map((element) => element.textContent),
  );

test('keeps rows, tiles and the Category column in place beside the rail with worst-case values', async ({
  page,
}) => {
  // At 1440px the list beside the rail is wide enough for its columns.
  await page.setViewportSize({width: 1440, height: 900});
  const lefts: number[] = [];
  for (const accounts of ['one', 'several'] as const) {
    // Later routes win, so each pass answers with its own accounts.
    await mockLedger(page, worstCase(), {accounts});
    await page.goto('/transactions');
    await expect(listRows(page)).toHaveCount(4);
    const account = (index: number) => listRows(page).nth(index).getByTestId('ledger-row-account');
    // Several accounts in one bank and currency: each row names its own account, whatever the payment's
    // currency, and so does a closed account's row.
    if (accounts === 'several') {
      await expect(account(1)).toHaveText(SAVINGS_ACCOUNT.name!);
      await expect(account(2)).toHaveText(CURRENT_ACCOUNT.name!);
      await expect(account(3)).toHaveText(CLOSED_ACCOUNT.name);
    } else await expect(account(1)).toHaveCount(0);
    lefts.push(
      Math.round((await boxOf(listRows(page).first().getByTestId('ledger-row-category'))).x),
    );
    await expectNoHorizontalOverflow(page);
  }
  expect(lefts[1], 'Category column').toBe(lefts[0]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`fits the worst-case list, day totals, rail totals and details at 1440, 390 and 320px in ${theme}`, async ({
    page,
  }) => {
    test.slow();
    await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
    await mockLedger(page, worstCase(), {accounts: 'several', bulkOthers: worstCaseOthers()});
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      await page.goto('/transactions');
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await expect(listRows(page)).toHaveCount(4);
      await expect(ledger(page).getByTestId('ledger-day-total')).toHaveText([
        'Day total -€12,345,678.90 · +€98,765,432.10',
        'Day total -€13,343,210.06',
      ]);
      const totals =
        width === 1440 ? viewTotals(page) : page.getByTestId('bank-transactions-summary-strip');
      await expect(totals).toContainText('€25,688,888.96');
      // Every row has the shared row height and tile, and its amount whole on its line.
      const sizes = await listRows(page).evaluateAll((rows) =>
        rows.map((candidate) => ({
          row: Math.round(
            candidate.querySelector('button:not([role="checkbox"])')!.getBoundingClientRect()
              .height,
          ),
          tile: Math.round(
            candidate.querySelector('[data-testid="merchant-logo-tile"]')!.getBoundingClientRect()
              .width,
          ),
          amountFits: (() => {
            const amount = candidate.querySelector('[data-testid="ledger-row-amount"]')!;
            const box = candidate.getBoundingClientRect();
            const amountBox = amount.getBoundingClientRect();
            return amount.scrollWidth <= amount.clientWidth + 1 && amountBox.right <= box.right + 1;
          })(),
        })),
      );
      expect(sizes, `${width}px`).toEqual(Array(4).fill({row: 60, tile: 36, amountFits: true}));
      await expect(listRows(page).first()).toContainText('-€12,345,678.90');
      await expect(listRows(page).nth(2)).toContainText('-CHF 12,345,678.90');
      await expect(listRows(page).nth(2).getByText('To check').first()).toBeAttached();
      expect(await brokenAmounts(page.locator('main'))).toEqual([]);
      await expectNoHorizontalOverflow(page);

      // The longest name and the widest amounts open in the rail or the sheet without spilling out, each amount
      // on one line.
      for (const [index, figure] of [
        [0, '-€12,345,678.90'],
        [1, '+€98,765,432.10'],
        [2, '-CHF 12,345,678.90'],
      ] as const) {
        await listRows(page).nth(index).getByRole('button').click();
        const inspector = page.getByTestId('bank-transaction-inspector');
        const amount = inspector.getByTestId('bank-transaction-detail-amount');
        await expect(amount).toHaveText(figure);
        await animationsSettled(inspector);
        const [panel, heading] = await Promise.all([
          boxOf(inspector),
          boxOf(inspector.getByRole('heading', {level: 2}).first()),
        ]);
        expect(heading.x + heading.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
        expect(await brokenAmounts(amount), `${figure} at ${width}px`).toEqual([]);
        await expectNoHorizontalOverflow(page);
        await page.keyboard.press('Escape');
        await expect(page).not.toHaveURL(/transactionId/);
      }

      // Every row picked, the longest category, and the payees' other rows: the bar and the step fit.
      if (width < 1440) await page.getByRole('button', {name: 'Select'}).click();
      await page.getByRole('checkbox', {name: 'Select all 4'}).click();
      const bar = page.getByRole('toolbar', {name: 'Selected transactions'});
      await expect(bar).toContainText('4 selected');
      const [barBox, mainBox] = await Promise.all([boxOf(bar), boxOf(page.locator('main'))]);
      expect(barBox.x, `bar at ${width}px`).toBeGreaterThanOrEqual(mainBox.x);
      expect(barBox.x + barBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width + 1);
      await expectNoHorizontalOverflow(page);
      await bar.getByRole('button', {name: 'Category'}).click();
      await (
        width < 1440
          ? page
              .getByTestId('bulk-category-sheet')
              .getByRole('button', {name: 'Housing and utilities'})
          : page.getByRole('menuitem', {name: 'Housing and utilities'})
      ).click();
      const step = page.getByTestId('bulk-category-step');
      await expect(step.getByRole('heading')).toHaveText('Change 4 to Housing and utilities?');
      await animationsSettled(step);
      const stepBox = await boxOf(step);
      for (const button of await step.getByRole('button').all()) {
        const box = await boxOf(button);
        expect(box.x + box.width, `step button at ${width}px`).toBeLessThanOrEqual(
          stepBox.x + stepBox.width + 1,
        );
      }
      await expect(step.getByRole('button', {name: 'Change all 7'})).toBeVisible();
      await expect(step).toContainText('AI picks again');
      expect(await brokenAmounts(step), `step amounts at ${width}px`).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await step.getByRole('button', {name: 'Cancel'}).click();
      await expect(step).toBeHidden();
      await bar.getByRole('button', {name: 'Clear the selection'}).click();
      await expect(bar).toBeHidden();
    }
  });
}
