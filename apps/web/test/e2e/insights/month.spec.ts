import type {Route} from '@playwright/test';

import {
  EMPLOYER,
  FLIGHT,
  MARKET_ID,
  USUAL_SPENDING,
  homeHistory,
  mockSourceLogo,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {expectFailedPageRetried, failLaterPages, fulfillJson} from '../../utils/api-mocks';
import {boxOf, expectCategoryIcon, expectLoaded, expectSourceTile} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

test('a month shows its money, where it went against the usual, where it came from and its transactions a page at a time', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page, {
    history: homeHistory({sourceLogos: true}),
    transactionsPerMonth: 45,
  });
  await mockSourceLogo(page);
  await page.goto('/insights/months/2026-03');

  const view = homePage.monthPage('March 2026');
  const figures = view.getByRole('region', {name: 'The month'});
  await expect(figures).toHaveText(
    'In€3,000Out€3,500Kept−€500−17% of inBalance at month end€18,500−€500 on Feb',
  );

  const went = view.getByRole('region', {name: 'Where it went'});
  await expect(went).toContainText('usual, last 12 months');
  const categories = went.getByRole('link');
  await expect(categories).toHaveCount(7);
  await expect(categories.nth(0)).toHaveText('Travel€1,500none usually');
  await expect(categories.nth(1)).toHaveText('Housing and utilities€1,2000% on usual');
  expect(decodeURIComponent((await categories.nth(0).getAttribute('href')) ?? '')).toContain(
    'categories=["TRAVEL"]',
  );
  await expectCategoryIcon(categories.nth(1), 'Housing and utilities');
  // The usual is a foreground line over a quieter, differently coloured bar, reaching past it above and below,
  // with the same line in the legend.
  const bar = categories.nth(1).locator('[data-mark="amount"]');
  const usual = categories.nth(1).locator('[data-mark="usual"]');
  const fill = (mark: typeof bar) => mark.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await fill(usual)).not.toBe(await fill(bar));
  const [barBox, usualBox] = await Promise.all([boxOf(bar), boxOf(usual)]);
  expect(usualBox.width).toBe(2);
  expect(usualBox.y).toBeLessThan(barBox.y);
  expect(usualBox.y + usualBox.height).toBeGreaterThan(barBox.y + barBox.height);
  const swatch = went.locator('header i');
  expect(await fill(swatch)).toBe(await fill(usual));
  expect((await boxOf(swatch)).width).toBe(2);

  const came = view.getByRole('region', {name: 'Where it came from'});
  await expect(came.getByRole('link')).toHaveText(['Example Employer€3,000']);
  await expectSourceTile(came, 'Example Employer', 'logo');
  // A source opens its rows by the key the breakdown groups them by, whatever their names.
  const drill = new URL((await came.getByRole('link').getAttribute('href'))!, page.url())
    .searchParams;
  expect(drill.get('incomeSource')).toBe(EMPLOYER);
  expect(JSON.parse(drill.get('cashFlows')!)).toEqual(['INCOME']);

  // A page of 20, then one more each press until the 45 are in; the button spans the list.
  const transactions = view.getByRole('region', {name: 'Transactions'});
  const rows = transactions.getByRole('listitem');
  const more = transactions.getByRole('button', {name: 'Load more'});
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText('Example Shop 1');
  expect((await boxOf(more)).width).toBe((await boxOf(transactions.getByRole('list'))).width);
  await more.click();
  await expect(rows).toHaveCount(40);
  await expect(rows.nth(20)).toContainText('Example Shop 21');
  await more.click();
  await expect(rows).toHaveCount(45);
  await expect(more).toHaveCount(0);
  await expect(transactions.getByRole('link', {name: 'Open in Transactions'})).toHaveAttribute(
    'href',
    /[?&]date=/,
  );
});

test('a later page of the month’s transactions that fails keeps the loaded ones and tries that page again', async ({
  page,
  homePage,
}) => {
  // The failed page is retried by the query client before Load more reports it.
  test.slow();
  await mockSyntheticHome(page, {transactionsPerMonth: 45});
  const later = await failLaterPages(page, '**/bank-transactions?**', (params) => {
    const index = params.get('pagination[pageIndex]');
    return params.has('filter[date][from]') && index && index !== '0' ? index : null;
  });
  await page.goto('/insights/months/2026-03');

  const transactions = homePage.monthPage('March 2026').getByRole('region', {name: 'Transactions'});
  await expectFailedPageRetried(transactions, transactions.getByRole('listitem'), later, {
    loaded: 20,
    after: 40,
  });
  await expect(transactions.getByRole('listitem').nth(20)).toContainText('Example Shop 21');
  await expect(transactions.getByRole('button', {name: 'Load more'})).toBeVisible();
});

test('a refresh that fails keeps the loaded month, its parts and its merchants', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page, {clock: 'installed'});
  await page.goto('/insights/months/2026-03');
  const view = homePage.monthPage('March 2026');
  const figures = view.getByRole('region', {name: 'The month'});
  const went = view.getByRole('region', {name: 'Where it went'}).getByRole('link');
  const came = view.getByRole('region', {name: 'Where it came from'}).getByRole('link');
  const merchants = view.getByRole('region', {name: 'Biggest merchants'});
  await expect(figures).toContainText('In€3,000');
  await expect(went.first()).toHaveText('Travel€1,500none usually');
  await expect(came).toHaveText(['Example Employer€3,000']);
  await expect(merchants).toContainText('Example Landlord');

  // The next refresh of the parts and the merchants is rate limited, which is final.
  const failed = new Set<string>();
  const limited = (route: Route) => {
    const url = new URL(route.request().url());
    failed.add(
      url.pathname.endsWith('/breakdown') ? `by=${url.searchParams.get('by')}` : 'merchants',
    );
    return fulfillJson(route, {statusCode: 429, message: 'Too Many Requests'}, 429);
  };
  await page.route('**/bank-transactions/breakdown?**', limited);
  await page.route('**/merchants/ranking?**', limited);
  await page.clock.runFor(31_000);
  await expect.poll(() => [...failed].sort()).toEqual(['by=category', 'by=source', 'merchants']);

  await expect(figures).toContainText('In€3,000');
  await expect(went.first()).toHaveText('Travel€1,500none usually');
  await expect(came).toHaveText(['Example Employer€3,000']);
  await expect(merchants).toContainText('Example Landlord');
  await expect(view.getByText(/Couldn't load/)).toHaveCount(0);
});

test('a month without a full year of history before it has no usual', async ({page, homePage}) => {
  await mockSyntheticHome(page, {history: homeHistory({sourceLogos: true})});
  await mockSourceLogo(page);
  await page.goto('/insights/months/2025-06');

  const view = homePage.monthPage('June 2025');
  await expect(view.getByRole('region', {name: 'The month'})).toContainText('Kept+€5,000');
  const went = view.getByRole('region', {name: 'Where it went'});
  await expect(went.getByRole('link').first()).toHaveText('Housing and utilities€1,200');
  await expect(went).not.toContainText('usual');
  const came = view.getByRole('region', {name: 'Where it came from'});
  await expect(came.getByRole('link')).toHaveText([
    'Example Bonus€4,000',
    'Example Employer€3,000',
  ]);
  // A source without a logo shows its income's category icon in the tile.
  await expectSourceTile(came, 'Example Bonus', 'icon');
  await expectSourceTile(came, 'Example Employer', 'logo');
});

test('the running month reads as so far, against the usual by this day of the month', async ({
  page,
  homePage,
}) => {
  // Five days in, the rent and €100 of food are paid; food usually lands mid-month.
  const history = homeHistory({
    spending: (month) =>
      month === '2026-11'
        ? {HOUSING_AND_UTILITIES: 1200, GROCERIES: 100}
        : month === FLIGHT.month
          ? {...USUAL_SPENDING, TRAVEL: FLIGHT.amount}
          : {...USUAL_SPENDING},
  });
  await mockSyntheticHome(page, {history});
  await page.goto('/insights/months/2026-11');

  const view = homePage.monthPage('November 2026');
  await expect(view.getByRole('region', {name: 'The month'})).toHaveText(
    'In€0Out€1,300Kept so far−€1,300Balance now€24,200−€1,300 on Oct',
  );
  const went = view.getByRole('region', {name: 'Where it went'});
  await expect(went).toContainText('usual by this day, last 3 months');
  await expect(went.getByRole('link')).toHaveText([
    'Housing and utilities€1,2000% on usual',
    'Groceries€100none usually',
  ]);
  await expect(view.getByRole('region', {name: 'Where it came from'})).toContainText('No income.');
  await expect(view.getByRole('button', {name: 'Next month'})).toBeDisabled();
});

test('arrows step through months in place, and Back returns to where the month was opened', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await page.goto('/insights/months/2025-01');
  const length = await page.evaluate(() => history.length);

  await expect(homePage.monthPage('January 2025')).toBeVisible();
  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(page).toHaveURL(/\/insights\/months\/2024-12$/);
  await expect(homePage.monthPage('December 2024')).toBeVisible();
  // The first month of history has nothing before it.
  await expect(page.getByRole('button', {name: 'Previous month'})).toBeDisabled();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/insights\/months\/2025-02$/);
  await expect(homePage.monthPage('February 2025')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(homePage.totalBalance).toHaveText('€24,300');
});

test('a month opened from Home goes back to Insights over the same period', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await homePage.yearTable.getByRole('link', {name: 'October'}).click();
  await expect(page).toHaveURL('/insights/months/2026-10');
  await expect(homePage.monthPage('October 2026')).toBeVisible();
  await page.getByRole('main').getByRole('link', {name: 'Insights', exact: true}).click();
  await expect(page).toHaveURL('/insights');

  await page.goto('/insights/months/2026-09?period=6m');
  await expect(homePage.monthPage('September 2026')).toBeVisible();
  await page.getByRole('button', {name: 'Next month'}).click();
  await expect(page).toHaveURL('/insights/months/2026-10?period=6m');
  await homePage
    .monthPage('October 2026')
    .getByRole('link', {name: 'Insights', exact: true})
    .click();
  await expect(page).toHaveURL('/insights?period=6m');
  await expect(page.getByRole('radio', {name: '6 months'})).toBeChecked();
});

test('a link to a month over Home opens the month’s page', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-03');
  await expect(page).toHaveURL('/insights/months/2026-03');
  await expect(
    homePage.monthPage('March 2026').getByRole('region', {name: 'The month'}),
  ).toContainText('In€3,000');
});

test('a merchant opens its details in Insights', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  // The merchant's own page is not part of this check; answer it without reaching an API.
  await page.route(`**/merchants/${MARKET_ID}**`, (route) =>
    fulfillJson(route, {message: 'Merchant not found.'}, 404),
  );
  await page.route('**/merchants?**', (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', merchants: [], total: 0}),
  );
  await page.goto('/insights/months/2026-10');

  const merchants = homePage
    .monthPage('October 2026')
    .getByRole('region', {name: 'Biggest merchants'});
  await expect(merchants.getByRole('button')).toHaveCount(2);
  await merchants.getByRole('button', {name: /Example Market/}).click();
  await expect(page).toHaveURL(new RegExp(`/insights\\?merchant=${MARKET_ID}$`));
});

test('a month outside the history says so', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/insights/months/2019-04');
  await expect(homePage.monthPage('April 2019')).toContainText('No history for April 2019.');
});

test('an address with an invalid month opens Insights over its period', async ({page}) => {
  await mockSyntheticHome(page);
  await page.goto('/insights/months/2026-13?period=2025');
  await expect(page).toHaveURL('/insights?period=2025');
  await expect(page.getByRole('radio', {name: '2025'})).toBeChecked();
});

for (const width of [1440, 390, 320]) {
  test(`the month arrows stay put while stepping through a year at ${width}px`, async ({
    page,
    homePage,
  }) => {
    // Twelve months, each checked in place.
    test.slow();
    await page.setViewportSize({width, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/insights/months/2025-01');
    const prev = page.getByRole('button', {name: 'Previous month'});
    const next = page.getByRole('button', {name: 'Next month'});
    const places = [];
    for (const month of [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ]) {
      const view = homePage.monthPage(`${month} 2025`);
      const title = view.getByRole('heading', {name: `${month} 2025`});
      await expect(title).toBeVisible();
      // The longest month fits on one line between both arrows.
      expect(
        await title.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return {lines: range.getClientRects().length, fits: el.scrollWidth <= el.clientWidth};
        }),
      ).toEqual({lines: 1, fits: true});
      const [left, right, slot] = await Promise.all([boxOf(prev), boxOf(next), boxOf(title)]);
      places.push({left: left.x, right: right.x, slot: slot.width});
      if (month !== 'December') await next.click();
    }
    for (const place of places) {
      expect(Math.abs(place.left - places[0].left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(place.right - places[0].right)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(place.slot - places[0].slot)).toBeLessThanOrEqual(0.5);
    }
  });
}

for (const width of [1440, 390]) {
  test(`the month's hover rows keep their text on the section's edge at ${width}px`, async ({
    page,
    homePage,
  }) => {
    await page.setViewportSize({width, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/insights/months/2026-03');
    const view = homePage.monthPage('March 2026');
    await expectLoaded(view);
    for (const name of ['Where it went', 'Where it came from']) {
      const section = view.getByRole('region', {name});
      const heading = await boxOf(section.getByRole('heading'));
      const rows = section.getByRole('link');
      await expect(rows.first()).toBeVisible();
      for (const row of await rows.all()) {
        const [box, text] = await Promise.all([
          boxOf(row),
          row.evaluate((el) => {
            const shown = Array.from(el.children)
              .map((child) => child.getBoundingClientRect())
              .filter((rect) => rect.width > 0);
            return {
              left: Math.min(...shown.map((rect) => rect.left)),
              right: Math.max(...shown.map((rect) => rect.right)),
            };
          }),
        ]);
        expect(Math.abs(text.left - heading.x), `${name} text edge`).toBeLessThanOrEqual(1);
        expect(text.left - box.x, `${name} left inset`).toBeGreaterThanOrEqual(6);
        expect(box.x + box.width - text.right, `${name} right inset`).toBeGreaterThanOrEqual(6);
      }
    }
  });
}
