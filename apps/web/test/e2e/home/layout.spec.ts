import type {Locator, Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {createAccount} from '../../data/account.data';
import {
  HOME_CONNECTION,
  HOME_REVIEW_COUNTS,
  MARKET_ID,
  RENT_KEY,
  USUAL_SPENDING,
  homeHistory,
  homeRecurring,
  mockSyntheticHome,
  monthTransactions,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson} from '../../utils/api-mocks';
import {boxOf, brokenAmounts, expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

const layouts = [
  {width: 1440, theme: 'light'},
  {width: 1440, theme: 'dark'},
  {width: 1280, theme: 'light'},
  {width: 1024, theme: 'dark'},
  {width: 768, theme: 'light'},
  {width: 430, theme: 'dark'},
  {width: 390, theme: 'light'},
  {width: 390, theme: 'dark'},
  {width: 360, theme: 'light'},
  {width: 320, theme: 'light'},
  {width: 320, theme: 'dark'},
] as const;

const LONG_SOURCE = 'INCOME:example payroll';
const SCALE = 1000;
const FIRST_MONTH = '2007-01';

/**
 * Worst-case Home: twenty years of history, every amount a thousand times the demo's (balances in the tens of
 * millions) and forty income sources, one with a long legal name, all synthetic.
 */
function worstCase() {
  const spending = (month: string): Record<string, number> => {
    const base: Record<string, number> =
      month === '2026-11' ? {HOUSING_AND_UTILITIES: 1200} : {...USUAL_SPENDING};
    if (month === '2026-03') base.TRAVEL = 1500;
    if (month === '2025-09') Object.assign(base, {SHOPPING: 2600, HEALTH: 900});
    return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value * SCALE]));
  };
  const income = (month: string): Record<string, number> => {
    if (month === '2026-11') return {};
    const sources: Record<string, number> = {[LONG_SOURCE]: 2900 * SCALE};
    for (let index = 1; index <= 39; index++)
      sources[`INCOME:example source ${index}`] = index * 10;
    if (month === '2025-06') sources['INCOME:example bonus'] = 4000 * SCALE;
    return sources;
  };
  const sourceLabels: Record<string, string> = {
    [LONG_SOURCE]: 'Example International Holdings Netherlands B.V. Payroll Department',
  };
  for (let index = 1; index <= 39; index++)
    sourceLabels[`INCOME:example source ${index}`] = `Example Source ${index}`;
  return homeHistory({spending, income, sourceLabels, firstMonth: FIRST_MONTH});
}

/** Six accounts at one bank, each with a long name and a balance in the tens of millions, all synthetic. */
const worstConnections = () => [
  {
    ...HOME_CONNECTION,
    aspspName: 'Example Cooperative Savings and Loan Association of the Netherlands',
    bankAccounts: Array.from({length: 6}, (_, index) => ({
      ...HOME_CONNECTION.bankAccounts[0],
      id: `00000000-0000-4000-8000-0000000000b${index}`,
      name: `Example Joint Household Account With A Very Long Name Number ${index + 1}`,
      currentBalanceAmount: '48123456.78',
      currentBalanceInBaseCurrency: '48123456.78',
    })),
  },
];

const LONG_PAYEE = 'Example Municipal Water, Waste and Energy Services Cooperative Netherlands';

/**
 * The rest of worst-case Home, all synthetic: six accounts' data running out on different days (one with none yet),
 * bills with long names and amounts in the tens of thousands, the newest transactions with long descriptions and
 * amounts in the millions, and more to check than fits a badge.
 */
async function mockWorstHomeCards(page: Page) {
  const accounts = worstConnections()[0].bankAccounts;
  await page.route('**/bank-connections/coverage?**', (route) =>
    fulfillJson(route, {
      from: '2026-10-07',
      to: '2026-11-05',
      lastCoveredDay: '2026-11-05',
      accounts: accounts.map((account, index) => {
        const through =
          index === 5
            ? null
            : `2026-${index < 2 ? '11-0' + (5 - index) : '10-' + (30 - index * 4)}`;
        return {
          bankAccountId: account.id,
          source: index % 2 ? 'file' : 'sync',
          coveredThrough: through,
          ranges: through ? [{from: '2026-10-07', to: through}] : [],
        };
      }),
    }),
  );
  const recurring = homeRecurring();
  const long = <T extends {name: string; typicalAmount: string}>(series: T) => ({
    ...series,
    name: LONG_PAYEE,
    typicalAmount: '48123.45',
  });
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, {
      ...recurring.summary,
      upcoming: recurring.summary.upcoming.map(long),
      flagged: recurring.summary.flagged.map(long),
      expenseThisMonth: {...recurring.summary.expenseThisMonth, remaining: '96246.90'},
    }),
  );
  await page.route('**/bank-transactions?**', (route) => {
    if (new URL(route.request().url()).searchParams.has('filter[date][from]'))
      return route.fallback();
    const newest = monthTransactions('2026-11', 5);
    return fulfillJson(route, {
      ...newest,
      total: 48_210,
      transactions: newest.transactions.map((transaction) => ({
        ...transaction,
        displayDescription: LONG_PAYEE,
        description: LONG_PAYEE,
        amount: '-48123456.78',
        amountInBaseCurrency: '-48123456.78',
      })),
    });
  });
}

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Visible links and buttons under 44px in either direction, inside `selector`. */
const smallTargets = (page: Page, selector: string) =>
  page.evaluate(
    (root) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${root} a, ${root} button`))
        .filter((element) => element.offsetParent !== null)
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.height < 43.5 || box.width < 43.5;
        })
        .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim()),
    selector,
  );

/** Home's cards in page order: each a 1px hairline with 8px corners and no shadow, its heading 16px in from the edge. */
const homeCards = (page: Page) =>
  page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('main [role="region"]')).filter(
      (card) => !card.parentElement?.closest('[role="region"]'),
    );
    return cards.map((card) => {
      const css = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const heading = card.querySelector('h2');
      const headingCss = heading && getComputedStyle(heading);
      return {
        card: card.getAttribute('aria-label'),
        border: css.borderTopWidth,
        radius: css.borderRadius,
        shadow: css.boxShadow,
        inset: heading
          ? Math.round(heading.getBoundingClientRect().left - box.left - card.clientLeft)
          : null,
        heading: headingCss && `${headingCss.fontSize} ${headingCss.fontWeight}`,
      };
    });
  });

const card = (name: string) => ({
  card: name,
  border: '1px',
  radius: '8px',
  shadow: 'none',
  inset: 16,
  heading: '13px 600',
});

/** Wide, the main column then the rail; narrower, one column that opens with Your data and To do. */
const WIDE_ORDER = [
  'Spending pace',
  'Top categories this month',
  'Accounts',
  'Recent transactions',
  'Your data',
  'To do',
  'Coming up',
];
const NARROW_ORDER = [
  'Your data',
  'To do',
  'Spending pace',
  'Top categories this month',
  'Accounts',
  'Recent transactions',
  'Coming up',
];

for (const [name, history, connections] of [
  ['demo', homeHistory, () => [HOME_CONNECTION]],
  ['worst-case', worstCase, worstConnections],
] as const) {
  for (const {width, theme} of layouts) {
    test(`Home and a month fit ${name} data at ${width}px in ${theme}`, async ({
      page,
      homePage,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 1000});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockSyntheticHome(page, {
        history: history(),
        connections: connections(),
        reviewCounts:
          name === 'worst-case' ? {...HOME_REVIEW_COUNTS, needsAttention: 1284} : undefined,
      });
      if (name === 'worst-case') await mockWorstHomeCards(page);
      await page.goto('/');
      await expect(homePage.paceFigure).toBeVisible();
      await expectLoaded(page);
      await page.evaluate(() => document.fonts.ready);
      const capture = async (view: string) => {
        if (!process.env.HOME_POLISH_CAPTURE_DIR) return;
        await mkdir(process.env.HOME_POLISH_CAPTURE_DIR, {recursive: true});
        await page.screenshot({
          path: join(process.env.HOME_POLISH_CAPTURE_DIR, `${view}-${name}-${theme}-${width}.png`),
          fullPage: view !== 'month',
        });
      };
      await capture('home');
      await expectNoHorizontalOverflow(page);
      expect
        .soft(await homeCards(page))
        .toEqual((width >= 1024 ? WIDE_ORDER : NARROW_ORDER).map(card));
      expect.soft(await brokenAmounts(page)).toEqual([]);
      if (name === 'worst-case')
        await expect(homePage.card('To do')).toContainText('Check 1,284 transactions');
      // Every control is a full tap target on a phone.
      if (width < 640) expect.soft(await smallTargets(page, 'main')).toEqual([]);
      // Customizing puts move and hide buttons in every card's header without pushing anything out.
      await page.getByRole('button', {name: 'Customize'}).click();
      await expect(
        homePage.card('Accounts').getByRole('button', {name: 'Hide Accounts'}),
      ).toBeVisible();
      await capture('home-customize');
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);

      await page.goto('/insights/months/2025-09');
      const dialog = homePage.monthPage('September 2025');
      await expect(dialog.getByRole('region', {name: 'Biggest merchants'})).toBeVisible();
      await expectLoaded(dialog);
      await capture('month');
      expect.soft(await brokenAmounts(page)).toEqual([]);
      // Every transaction row has the shared row height, past its divider.
      const rowHeights = await dialog
        .getByRole('region', {name: 'Transactions'})
        .getByRole('listitem')
        .evaluateAll((rows) => rows.map((row) => row.clientHeight));
      expect(rowHeights.length).toBeGreaterThan(0);
      expect.soft([...new Set(rowHeights)]).toEqual([60]);
      if (width < 640) expect.soft(await smallTargets(page, 'article')).toEqual([]);
      const sections = await dialog.evaluate((element) =>
        Array.from(element.querySelectorAll('section'))
          .filter((section) => section.scrollWidth > section.clientWidth + 1)
          .map((section) => section.getAttribute('aria-label')),
      );
      expect.soft(sections).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

for (const {width, rows} of [
  {width: 390, rows: [2, 2]},
  {width: 1440, rows: [4]},
]) {
  test(`a month's figures are one card in four cells, ${rows.join(' by ')} at ${width}px`, async ({
    page,
    homePage,
  }) => {
    await page.setViewportSize({width, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/insights/months/2026-03');

    const figures = homePage.monthPage('March 2026').getByRole('region', {name: 'The month'});
    await expectLoaded(figures);
    const card = await boxOf(figures);
    const cells = await figures.evaluate((element) =>
      Array.from(element.children).map((cell) => {
        const box = cell.getBoundingClientRect();
        return {x: Math.round(box.x), y: Math.round(box.y), right: Math.round(box.right)};
      }),
    );
    expect(cells).toHaveLength(4);
    // Rows of cells, top to bottom, each as wide as the card and split by hairlines.
    const lines = [...new Set(cells.map((cell) => cell.y))];
    expect(lines.map((y) => cells.filter((cell) => cell.y === y).length)).toEqual(rows);
    for (const y of lines) {
      const line = cells.filter((cell) => cell.y === y);
      expect(line[0].x).toBe(Math.round(card.x) + 1);
      expect(line[line.length - 1].right).toBe(Math.round(card.x + card.width) - 1);
      for (let index = 1; index < line.length; index++)
        expect(line[index].x - line[index - 1].right).toBe(1);
    }
  });
}

test('Home’s text actions and Load more buttons share one style with the month’s, a merchant’s and the Recurring ones, as do their transaction lists’ headings', async ({
  page,
  homePage,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await mockSyntheticHome(page, {transactionsPerMonth: 45});
  await page.goto('/');

  const style = (action: Locator) =>
    action.evaluate((element: HTMLElement) => {
      const css = getComputedStyle(element);
      return {
        font: `${css.fontSize} ${css.fontWeight}`,
        color: css.color,
        padding: css.padding,
        // Layout height, unaffected by a dialog's opening zoom.
        height: element.offsetHeight,
      };
    });
  const heading = (title: Locator) =>
    title.evaluate((element: HTMLElement) => {
      const css = getComputedStyle(element);
      return `${css.fontSize}/${css.lineHeight} ${css.fontWeight} ${css.color}`;
    });
  const actions = [
    homePage.paceCard.getByRole('link', {name: 'Insights'}),
    homePage.card('Coming up').getByRole('link', {name: 'Recurring'}),
    homePage.card('Recent transactions').getByRole('link', {name: 'All'}),
  ];
  await expect(actions[0]).toBeVisible();
  const styles = [];
  for (const action of actions) styles.push(await style(action));
  await page.goto('/insights/months/2026-03');
  const transactions = homePage.monthPage('March 2026').getByRole('region', {name: 'Transactions'});
  styles.push(await style(transactions.getByRole('link', {name: 'Open in Transactions'})));
  const headings = [await heading(transactions.getByRole('heading', {name: 'Transactions'}))];
  // Paged lists end in a full-width Load more.
  const loadMores = [await style(transactions.getByRole('button', {name: 'Load more'}))];

  // A merchant's and a recurring payment's transactions: more pages than one, opening in Transactions.
  await page.route(`**/merchants/${MARKET_ID}`, (route) =>
    fulfillJson(route, {
      id: MARKET_ID,
      name: 'Example Market',
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '500.00',
      received: '0.00',
      count: 45,
      lastDate: '2026-10-28',
      baseCurrency: 'EUR',
      paid: '500.00',
      refunded: '0.00',
      paymentCount: 45,
      averagePayment: '11.11',
      firstDate: '2025-01-02',
      excluded: {missingBaseAmount: 0},
      variants: [],
    }),
  );
  await page.route(`**/merchants/${MARKET_ID}/periods?**`, (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', interval: 'month', periods: []}),
  );
  await page.route('**/bank-transactions?**', (route) =>
    fulfillJson(route, {...monthTransactions('2026-10', 20), total: 45}),
  );
  await page.goto(`/insights?merchant=${MARKET_ID}`);
  const merchant = page.getByRole('complementary', {name: 'Merchant'});
  styles.push(await style(merchant.getByRole('link', {name: 'Open in Transactions'})));
  loadMores.push(await style(merchant.getByRole('button', {name: 'Load more'})));
  headings.push(await heading(merchant.getByRole('heading', {name: '45 transactions'})));
  await page.goto(`/recurring?series=${RENT_KEY}`);
  const recurring = page.getByRole('region', {name: 'Recurring payment details'});
  styles.push(
    await style(
      recurring
        .getByRole('region', {name: 'Payments'})
        .getByRole('link', {name: 'Open in Transactions'}),
    ),
  );
  loadMores.push(await style(recurring.getByRole('button', {name: 'Load more'})));
  headings.push(
    await heading(
      recurring
        .getByRole('region', {name: 'Payments'})
        .getByRole('heading', {name: 'All 45 payments'}),
    ),
  );

  expect(styles[0]).toMatchObject({font: '13px 400', height: 28});
  for (const item of styles) expect(item).toEqual(styles[0]);
  for (const item of loadMores) expect(item).toEqual(loadMores[0]);
  for (const item of headings) expect(item).toEqual(headings[0]);
});

/**
 * The shell's data: who is signed in and what the badges count. The worst case is a long hyphenated name with
 * diacritics, an email at a long company domain, more transactions to review than the badge shows, and two banks
 * that need attention, all synthetic.
 */
const shellData = {
  demo: {
    account: createAccount({email: 'owner@example.com'}),
    needsAttention: 3,
    connections: [HOME_CONNECTION],
    bankProblem: false,
  },
  'worst-case': {
    account: createAccount({
      name: 'Aleksandra Wiśniewska-Kowalczyk von Hohenberg-Ostrowska',
      email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    }),
    needsAttention: 1284,
    bankProblem: true,
    connections: [
      {...HOME_CONNECTION, status: 'EXPIRED' as const, syncStatus: 'EXPIRED' as const},
      {
        ...HOME_CONNECTION,
        id: '00000000-0000-4000-8000-0000000000e2',
        status: 'EXPIRED' as const,
        syncStatus: 'EXPIRED' as const,
      },
    ],
  },
};

/** Elements inside `root` whose box runs past `root`'s, by their label or text. */
const outside = (root: Locator, selector: string) =>
  root.evaluate((element, inner) => {
    const box = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>(inner))
      .filter((child) => child.getClientRects().length > 0)
      .filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
      })
      .map((child) => child.getAttribute('aria-label') ?? child.textContent?.trim());
  }, selector);

for (const [name, data] of Object.entries(shellData)) {
  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 1440, theme: 'dark'},
    {width: 390, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'light'},
    {width: 320, theme: 'dark'},
  ] as const) {
    test(`the shell fits ${name} data at ${width}px in ${theme}`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockSyntheticHome(page, {
        connections: data.connections,
        reviewCounts: {...HOME_REVIEW_COUNTS, needsAttention: data.needsAttention},
      });
      await mockJson(page, '**/accounts/me', data.account);
      await page.goto('/insights');
      await expect(page.getByRole('heading', {name: 'Insights', level: 1})).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (process.env.HOME_POLISH_CAPTURE_DIR) {
        await mkdir(process.env.HOME_POLISH_CAPTURE_DIR, {recursive: true});
        await page.screenshot({
          path: join(process.env.HOME_POLISH_CAPTURE_DIR, `shell-${name}-${theme}-${width}.png`),
        });
      }
      const badgeText = data.needsAttention > 99 ? '99+' : String(data.needsAttention);
      await expect(page.getByText(badgeText, {exact: true}).locator('visible=true')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const title = await boxOf(page.getByRole('heading', {level: 1}));

      if (width >= 768) {
        const sidebar = page.locator('[data-sidebar="sidebar"]');
        // The sidebar, with its hairline, runs the window's height from its left edge; the column starts 16px past it.
        const edge = await boxOf(sidebar.locator('xpath=..'));
        expect({x: edge.x, height: edge.height}).toEqual({x: 0, height: 900});
        expect(title.x).toBe(edge.x + edge.width + 16);
        // A long name and email truncate inside the sidebar, and the gear stays whole beside them.
        expect.soft(await outside(sidebar, 'a, button, span')).toEqual([]);
        const gear = await boxOf(sidebar.getByRole('link', {name: 'Settings'}));
        expect(gear).toMatchObject({width: 36, height: 36});
        for (const id of ['current-account-name', 'current-account-email']) {
          const text = await boxOf(page.getByTestId(id));
          expect.soft(text.x + text.width, id).toBeLessThanOrEqual(gear.x);
          expect.soft(text.height, id).toBe(20);
        }
        // The count stays a one-line pill inside its row, after the label.
        const transactions = sidebar.getByRole('link', {name: /^Transactions, /});
        const badge = await boxOf(transactions.getByText(badgeText, {exact: true}));
        const row = await boxOf(transactions);
        expect.soft(badge.height).toBe(18);
        expect.soft(badge.x + badge.width).toBeLessThanOrEqual(row.x + row.width);
        if (data.bankProblem)
          await expect(sidebar.getByRole('link', {name: /^Accounts, /}).locator('i')).toBeVisible();
      } else {
        const header = await boxOf(page.getByTestId('app-phone-header'));
        const tabs = page.getByTestId('app-tab-bar');
        const bar = await boxOf(tabs);
        expect({x: header.x, width: header.width}).toEqual({x: 0, width});
        expect({x: bar.x, width: bar.width}).toEqual({x: 0, width});
        // The page title starts 16px in, and every header action and tab is a full tap target.
        expect(title.x).toBe(16);
        expect.soft(await smallTargets(page, '[data-testid="app-phone-header"]')).toEqual([]);
        expect.soft(await smallTargets(page, '[data-testid="app-tab-bar"]')).toEqual([]);
        // Each badge stays inside its own tab, on one line.
        for (const label of [/^Transactions, /, ...(data.bankProblem ? [/^Accounts, /] : [])]) {
          const tab = tabs.getByRole('link', {name: label});
          expect.soft(await outside(tab, 'span, i'), String(label)).toEqual([]);
        }
        expect.soft((await boxOf(tabs.getByText(badgeText, {exact: true}))).height).toBe(18);
      }
    });
  }
}

/**
 * Worst-case Insights: the worst-case history with spending in many more categories (one only ever refunded), so the
 * money flow merges many small ones and the list runs long, and a rail of top merchants with a long legal name, an
 * unbroken one, a two-letter one, a count of 1 and of 1,284, and bills in the millions; all synthetic.
 */
function worstInsights() {
  const base = worstCase();
  const extra = [
    'HOME_IMPROVEMENT',
    'EATING_OUT',
    'PERSONAL_CARE',
    'EDUCATION',
    'GIFTS_AND_DONATIONS',
    'FEES',
    'INSURANCE',
    'TAXES_AND_GOVERNMENT',
    'LOANS_AND_DEBT',
    'SERVICES',
    'CASH_WITHDRAWAL',
    'UNCATEGORIZED',
  ];
  const amountsOf = (periods: typeof base.breakdown.month.category, month: string) =>
    Object.fromEntries(
      (periods.find((period) => period.start.startsWith(month))?.parts ?? []).map((part) => [
        part.key,
        Number(part.amount),
      ]),
    );
  return homeHistory({
    spending: (month) => {
      const amounts = amountsOf(base.breakdown.month.category, month);
      extra.forEach((key, index) => (amounts[key] = (index + 1) * 7 * SCALE));
      amounts.ENTERTAINMENT = -15;
      return amounts;
    },
    income: (month) => amountsOf(base.breakdown.month.source, month),
    sourceLabels: Object.fromEntries(
      base.breakdown.month.source[0].parts.map((part) => [part.key, part.label]),
    ),
    firstMonth: FIRST_MONTH,
  });
}

const insightsMerchant = (id: string, name: string, spent: string, count: number) => ({
  id,
  name,
  kind: 'MERCHANT' as const,
  logoUrl: null,
  spent,
  received: '0.00',
  count,
  lastDate: '2026-11-01',
});

const insightsData = {
  demo: {
    history: homeHistory,
    bills: '1250.00',
    merchants: [
      insightsMerchant(MARKET_ID, 'Example Market', '500.00', 9),
      insightsMerchant(`k_${'e5'.repeat(16)}`, 'Example Landlord', '1200.00', 1),
    ],
  },
  'worst-case': {
    history: worstInsights,
    bills: '1234567.89',
    merchants: [
      insightsMerchant(
        MARKET_ID,
        'Example Długoszewska-Przykładowa Catering & Events International Holdings',
        '123456789.01',
        1,
      ),
      insightsMerchant(
        `k_${'a7'.repeat(16)}`,
        'ExampleSuperLongMerchantNameWithoutAnySpacesAtAllBV',
        '9876543.21',
        1284,
      ),
      insightsMerchant(`k_${'b8'.repeat(16)}`, 'Jo', '0.01', 1),
      insightsMerchant(`k_${'c9'.repeat(16)}`, 'Example Landlord', '1200.00', 12),
      insightsMerchant(`k_${'d0'.repeat(16)}`, 'Example Market', '500.00', 9),
    ],
  },
};

for (const [name, data] of Object.entries(insightsData)) {
  for (const {width, theme} of [
    {width: 1440, theme: 'light'},
    {width: 1440, theme: 'dark'},
    {width: 1024, theme: 'light'},
    {width: 390, theme: 'light'},
    {width: 390, theme: 'dark'},
    {width: 320, theme: 'dark'},
  ] as const) {
    test(`Insights fits ${name} data at ${width}px in ${theme}`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 1000});
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      await mockSyntheticHome(page, {history: data.history()});
      const recurring = homeRecurring().summary;
      await page.route('**/recurring-series/summary?**', (route) =>
        fulfillJson(route, {...recurring, expenseMonthlyTotal: data.bills}),
      );
      await page.route('**/merchants?**', (route) =>
        fulfillJson(route, {
          baseCurrency: 'EUR',
          merchants: data.merchants,
          total: data.merchants.length,
        }),
      );
      const market = data.merchants[0];
      await page.route(`**/merchants/${MARKET_ID}`, (route) =>
        fulfillJson(route, {
          ...market,
          lastDate: '2026-10-28',
          baseCurrency: 'EUR',
          paid: market.spent,
          refunded: '0.00',
          paymentCount: market.count,
          averagePayment: market.spent,
          firstDate: '2025-01-02',
          excluded: {missingBaseAmount: 0},
          variants: [],
        }),
      );
      await page.route(`**/merchants/${MARKET_ID}/periods?**`, (route) =>
        fulfillJson(route, {baseCurrency: 'EUR', interval: 'month', periods: []}),
      );
      await page.route('**/bank-transactions?**', (route) =>
        fulfillJson(route, {...monthTransactions('2026-10', 5), total: 5}),
      );
      const capture = async (view: string) => {
        if (!process.env.HOME_POLISH_CAPTURE_DIR) return;
        await mkdir(process.env.HOME_POLISH_CAPTURE_DIR, {recursive: true});
        await page.screenshot({
          path: join(process.env.HOME_POLISH_CAPTURE_DIR, `${view}-${name}-${theme}-${width}.png`),
          fullPage: width >= 768,
        });
      };
      const flow = page.getByRole('region', {name: 'Where the money went'});
      const rail = page.getByRole('complementary', {name: 'Insights rail'});
      const top = rail.getByRole('region', {name: 'Top merchants'});

      for (const period of ['12m', 'all']) {
        await page.goto(period === 'all' ? '/insights?period=all' : '/insights');
        await expect(
          page.getByRole('region', {name: 'Categories'}).getByRole('link').first(),
        ).toBeVisible();
        await expect(top.getByRole('button', {name: /Example/}).first()).toBeVisible();
        await expectLoaded(page);
        await page.evaluate(() => document.fonts.ready);
        await capture(`insights-${period}`);
        await expectNoHorizontalOverflow(page);
        expect.soft(await brokenAmounts(page)).toEqual([]);
        if (width < 640) expect.soft(await smallTargets(page, 'main')).toEqual([]);
        // The diagram on wider screens; on a phone the money flow is one stacked bar over its legend.
        const sources = await flow.getByTestId('money-flow-source').count();
        if (width < 768) expect(sources).toBe(0);
        else expect(sources).toBeGreaterThan(0);
        await expect(flow.getByRole('list', {name: 'Went to'})).toBeVisible();
        // Every money-flow label and rail row keeps inside its column.
        expect.soft(await outside(flow, 'li span')).toEqual([]);
        expect.soft(await outside(rail, 'button, a, span')).toEqual([]);
        const main = await boxOf(page.getByRole('region', {name: 'Cash flow'}));
        const side = await boxOf(rail);
        // From 1280px the rail stands beside the page; narrower, it follows it.
        if (width >= 1280) expect(side.x).toBeGreaterThan(main.x + main.width);
        else expect(side.y).toBeGreaterThan(main.y + main.height);
      }

      // A merchant's details: in the rail beside the page, in a sheet narrower.
      await top
        .getByRole('button', {name: /Example/})
        .first()
        .click();
      const details =
        width >= 1280
          ? page.getByRole('complementary', {name: 'Merchant'})
          : page.getByRole('dialog', {name: 'Merchant'});
      await expect(details.getByText('Spent all time')).toBeVisible();
      await expectLoaded(details);
      await capture('insights-merchant');
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      expect.soft(await outside(details, 'button, a, h2, dd')).toEqual([]);

      // A category's page, by month and (over the whole history) by year, with the longest category name.
      for (const period of ['12m', 'all']) {
        await page.goto(
          `/insights/categories/HOUSING_AND_UTILITIES${period === 'all' ? '?period=all' : ''}`,
        );
        const spending = page.getByRole('region', {name: 'Spending'});
        const merchants = page.getByRole('region', {name: 'Top merchants'});
        const transactions = page.getByRole('region', {name: 'Transactions'});
        await expect(spending.getByRole('list', {name: /^Spent per/})).toBeVisible();
        await expect(merchants.getByRole('button', {name: /Example/}).first()).toBeVisible();
        await expect(transactions.getByRole('listitem').first()).toBeVisible();
        await expectLoaded(page);
        await capture(`insights-category-${period}`);
        await expectNoHorizontalOverflow(page);
        expect.soft(await brokenAmounts(page)).toEqual([]);
        if (width < 640) expect.soft(await smallTargets(page, 'main')).toEqual([]);
        expect.soft(await outside(spending, 'dd, li, span')).toEqual([]);
        expect.soft(await outside(merchants, 'button, span')).toEqual([]);
        // Transaction rows keep the shared row height.
        const rowHeights = await transactions
          .getByRole('listitem')
          .evaluateAll((rows) => rows.map((row) => row.clientHeight));
        expect.soft([...new Set(rowHeights)]).toEqual([60]);
        const main = await boxOf(spending);
        const side = await boxOf(page.getByRole('complementary', {name: 'Category rail'}));
        if (width >= 1280) expect(side.x).toBeGreaterThan(main.x + main.width);
        else expect(side.y).toBeGreaterThan(main.y + main.height);
      }
      expect(errors).toEqual([]);
    });
  }
}
