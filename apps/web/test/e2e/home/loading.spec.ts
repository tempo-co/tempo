import type {Page} from '@playwright/test';

import {
  EMPLOYER_LOGO,
  homeHistory,
  homeRecurring,
  mockSourceLogo,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Layout shifts as the browser reports them, with the elements that moved. Chromium only. */
type Shift = {
  value: number;
  time: number;
  sources: {node: string; region: string | null; from: number[]; to: number[]}[];
};

declare global {
  interface Window {
    __shifts: Shift[];
  }
}

/** Records every layout shift not caused by input from the first paint on. */
async function recordShifts(page: Page) {
  await page.addInitScript(() => {
    window.__shifts = [];
    const describe = (node: Node | null) => {
      if (!(node instanceof Element)) return node?.nodeName ?? 'unknown';
      const label = node.getAttribute('aria-label');
      const classes = (node.getAttribute('class') ?? '').slice(0, 60);
      return `${node.tagName.toLowerCase()}${label ? `[${label}]` : ''}${classes ? `.${classes}` : ''}`;
    };
    const rect = (r: DOMRectReadOnly) => [r.x, r.y, r.width, r.height].map(Math.round);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        startTime: number;
        hadRecentInput: boolean;
        sources: {node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly}[];
      }[]) {
        if (entry.hadRecentInput) continue;
        window.__shifts.push({
          value: entry.value,
          time: Math.round(entry.startTime),
          sources: entry.sources.map((source) => ({
            node: describe(source.node),
            region:
              source.node instanceof Element
                ? (source.node.closest('[role="region"]')?.getAttribute('aria-label') ?? null)
                : null,
            from: rect(source.previousRect),
            to: rect(source.currentRect),
          })),
        });
      }
    }).observe({type: 'layout-shift', buffered: true});
  });
}

/** When each of Home's answers arrives after it is asked for, in the order a real load tends to finish. */
const STAGGER: [string, number][] = [
  ['**/bank-connections', 150],
  ['**/bank-transactions/spending-pace?**', 400],
  ['**/bank-connections/coverage?**', 600],
  ['**/bank-transactions/balance-trend?**', 450],
  ['**/bank-transactions/cash-flow?**', 500],
  ['**/bank-transactions/breakdown?**', 800],
  ['**/recurring-series/summary?**', 1100],
  ['**/bank-transactions/review-counts', 1400],
  // A month's transactions and biggest merchants, on the month page.
  ['**/bank-transactions?**', 1200],
  ['**/merchants/ranking?**', 1300],
  // The running month's usual by this day.
  ['**/bank-transactions/summary?**', 1350],
  [`**${EMPLOYER_LOGO}/mask-v3`, 1700],
];

/** Holds each answer of {@link STAGGER} for its delay, then lets the synthetic mock answer it. */
async function staggerHome(page: Page) {
  for (const [url, delay] of STAGGER)
    await page.route(url, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      await route.fallback();
    });
}

/** A Home with logos on the income source and the next payment, so their images load last. */
async function mockLoadingHome(page: Page) {
  await mockSyntheticHome(page, {history: homeHistory({sourceLogos: true})});
  await mockSourceLogo(page);
  const recurring = homeRecurring();
  recurring.summary.upcoming = recurring.summary.upcoming.map((payment) => ({
    ...payment,
    merchantLogoUrl: EMPLOYER_LOGO,
  }));
  await page.route('**/recurring-series/summary?**', (route) =>
    fulfillJson(route, recurring.summary),
  );
}

/** The shifts once every answer is in and a second has passed, attached to the report. */
async function settledShifts(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  const shifts = await page.evaluate(() => window.__shifts);
  await test.info().attach('layout-shifts', {
    body: JSON.stringify(shifts, null, 2),
    contentType: 'application/json',
  });
  const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
  return {shifts, total};
}

for (const width of [1440, 390]) {
  test(`at ${width}px, Home loads in place: sections fill their reserved boxes without moving the page`, async ({
    page,
    homePage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Layout shift entries are a Chromium API');
    await page.setViewportSize({width, height: width > 500 ? 900 : 844});
    await recordShifts(page);
    await mockLoadingHome(page);
    await staggerHome(page);

    await page.goto('/');
    await expect(homePage.paceFigure).toHaveText('€1,200');
    await expect(homePage.card('Coming up')).toContainText('Example Landlord');
    await expect(homePage.card('Top categories this month')).toContainText('Housing');
    await expect(homePage.card('To do')).toContainText('Check 3 transactions');

    const {shifts, total} = await settledShifts(page);
    expect(total, JSON.stringify(shifts)).toBeLessThanOrEqual(0.02);
    const paceCard = shifts.filter((shift) =>
      shift.sources.some((source) => source.region === 'Spending pace'),
    );
    for (const shift of paceCard)
      expect(shift.value, JSON.stringify(shift)).toBeLessThanOrEqual(0.005);
  });

  test(`at ${width}px, a month opened from a link loads in place`, async ({
    page,
    homePage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Layout shift entries are a Chromium API');
    await page.setViewportSize({width, height: width > 500 ? 900 : 844});
    await recordShifts(page);
    await mockLoadingHome(page);
    await staggerHome(page);

    await page.goto('/insights/months/2026-10');
    const dialog = homePage.monthPage('October 2026');
    await expect(dialog.getByRole('region', {name: 'The month'})).toContainText('€3,000');
    await expect(
      dialog.getByRole('region', {name: 'Transactions'}).getByRole('listitem'),
    ).not.toHaveCount(0);

    const {shifts, total} = await settledShifts(page);
    expect(total, JSON.stringify(shifts)).toBeLessThanOrEqual(0.02);
  });
}

test('Home shows each card as soon as its own data arrives', async ({page, homePage}) => {
  await mockLoadingHome(page);
  const held: (() => void)[] = [];
  for (const url of ['**/bank-transactions/breakdown?**', '**/recurring-series/summary?**'])
    await page.route(url, async (route) => {
      await new Promise<void>((resolve) => held.push(resolve));
      await route.fallback();
    });

  try {
    await page.goto('/');
    // The pace is in: it shows while this month's categories and what's coming up still load.
    await expect(homePage.paceFigure).toHaveText('€1,200');
    for (const [name, loading] of [
      ['Top categories this month', 'Loading this month’s categories'],
      ['Coming up', 'Loading what’s coming up'],
    ]) {
      const card = homePage.card(name).locator('[aria-busy="true"]');
      await expect(card).toContainText(loading);
    }
    await expect.poll(() => held.length).toBe(2);
  } finally {
    held.forEach((release) => release());
  }

  await expect(homePage.card('Top categories this month')).toContainText('Housing');
  await expect(homePage.card('Coming up')).toContainText('Example Landlord');
});

test('the running month asks for its transactions once, up to today, while the rest of the month loads', async ({
  page,
  homePage,
}) => {
  await mockLoadingHome(page);
  const asked: string[] = [];
  await page.route('**/bank-transactions?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('filter[date][from]'))
      asked.push(`${params.get('filter[date][from]')}..${params.get('filter[date][to]')}`);
    await route.fallback();
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/bank-transactions/balance-trend?**', async (route) => {
    await held;
    await route.fallback();
  });

  try {
    await page.goto('/insights/months/2026-11');
    const dialog = homePage.monthPage('November 2026');
    const transactions = dialog.getByRole('region', {name: 'Transactions'});
    // The transactions are in before the month's figures.
    await expect(transactions.getByRole('listitem').first()).toBeVisible();
    await expect(dialog.getByRole('region', {name: 'The month'})).toHaveAttribute(
      'aria-busy',
      'true',
    );
  } finally {
    release();
  }
  await expect(
    homePage.monthPage('November 2026').getByRole('region', {name: 'The month'}),
  ).toContainText('Kept so far');
  await expect(
    homePage.monthPage('November 2026').getByRole('region', {name: 'The month'}),
  ).not.toHaveAttribute('aria-busy');
  expect(asked).toEqual(['2026-11-01..2026-11-05']);
});

test('when this month’s categories fail, the other cards stay and Try again fills the card in', async ({
  page,
  homePage,
}) => {
  await mockLoadingHome(page);
  let failing = true;
  await page.route('**/bank-transactions/breakdown?**', (route) =>
    failing ? fulfillJson(route, {message: 'Too Many Requests'}, 429) : route.fallback(),
  );
  await page.goto('/');

  const categories = homePage.card('Top categories this month');
  await expect(categories).toContainText("Couldn't load this month's categories");
  await expect(homePage.paceFigure).toHaveText('€1,200');
  await expect(homePage.accountsTotal).toHaveText('€24,300.00');

  failing = false;
  await categories.getByRole('button', {name: 'Try again'}).click();
  await expect(categories).toContainText('Housing');
  await expect(categories).not.toContainText("Couldn't load");
});
