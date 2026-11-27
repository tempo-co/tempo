import type {Page} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankTransactionBreakdown,
  BankTransactionCashFlow,
  MerchantGroupsResponse,
} from '@wisp/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {MARKET_ID, homeHistory, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';

const figures = (page: Page) =>
  page.getByRole('region', {name: 'Cash flow'}).getByTestId('cash-flow-figure');

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** In, Out and Kept as the page writes them in the browser's en-US locale, from the API's monthly cash flow over `from` through `to` (`YYYY-MM`). */
function expectedFigures(flow: BankTransactionCashFlow, from: string, to: string) {
  const cents = (amount: string) => Math.round(Number(amount) * 100);
  const months = flow.periods.filter(
    (period) => period.start.slice(0, 7) >= from && period.start.slice(0, 7) <= to,
  );
  const income = months.reduce((sum, period) => sum + cents(period.income), 0);
  const spending = months.reduce((sum, period) => sum + cents(period.spending), 0);
  const whole = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: flow.baseCurrency ?? 'EUR',
      maximumFractionDigits: 0,
    }).format(Math.abs(value) / 100);
  const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${whole(value)}`;
  return [
    `In${signed(income)}`,
    `Out${whole(spending)}`,
    new RegExp(`^Kept${escape(signed(income - spending))}`),
  ];
}

const intervalResponse = (page: Page, path: string, interval = 'month') =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(path) && url.searchParams.get('interval') === interval;
  });

const balanceLine = (page: Page) =>
  page.getByRole('region', {name: 'Balance over time'}).getByRole('img');

/** The balance line's name, from the API's totals at each period end of `trend` in `from` through `to` (`YYYY-MM`). */
function expectedBalanceLine(trend: BankBalanceTrend, from: string, to: string) {
  const totals = trend.periods
    .filter((period) => period.end.slice(0, 7) >= from && period.end.slice(0, 7) <= to)
    .flatMap((period) => (period.total === null ? [] : [Number(period.total)]));
  const whole = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: trend.baseCurrency ?? 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  return `Total balance at each ${trend.interval} end, from ${whole(totals[0])} to ${whole(totals[totals.length - 1])}.`;
}

/** Every top-merchants list the page reads, by its `from..to` range. */
function recordMerchantLists(page: Page) {
  const lists = new Map<string, MerchantGroupsResponse>();
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('/merchants') || !response.ok()) return;
    const range = `${url.searchParams.get('from')}..${url.searchParams.get('to')}`;
    lists.set(range, (await response.json()) as MerchantGroupsResponse);
  });
  // The rail lists the merchants that took money in the period, most first.
  return async (range: string) => {
    await expect.poll(() => lists.has(range)).toBe(true);
    return lists.get(range)!.merchants.filter((merchant) => Number(merchant.spent) > 0);
  };
}

/**
 * Opens Insights on the seeded history. Returns the API's monthly cash flow and balance trend, `range(from)`: the top-merchants range of a
 * period starting in the month `from` (cut to the history's first month, through the running 1 October), and
 * `merchantList(range)`: the merchants the rail lists for it.
 */
async function openInsights(page: Page) {
  const merchantList = recordMerchantLists(page);
  const cashFlow = intervalResponse(page, '/bank-transactions/cash-flow');
  const balances = intervalResponse(page, '/bank-transactions/balance-trend');
  await page.goto('/insights');
  const flow = (await (await cashFlow).json()) as BankTransactionCashFlow;
  const trend = (await (await balances).json()) as BankBalanceTrend;
  const first = trend.periods[0].start.slice(0, 7);
  const range = (from: string) => `${from > first ? from : first}-01..2026-10-01`;
  return {flow, trend, range, merchantList};
}

test.describe('Insights over the seeded history', () => {
  // The seeded clock's 1 October is a local date, so the calendar is pinned too.
  test.use({storageState: VERIFIED_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});

  test.beforeEach(async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  });

  test('every figure, the balance line and the top merchants follow the period picker, kept in the address, and a merchant opens in the rail', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    const {flow, trend, range, merchantList} = await openInsights(page);

    const picker = page.getByRole('radiogroup', {name: 'Period'});
    // The last 12 months by default, through the running October.
    await expect(picker.getByRole('radio', {name: '12 months'})).toBeChecked();
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2025-11', '2026-10'));
    // The total balance at each month end of the period.
    await expect(balanceLine(page)).toHaveAccessibleName(
      expectedBalanceLine(trend, '2025-11', '2026-10'),
    );
    await merchantList(range('2025-11'));

    await picker.getByRole('radio', {name: '2026'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-01', '2026-10'));
    const [merchant] = await merchantList(range('2026-01'));
    expect(merchant).toBeDefined();
    const top = page.getByRole('region', {name: 'Top merchants'});
    await expect(top.getByRole('listitem').first()).toContainText(merchant.name);

    const dayEnds = intervalResponse(page, '/bank-transactions/balance-trend', 'day').then(
      async (response) => (await response.json()) as BankBalanceTrend,
    );
    await picker.getByRole('radio', {name: 'This month'}).click();
    await expect(page).toHaveURL(/\/insights\?period=month$/);
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-10', '2026-10'));
    await merchantList(range('2026-10'));
    // The address keeps the period through a reload.
    await page.reload();
    await expect(picker.getByRole('radio', {name: 'This month'})).toBeChecked();
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-10', '2026-10'));
    // This month's balance line is drawn by day: on the 1st, one day end, shown as a dot. A point opens its month's
    // page with the period kept.
    const days = await dayEnds;
    expect(days.periods.map((period) => period.end)).toEqual(['2026-10-01']);
    await expect(balanceLine(page)).toHaveAccessibleName(
      expectedBalanceLine(days, '2026-10', '2026-10'),
    );
    await expect(balanceLine(page).locator('[data-slot="lone-point"]')).toBeVisible();
    await balanceLine(page).click();
    await expect(page).toHaveURL('/insights/months/2026-10?period=month');
    await page.goBack();
    await expect(page).toHaveURL(/\/insights\?period=month$/);

    await picker.getByRole('radio', {name: '2026'}).click();
    const view = page.getByRole('tablist', {name: 'Cash flow view'});
    await view.getByRole('tab', {name: 'Table'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026&view=table$/);
    await expect(page.getByRole('region', {name: 'Year by year'})).toBeVisible();
    await expect(page.getByRole('region', {name: 'Spending by category'})).toBeVisible();
    await view.getByRole('tab', {name: 'Chart'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);
    await expect(page.getByRole('list', {name: /^In and out per month/})).toBeVisible();

    // The period's biggest merchant opens beside Insights at its own address, and closing it shows the rail again.
    await top.getByRole('listitem').first().getByRole('button').click();
    await expect(page).toHaveURL(new RegExp(`/insights\\?period=2026&merchant=${merchant.id}$`));
    const details = page.getByRole('complementary', {name: 'Merchant'});
    await expect(details.getByRole('heading', {name: merchant.name})).toBeVisible();
    await expect(top).toHaveCount(0);
    await page.reload();
    await expect(details.getByRole('heading', {name: merchant.name})).toBeVisible();
    await details.getByRole('button', {name: 'Close merchant'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);
    await expect(top).toBeVisible();
  });

  test('a category and a month open on their own pages over the picked period, and an old month link lands on its page', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    const categoryLists = new Map<string, MerchantGroupsResponse>();
    page.on('response', async (response) => {
      const url = new URL(response.url());
      const category = url.searchParams.get('category');
      if (!url.pathname.endsWith('/merchants') || !category || !response.ok()) return;
      categoryLists.set(
        `${category} ${url.searchParams.get('from')}..${url.searchParams.get('to')}`,
        (await response.json()) as MerchantGroupsResponse,
      );
    });
    const breakdown = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/bank-transactions/breakdown') &&
        url.searchParams.get('by') === 'category' &&
        url.searchParams.get('interval') === 'month'
      );
    });
    const {flow, range} = await openInsights(page);
    const categories = ((await (await breakdown).json()) as BankTransactionBreakdown).periods;
    await page.getByRole('radiogroup', {name: 'Period'}).getByRole('radio', {name: '2026'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);

    // The period's biggest category opens its page, keeping the period.
    const first = page.getByRole('region', {name: 'Categories'}).getByRole('link').first();
    const href = (await first.getAttribute('href'))!;
    const key = decodeURIComponent(href.match(/\/insights\/categories\/([^?]+)/)![1]);
    await first.click();
    await expect(page).toHaveURL(`/insights/categories/${key}?period=2026`);
    const whole = (cents: number) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: flow.baseCurrency ?? 'EUR',
        maximumFractionDigits: 0,
      }).format(cents / 100);
    const spent = categories
      .filter((period) => period.start >= '2026-01' && period.start < '2026-11')
      .reduce(
        (sum, period) =>
          sum +
          Math.round(Number(period.parts.find((part) => part.key === key)?.amount ?? 0) * 100),
        0,
      );
    await expect(page.getByTestId('category-figure').first()).toHaveText(`Spent${whole(spent)}`);
    // One bar a month of 2026 that has history, through the running October.
    await expect(
      page.getByRole('list', {name: /^Spent per month, .+ 2026 to October 2026$/}),
    ).toBeVisible();
    // Its top merchants are the API's ranking of that category's rows over the period.
    const listed = `${key} ${range('2026-01')}`;
    await expect.poll(() => categoryLists.has(listed)).toBe(true);
    const merchants = categoryLists
      .get(listed)!
      .merchants.filter((merchant) => Number(merchant.spent) > 0)
      .slice(0, 6);
    const top = page.getByRole('region', {name: 'Top merchants'});
    expect(merchants.length).toBeGreaterThan(0);
    await expect(top.getByRole('listitem')).toHaveCount(merchants.length);
    await expect(top.getByRole('listitem').first()).toContainText(merchants[0].name);
    const transactions = page.getByRole('region', {name: 'Transactions'});
    const all = new URL(
      (await transactions.getByRole('link', {name: 'Open in Transactions'}).getAttribute('href'))!,
      page.url(),
    ).searchParams;
    expect(JSON.parse(all.get('categories')!)).toEqual([key]);
    await page.getByRole('main').getByRole('link', {name: 'Insights', exact: true}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);

    // A month's bar opens its page; the arrows step through the seeded history, August to the running October, in
    // place, and Back returns to Insights.
    await page.getByRole('link', {name: /^September 2026:/}).click();
    await expect(page).toHaveURL('/insights/months/2026-09?period=2026');
    await expect(page.getByRole('article', {name: 'September 2026'})).toBeVisible();
    const previous = page.getByRole('button', {name: 'Previous month'});
    const next = page.getByRole('button', {name: 'Next month'});
    await previous.click();
    await expect(page).toHaveURL('/insights/months/2026-08?period=2026');
    await expect(page.getByRole('article', {name: 'August 2026'})).toBeVisible();
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(page).toHaveURL('/insights/months/2026-09?period=2026');
    await next.click();
    await expect(page).toHaveURL('/insights/months/2026-10?period=2026');
    const october = page.getByRole('article', {name: 'October 2026'});
    await expect(october.getByRole('region', {name: 'The month'})).toContainText('Kept so far');
    await expect(next).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);

    // A link to a month over Home opens the month's page. It opens in a tab of its own: a full load here would drop the
    // bodies of reads the recorders above still wait on.
    const link = await page.context().newPage();
    await link.goto('/?month=2026-08');
    await expect(link).toHaveURL('/insights/months/2026-08');
    await expect(link.getByRole('article', {name: 'August 2026'})).toBeVisible();
  });

  test('on a phone a merchant opens in a sheet over Insights', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    const {range, merchantList} = await openInsights(page);
    const [merchant] = await merchantList(range('2025-11'));
    expect(merchant).toBeDefined();
    const top = page.getByRole('region', {name: 'Top merchants'});
    await expect(top.getByRole('listitem').first()).toContainText(merchant.name);
    await top.getByRole('listitem').first().getByRole('button').click();

    const sheet = page.getByRole('dialog', {name: 'Merchant'});
    await expect(sheet.getByRole('heading', {name: merchant.name})).toBeVisible();
    await expect(page).toHaveURL(`/insights?merchant=${merchant.id}`);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/insights$/);
  });
});

test.describe('Insights over a synthetic multi-year history', () => {
  // Every response is synthetic: these checks never read or mutate a shared API stack.
  test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

  const LANDLORD_ID = `k_${'e5'.repeat(16)}`;
  const HIDDEN_ACCOUNT_ID = '00000000-0000-4000-8000-0000000000a2';

  /** Top merchants over any range: the landlord, then the market; records each request's range. */
  async function mockInsightsMerchants(page: Page) {
    const ranges: string[] = [];
    await page.route('**/merchants?**', (route) => {
      const params = new URL(route.request().url()).searchParams;
      ranges.push(`${params.get('from')}..${params.get('to')}`);
      const item = (id: string, name: string, spent: string, count: number) => ({
        id,
        name,
        kind: 'MERCHANT' as const,
        logoUrl: null,
        spent,
        received: '0.00',
        count,
        lastDate: '2026-11-01',
      });
      return fulfillJson(route, {
        baseCurrency: 'EUR',
        merchants: [
          item(LANDLORD_ID, 'Example Landlord', '1200.00', 1),
          item(MARKET_ID, 'Example Market', '500.00', 9),
        ],
        total: 2,
      } satisfies MerchantGroupsResponse);
    });
    return ranges;
  }

  test('over a multi-year history each figure, the balance line, the money flow and the heat tables cover the picked period', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    const history = homeHistory();
    await mockSyntheticHome(page, {history});
    // A hidden account is listed with its balance but counted in no total; before 2025 only it has history.
    await page.route('**/bank-transactions/balance-trend?**', (route) => {
      const query = new URL(route.request().url()).searchParams;
      const trend =
        query.get('interval') === 'day'
          ? history.dayEnds(query.get('from')!, query.get('to')!, query.get('asOf')!)
          : history.trend;
      return fulfillJson(route, {
        ...trend,
        periods: trend.periods.map((period) => ({
          ...period,
          total: period.end < '2025-01-01' ? null : period.total,
          accounts: [...period.accounts, {id: HIDDEN_ACCOUNT_ID, balance: '99999.00'}],
        })),
      } satisfies BankBalanceTrend);
    });
    const ranges = await mockInsightsMerchants(page);
    await page.goto('/insights');

    const picker = page.getByRole('radiogroup', {name: 'Period'});
    // The last 12 months by default: December 2025 to the running November, which has only the rent so far.
    await expect(picker.getByRole('radio', {name: '12 months'})).toBeChecked();
    await expect(page.getByText('December 2025 – November 2026', {exact: true})).toBeVisible();
    await expect(figures(page)).toHaveText([
      'In+€33,000',
      'Out€24,700',
      'Kept+€8,30025% of income',
    ]);
    await expect(page.getByRole('region', {name: 'Balance', exact: true})).toContainText('€24,300');
    await expect(balanceLine(page)).toHaveAccessibleName(
      'Total balance at each month end, from €17,000 to €24,300.',
    );
    await expect.poll(() => ranges).toContain('2025-12-01..2026-11-05');

    await picker.getByRole('radio', {name: '2025'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2025$/);
    await expect(figures(page)).toHaveText([
      'In+€40,000',
      'Out€24,000',
      'Kept+€16,00040% of income',
    ]);
    // The balance at the period's end, and the top merchants of the same span.
    await expect(page.getByRole('region', {name: 'Balance', exact: true})).toContainText('€17,000');
    await expect(balanceLine(page)).toHaveAccessibleName(
      'Total balance at each month end, from €2,000 to €17,000.',
    );
    await expect.poll(() => ranges).toContain('2025-01-01..2025-12-31');
    const flow = page.getByRole('region', {name: 'Where the money went'});
    await expect(flow.getByTestId('money-flow-target')).toHaveText([
      /^Housing and utilities€14,400 · 36%$/,
      /^Groceries€6,000 · 15%$/,
      /^Shopping€2,400 · 6%$/,
      /^Other \(3 categories\)€1,200 · 3%$/,
      /^Kept€16,000 · 40%$/,
    ]);
    const categories = page.getByRole('region', {name: 'Categories'});
    await expect(categories.getByRole('link').first()).toHaveText(
      /^Housing and utilities.*€1,200€14,400$/,
    );

    await picker.getByRole('radio', {name: 'This month'}).click();
    await expect(page).toHaveURL(/\/insights\?period=month$/);
    await expect(figures(page)).toHaveText(['In€0', 'Out€1,200', 'Kept−€1,200']);
    await expect(balanceLine(page)).toHaveAccessibleName(
      'Total balance at each day end, from €24,300 to €24,300.',
    );
    // A screen reader gets each day's exact balance and its change since the day before.
    const days = page.getByRole('region', {name: 'Balance over time'}).getByRole('row');
    await expect(days).toHaveText([
      'DayBalanceChange',
      'Sun 1 Nov 2026€24,300.00—',
      'Mon 2 Nov 2026€24,300.00€0.00',
      'Tue 3 Nov 2026€24,300.00€0.00',
      'Wed 4 Nov 2026€24,300.00€0.00',
      'Thu 5 Nov 2026, so far€24,300.00€0.00',
    ]);
    await expect.poll(() => ranges).toContain('2026-11-01..2026-11-05');

    // Before 2025 only the hidden account has a balance: the line says there is none rather than drawing zero.
    await picker.getByRole('radio', {name: '2024'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2024$/);
    const balance = page.getByRole('region', {name: 'Balance over time'});
    await expect(
      balance.getByRole('heading', {name: 'No total balance for this period'}),
    ).toBeVisible();
    await expect(balanceLine(page)).toHaveCount(0);

    await picker.getByRole('radio', {name: '12 months'}).click();
    await expect(page).toHaveURL(/\/insights$/);
    const view = page.getByRole('tablist', {name: 'Cash flow view'});
    await view.getByRole('tab', {name: 'Table'}).click();
    await expect(page).toHaveURL(/\/insights\?view=table$/);
    await expect(page.getByRole('region', {name: 'Year by year'})).toBeVisible();
    // The tables cover the period too: 2025 only from December, 2026 so far.
    const spending = page.getByRole('region', {name: 'Spending by category'});
    await expect(spending.getByRole('columnheader', {name: /^2025/})).toHaveText(/from Dec/);
    await expect(spending.getByRole('columnheader', {name: /^2026/})).toHaveText(/so far/);
    await expect(page.getByRole('region', {name: 'Income by source'})).toBeVisible();
    await view.getByRole('tab', {name: 'Chart'}).click();
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.getByRole('region', {name: 'Year by year'})).toHaveCount(0);
    await expect(page.getByRole('list', {name: /^In and out per month/})).toBeVisible();
  });
  for (const {period, line, held: heldInterval, after} of [
    {
      period: 'month',
      line: 'Total balance at each day end, from €24,300 to €24,300.',
      held: 'day',
      after: 'Tue 1 Dec 2026, so far€24,300.00—',
    },
    {
      period: '12m',
      line: 'Total balance at each month end, from €17,000 to €24,300.',
      held: 'month',
      after: 'January 2026€18,000.00+€1,000.00',
    },
  ] as const) {
    test(`past midnight into a new month, the ${period} balance line waits for the new day's balances`, async ({
      page,
    }) => {
      await page.setViewportSize({width: 1440, height: 1000});
      await mockSyntheticHome(page, {clock: 'installed'});
      await page.clock.setSystemTime(new Date('2026-11-30T23:59:30+01:00'));
      await mockInsightsMerchants(page);
      await page.goto(`/insights?period=${period}`);
      await expect(balanceLine(page)).toHaveAccessibleName(line);

      // The balances read as of 1 December wait until the spec lets them through, while the page turns to December.
      const held: (() => void)[] = [];
      await page.route('**/bank-transactions/balance-trend?**', async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('asOf') !== '2026-12-01' || query.get('interval') !== heldInterval)
          return route.fallback();
        await new Promise<void>((resolve) => held.push(resolve));
        await route.fallback();
      });
      const balance = page.getByRole('region', {name: 'Balance over time'});
      try {
        // The open tab's day timer turns the page to 1 December.
        await page.clock.fastForward(60_000);
        await expect(page.getByText(/December 2026$/)).toBeVisible();
        await expect.poll(() => held.length).toBe(1);
        // November's balances never stand under the new period.
        await expect(balance).toHaveAttribute('aria-busy', 'true');
        await expect(balanceLine(page)).toHaveCount(0);
      } finally {
        held.forEach((release) => release());
      }
      await expect(balance.getByRole('row').nth(1)).toHaveText(after);
    });
  }
});
