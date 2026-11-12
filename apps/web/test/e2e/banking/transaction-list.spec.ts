import type {Page} from '@playwright/test';
import type {BankConnection, BankTransaction, BankTransactionTotals} from '@tempo/contracts';

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
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';
import {openTransactionFilter} from '../../utils/transaction-filters';

// The Transactions page against synthetic lists: day groups, paging, totals, review and layout.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const NOW = new Date('2026-11-10T12:00:00+01:00');
const [CURRENT_ACCOUNT, SAVINGS_ACCOUNT] = MOCK_CONNECTION.bankAccounts;

type Row = BankTransaction & {toReview?: boolean};

/** One synthetic row on `bookingDate`, booked to the current account unless it says otherwise. */
const row = (index: number, bookingDate: string, overrides: Partial<Row> = {}): Row => ({
  ...createBankTransaction({
    id: `00000000-0000-4000-8000-${String(5000 + index).padStart(12, '0')}`,
    bookingDate,
    transactionDate: bookingDate,
    displayDescription: `Example Shop ${index + 1}`,
    amount: '-10.00',
    amountInBaseCurrency: '-10.00',
    category: 'FOOD_AND_DRINK',
    categoryStatus: 'COMPLETED',
    categorySource: 'AI',
    bankName: MOCK_CONNECTION.aspspName,
    bankAccountName: CURRENT_ACCOUNT.name,
  }),
  ...overrides,
});

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
      // Three rows need the owner: one to review, one that failed and one without a direction.
      index === 1
        ? {category: 'NEEDS_REVIEW', toReview: true}
        : index === 4
          ? {category: null, categoryStatus: 'FAILED', toReview: true}
          : index === 5
            ? {
                amount: '25.00',
                amountInBaseCurrency: '25.00',
                creditDebitIndicator: null,
                category: 'INCOME',
                toReview: true,
              }
            : index % 3 === 0
              ? {category: 'SHOPPING'}
              : {},
    ),
  );

const connection = (accounts: 'one' | 'several'): BankConnection => ({
  ...MOCK_CONNECTION,
  bankAccounts: accounts === 'one' ? [CURRENT_ACCOUNT] : [CURRENT_ACCOUNT, SAVINGS_ACCOUNT],
});

/** Answers the list, its totals and the review counts from `rows`, the way the API filters and pages them. */
async function mockLedger(
  page: Page,
  rows: Row[],
  {accounts = 'one'}: {accounts?: 'one' | 'several'} = {},
) {
  const requests = {list: [] as URLSearchParams[], totals: [] as URLSearchParams[]};
  await page.clock.setFixedTime(NOW);
  await mockJson(page, '**/accounts/me', createAccount({baseCurrency: 'EUR'}));
  await mockBankConnections(page, [connection(accounts)]);
  await mockBankRefresh(page);
  const toReview = rows.filter((candidate) => candidate.toReview).length;
  await mockJson(page, '**/bank-transactions/review-counts', {
    ...EMPTY_REVIEW_COUNTS,
    needsReview: toReview,
    needsAttention: toReview,
  });
  const matching = (params: URLSearchParams) => {
    const categories = params.getAll('filter[categories][]');
    return rows.filter(
      (candidate) =>
        (params.get('filter[needsAttention]') !== 'true' || candidate.toReview) &&
        (categories.length === 0 || categories.includes(String(candidate.category))),
    );
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
    const sum = (sign: number) =>
      selected
        .map((candidate) => Number(candidate.amount))
        .filter((amount) => Math.sign(amount) === sign)
        .reduce((total, amount) => total + Math.abs(amount), 0);
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      spending: sum(-1).toFixed(2),
      income: sum(1).toFixed(2),
      net: (sum(1) - sum(-1)).toFixed(2),
      count: selected.length,
      excluded: {unknownDirection: 0, missingBaseAmount: 0},
    } satisfies BankTransactionTotals);
  });
  return requests;
}

const listRows = (page: Page) => page.getByTestId(/^bank-transaction-row-/);
const last = <T>(items: T[]) => items[items.length - 1];

test('groups rows by day and loads fifty more at a time', async ({page}) => {
  // A row not yet booked comes last, the way the API orders it, but belongs to its day.
  const unbooked = row(120, '2026-11-10', {
    bookingDate: null,
    displayDescription: 'Example Pending',
  });
  const rows = [...history(), unbooked];
  const requests = await mockLedger(page, rows);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/bank-transactions');

  await expect(listRows(page)).toHaveCount(50);
  await expect(page.getByRole('heading', {level: 2})).toHaveText([
    'Today',
    'Yesterday',
    'Sunday 8 November',
    'Thursday 1 October',
    'Wednesday 31 December 2025',
  ]);
  // Without a filter the summary is the count alone; no totals are asked for.
  await expect(page.getByTestId('bank-transactions-summary')).toHaveText('121 transactions');
  expect(requests.totals).toHaveLength(0);

  const loadMore = page.getByRole('button', {name: 'Load more'});
  await loadMore.click();
  await expect(listRows(page)).toHaveCount(100);
  expect(last(requests.list)?.get('pagination[pageIndex]')).toBe('1');
  expect(last(requests.list)?.get('pagination[pageSize]')).toBe('50');
  await loadMore.click();
  await expect(listRows(page)).toHaveCount(121);
  await expect(loadMore).toBeHidden();
  // A day that runs across pages stays one card.
  await expect(page.getByRole('heading', {name: 'Sunday 1 June 2025'})).toHaveCount(1);
  const today = page.getByRole('region', {name: 'Today', exact: true});
  await expect(today).toHaveCount(1);
  await expect(today.getByTestId(/^bank-transaction-row-/)).toHaveCount(3);
  await expect(today.getByTestId(`bank-transaction-row-${unbooked.id}`)).toBeVisible();

  // A row loaded later opens at once from the list while its details load.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const later = rows[110];
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
  await expect(page.getByRole('heading', {level: 2})).toHaveCount(0);
  await expect(page.getByRole('list', {name: 'Transactions'})).toBeVisible();
  await expect(listRows(page).first()).toContainText('Example Shop 6');
  await expect(listRows(page).first()).toContainText('8 Nov');
  await expect(listRows(page)).toHaveCount(50);
});

test('shows what a filter matches, spent and earned, swapping the line once', async ({page}) => {
  const requests = await mockLedger(page, history());
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/bank-transactions');
  const summary = page.getByTestId('bank-transactions-summary');
  await expect(summary).toHaveText('120 transactions');

  // Record every line the summary shows from here on.
  await summary.evaluate((element) => {
    const lines: string[] = [element.textContent ?? ''];
    Object.assign(window, {summaryLines: lines});
    new MutationObserver(() => {
      const line = document.querySelector('[data-testid="bank-transactions-summary"]')?.textContent;
      if (line !== undefined && line !== lines[lines.length - 1]) lines.push(line ?? '');
    }).observe(element.parentElement!, {subtree: true, childList: true, characterData: true});
  });
  // The totals arrive after the list; until both are in, the previous line stays.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/bank-transactions/totals?**', async (route) => {
    await held;
    await route.fallback();
  });
  await openTransactionFilter(page, 'Categories');
  await page.getByRole('option', {name: 'Shopping', exact: true}).click();
  await page.keyboard.press('Escape');
  try {
    await expect.poll(() => last(requests.list)?.get('filter[categories][]')).toBe('SHOPPING');
    await expect(listRows(page).nth(1)).toContainText('Example Shop 4');
    await expect(summary).toHaveText('120 transactions');
  } finally {
    release();
  }
  await expect(summary).toHaveText('40 transactions · €400.00 spent');
  expect(await page.evaluate(() => Reflect.get(window, 'summaryLines') as string[])).toEqual([
    '120 transactions',
    '40 transactions · €400.00 spent',
  ]);
  expect(last(requests.totals)?.get('filter[categories][]')).toBe('SHOPPING');

  await page.getByRole('button', {name: 'Remove filter: Shopping'}).click();
  await expect(summary).toHaveText('120 transactions');

  // Opened from a filtered link, there is no earlier line to keep: the line waits for both, then shows once.
  let releaseFirst!: () => void;
  const heldFirst = new Promise<void>((resolve) => (releaseFirst = resolve));
  await page.route('**/bank-transactions/totals?**', async (route) => {
    await heldFirst;
    await route.fallback();
  });
  await page.goto(`/bank-transactions?categories=${encodeURIComponent('["SHOPPING"]')}`);
  try {
    await expect(listRows(page).nth(1)).toContainText('Example Shop 4');
    await expect(summary).toHaveCount(0);
  } finally {
    releaseFirst();
  }
  await expect(summary).toHaveText('40 transactions · €400.00 spent');
});

for (const phone of [false, true]) {
  test(`To review lists exactly the rows the nav badge counts (${phone ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    const rows = history();
    const requests = await mockLedger(page, rows);
    await page.setViewportSize(phone ? {width: 390, height: 844} : {width: 1440, height: 900});
    await page.goto('/bank-transactions');
    await expect(listRows(page)).toHaveCount(50);

    const toggle = page.getByRole('button', {name: /^To review/});
    await expect(toggle).toHaveText(/^To review\s*3$/);
    await expect(toggle).toHaveClass(/border-dashed/);
    if (phone) {
      // Phones start the chips row with it.
      const chips = page.getByRole('list', {name: 'Filters in force'});
      await expect(chips.getByRole('listitem').first().getByRole('button')).toHaveText(
        /^To review/,
      );
    } else {
      // Larger screens keep it in the toolbar, after the date.
      const [toggleBox, dateBox, searchBox] = await Promise.all(
        [
          toggle,
          page.getByRole('button', {name: /^Booking date/}),
          page.getByTestId('bank-transactions-search'),
        ].map(boxOf),
      );
      expect(toggleBox.x).toBeGreaterThan(dateBox.x + dateBox.width);
      expect(toggleBox.y + toggleBox.height / 2).toBeCloseTo(searchBox.y + searchBox.height / 2, 0);
    }

    await toggle.click();
    await expect(page).toHaveURL(/needsAttention=true/);
    await expect(listRows(page)).toHaveCount(3);
    expect(last(requests.list)?.get('filter[needsAttention]')).toBe('true');
    await expect(page.getByTestId('bank-transactions-summary')).toHaveText(
      '3 transactions · €20.00 spent · €25.00 earned',
    );
    const on = page.getByRole('button', {name: 'Remove filter: To review'});
    await expect(on).toBeVisible();
    await expect(on).not.toHaveClass(/border-dashed/);
    // The rows the owner has to settle say so in the warning colour.
    const warning = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'text-warning';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    for (const [index, label] of [
      [1, 'Needs review'],
      [4, 'Not categorized'],
    ] as const) {
      await expect(
        page
          .getByTestId(`bank-transaction-row-${rows[index].id}`)
          .getByText(label, {exact: true})
          .locator('visible=true'),
      ).toHaveCSS('color', warning);
    }

    await on.click();
    await expect(page).not.toHaveURL(/needsAttention/);
    await expect(listRows(page)).toHaveCount(50);
    await expect(toggle).toHaveText(/^To review\s*3$/);
  });
}

test('hides To review while nothing needs review', async ({page}) => {
  await mockLedger(
    page,
    history().map((candidate) => ({...candidate, toReview: false})),
  );
  await page.goto('/bank-transactions');
  await expect(listRows(page)).toHaveCount(50);
  await expect(page.getByRole('button', {name: /^To review/})).toHaveCount(0);
});

test('filters from a two-pane panel whose options alone scroll', async ({page}) => {
  await mockLedger(page, history(), {accounts: 'several'});
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/bank-transactions');

  const panel = await openTransactionFilter(page, 'Categories');
  const tabs = panel.getByRole('tablist', {name: 'Filters'});
  await expect(tabs.getByRole('tab')).toHaveText([
    'Categories',
    'Cash flow',
    'Bank accounts',
    'Category source',
    'Amount in EUR',
  ]);
  await panel.evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
  const panelBox = await boxOf(panel);
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
  const viewport = panel
    .getByRole('tabpanel', {name: 'Categories'})
    .locator('[data-radix-scroll-area-viewport]');
  expect(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const tabsBefore = await boxOf(tabs);
  await viewport.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  // The filter list stays put.
  expect((await boxOf(tabs)).y).toBeCloseTo(tabsBefore.y, 0);

  await panel.getByRole('option', {name: 'Food and drink', exact: true}).click();
  await expect(tabs.getByRole('tab', {name: 'Categories Food and drink'})).toBeVisible();
  await openTransactionFilter(page, 'Bank accounts');
  await expect.poll(scrollers).toEqual({areas: 1, nested: 0});
  // The same size whichever filter it shows.
  expect((await boxOf(panel)).height).toBeCloseTo(panelBox.height, 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Remove filter: Food and drink'})).toBeVisible();
  await expect(page.getByTestId('bank-transaction-filters-trigger')).toContainText('1');
});

test('shows every filter in force as a removable chip, Home drills included', async ({page}) => {
  const requests = await mockLedger(page, history());
  const params = new URLSearchParams({
    merchantGroup: `k_${'a'.repeat(32)}`,
    incomeSource: 'Example Employer',
    recurringSeriesKey: 'b'.repeat(32),
    categoryStatuses: JSON.stringify(['FAILED']),
    categories: JSON.stringify(['FOOD_AND_DRINK', 'SHOPPING', 'HEALTH']),
    bookingDate: JSON.stringify({from: '2026-10-03', to: '2026-10-20'}),
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(`/bank-transactions?${params}`);

  const chips = page
    .getByRole('list', {name: 'Filters in force'})
    .getByRole('button', {name: /^Remove filter/});
  // The date has its own control on larger screens, so it is no chip there.
  await expect(chips).toHaveText([
    '3 categories',
    'Not categorized',
    'One recurring payment',
    'One merchant',
    'One income source',
  ]);
  await page.getByRole('button', {name: 'Remove filter: One merchant'}).click();
  await expect(page).not.toHaveURL(/merchantGroup/);
  await expect.poll(() => last(requests.list)?.has('filter[merchantGroup]')).toBe(false);
  expect(last(requests.list)?.get('filter[incomeSource]')).toBe('Example Employer');
  await expect(chips).toHaveCount(4);

  await page.setViewportSize({width: 390, height: 844});
  await expect(
    page.getByRole('button', {name: 'Remove filter: 3 Oct 2026 – 20 Oct 2026'}),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Remove filter: 3 Oct 2026 – 20 Oct 2026'}).click();
  await expect(page).not.toHaveURL(/bookingDate/);
  await expectNoHorizontalOverflow(page);
});

test('a later page that fails keeps the loaded rows and tries that page again', async ({page}) => {
  // The failed page is retried by the query client before Load more reports it.
  test.slow();
  await mockLedger(page, history());
  const later = await failLaterPages(page, '**/bank-transactions?**', (params) => {
    const index = params.get('pagination[pageIndex]');
    return index && index !== '0' ? index : null;
  });
  await page.goto('/bank-transactions');
  await expectFailedPageRetried(page.locator('main'), listRows(page), later, {
    loaded: 50,
    after: 100,
  });
});

/** Realistic extremes: long names, an unbreakable reference, huge amounts in several currencies, no merchant. */
const worstCase = (): Row[] => [
  row(0, '2026-11-10', {
    displayDescription: 'Aleksandra Wiśniewska-Kowalczyk Interior Design and Renovation Studio',
    counterpartyName: 'Bartholomew Fitzgerald Northwind Industries Holdings',
    amount: '-12345678.90',
    currency: 'EUR',
  }),
  row(1, '2026-11-10', {
    displayDescription: '/TRTP/SEPA-TRANSFER/IBAN/NL91ABNA0417164300/REMI/INV-2026-000123456789',
    amount: '9876543.21',
    currency: 'EUR',
    category: null,
    categoryStatus: 'PROCESSING',
    bankAccountName: SAVINGS_ACCOUNT.name!,
  }),
  row(2, '2026-11-09', {
    displayDescription: 'Jo',
    amount: '-12345678.90',
    currency: 'CHF',
    category: 'NEEDS_REVIEW',
  }),
  row(3, '2026-11-09', {
    displayDescription: 'Café 🍕 東京ラーメン',
    amount: '-1234567.89',
    currency: 'SEK',
    category: 'PERSONAL_CARE',
  }),
];

test('keeps rows, tiles and the Category column in place with worst-case values at every width', async ({
  page,
}) => {
  test.slow();
  const categoryLeft = async () =>
    Math.round((await boxOf(listRows(page).first().getByTestId('ledger-row-category'))).x);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({width, height: 900});
    const lefts: number[] = [];
    for (const accounts of ['one', 'several'] as const) {
      // Later routes win, so each pass answers with its own accounts.
      await mockLedger(page, worstCase(), {accounts});
      await page.goto('/bank-transactions');
      await expect(listRows(page)).toHaveCount(4);
      const account = listRows(page).nth(1).getByTestId('ledger-row-account');
      // Several accounts in one bank and currency: the row names the account itself.
      if (accounts === 'several') await expect(account).toHaveText(SAVINGS_ACCOUNT.name!);
      else await expect(account).toHaveCount(0);
      lefts.push(await categoryLeft());
      await expectNoHorizontalOverflow(page);
    }
    expect(lefts[1], `Category column at ${width}px`).toBe(lefts[0]);
  }

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await page.goto('/bank-transactions');
    await expect(listRows(page)).toHaveCount(4);
    const sizes = await listRows(page).evaluateAll((rows) =>
      rows.map((candidate) => ({
        row: Math.round(candidate.querySelector('button')!.getBoundingClientRect().height),
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
    await expectNoHorizontalOverflow(page);
  }
});
