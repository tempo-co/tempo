import type {Page} from '@playwright/test';
import type {
  BankBalanceTrend,
  BankTransactionBreakdown,
  BankTransactionCashFlow,
  MerchantGroupsResponse,
} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {MARKET_ID, mockSyntheticHome} from '../../data/home-history.data';
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

const monthly = (page: Page, path: string) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith(path) && url.searchParams.get('interval') === 'month';
  });

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
 * Opens Insights on the seeded history. Returns the API's monthly cash flow, `range(from)`: the top-merchants range of a
 * period starting in the month `from` (cut to the history's first month, through the running 1 October), and
 * `merchantList(range)`: the merchants the rail lists for it.
 */
async function openInsights(page: Page) {
  const merchantList = recordMerchantLists(page);
  const cashFlow = monthly(page, '/bank-transactions/cash-flow');
  const balances = monthly(page, '/bank-transactions/balance-trend');
  await page.goto('/insights');
  const flow = (await (await cashFlow).json()) as BankTransactionCashFlow;
  const first = ((await (await balances).json()) as BankBalanceTrend).periods[0].start.slice(0, 7);
  const range = (from: string) => `${from > first ? from : first}-01..2026-10-01`;
  return {flow, range, merchantList};
}

test.describe('Insights over the seeded history', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test.beforeEach(async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  });

  test('every figure and the top merchants follow the period picker, kept in the address, and a merchant opens in the rail', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    const {flow, range, merchantList} = await openInsights(page);

    const picker = page.getByRole('radiogroup', {name: 'Period'});
    // The last 12 months by default, through the running October.
    await expect(picker.getByRole('radio', {name: '12 months'})).toBeChecked();
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2025-11', '2026-10'));
    await merchantList(range('2025-11'));

    await picker.getByRole('radio', {name: '2026'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-01', '2026-10'));
    const [merchant] = await merchantList(range('2026-01'));
    expect(merchant).toBeDefined();
    const top = page.getByRole('region', {name: 'Top merchants'});
    await expect(top.getByRole('listitem').first()).toContainText(merchant.name);

    await picker.getByRole('radio', {name: 'This month'}).click();
    await expect(page).toHaveURL(/\/insights\?period=month$/);
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-10', '2026-10'));
    await merchantList(range('2026-10'));
    // The address keeps the period through a reload.
    await page.reload();
    await expect(picker.getByRole('radio', {name: 'This month'})).toBeChecked();
    await expect(figures(page)).toHaveText(expectedFigures(flow, '2026-10', '2026-10'));

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
    await expect(page.getByRole('list', {name: /^Spent per month, January 2026 to/})).toBeVisible();
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

    // A month's bar opens its page; the arrows step in place, and Back returns to Insights.
    await page.getByRole('link', {name: /^August 2026:/}).click();
    await expect(page).toHaveURL('/insights/months/2026-08?period=2026');
    await expect(page.getByRole('article', {name: 'August 2026'})).toBeVisible();
    await page.getByRole('button', {name: 'Previous month'}).click();
    await expect(page).toHaveURL('/insights/months/2026-07?period=2026');
    await expect(page.getByRole('article', {name: 'July 2026'})).toBeVisible();
    await page.getByRole('button', {name: 'Next month'}).click();
    await page.getByRole('button', {name: 'Next month'}).click();
    await expect(page).toHaveURL('/insights/months/2026-09?period=2026');
    const september = page.getByRole('article', {name: 'September 2026'});
    await expect(september.getByRole('region', {name: 'The month'})).toContainText('In');
    await page.goBack();
    await expect(page).toHaveURL(/\/insights\?period=2026$/);

    // A link to Home's old month dialog opens the month's page.
    await page.goto('/?month=2026-08');
    await expect(page).toHaveURL('/insights/months/2026-08');
    await expect(page.getByRole('article', {name: 'August 2026'})).toBeVisible();
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

  test('over a multi-year history each figure, the money flow and the heat tables cover the picked period', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await mockSyntheticHome(page);
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
    await expect(page.getByRole('region', {name: 'Balance'})).toContainText('€24,300');
    await expect.poll(() => ranges).toContain('2025-12-01..2026-11-05');

    await picker.getByRole('radio', {name: '2025'}).click();
    await expect(page).toHaveURL(/\/insights\?period=2025$/);
    await expect(figures(page)).toHaveText([
      'In+€40,000',
      'Out€24,000',
      'Kept+€16,00040% of income',
    ]);
    // The balance at the period's end, and the top merchants of the same span.
    await expect(page.getByRole('region', {name: 'Balance'})).toContainText('€17,000');
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
    await expect.poll(() => ranges).toContain('2026-11-01..2026-11-05');

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
});
