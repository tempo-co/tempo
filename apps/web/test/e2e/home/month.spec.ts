import {
  MARKET_ID,
  homeHistory,
  mockSourceLogo,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {boxOf, expectCategoryIcon, expectSourceTile} from '../../utils/layout';

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
  await page.goto('/?month=2026-03');

  const dialog = homePage.monthDialog('March 2026');
  const figures = dialog.getByRole('region', {name: 'The month'});
  await expect(figures).toHaveText(
    'In€3,000Out€3,500Kept−€500−17% of inBalance at month end€18,500−€500 on Feb',
  );

  const went = dialog.getByRole('region', {name: 'Where it went'});
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

  const came = dialog.getByRole('region', {name: 'Where it came from'});
  await expect(came.getByRole('link')).toHaveText(['Example Employer€3,000']);
  await expectSourceTile(came, 'Example Employer', 'logo');

  // A page of 20, then one more each press until the 45 are in; the button spans the list.
  const transactions = dialog.getByRole('region', {name: 'Transactions'});
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
    /bookingDate=/,
  );
});

test('a month without a full year of history before it has no usual', async ({page, homePage}) => {
  await mockSyntheticHome(page, {history: homeHistory({sourceLogos: true})});
  await mockSourceLogo(page);
  await page.goto('/?month=2025-06');

  const dialog = homePage.monthDialog('June 2025');
  await expect(dialog.getByRole('region', {name: 'The month'})).toContainText('Kept+€5,000');
  const went = dialog.getByRole('region', {name: 'Where it went'});
  await expect(went.getByRole('link').first()).toHaveText('Housing and utilities€1,200');
  await expect(went).not.toContainText('usual');
  const came = dialog.getByRole('region', {name: 'Where it came from'});
  await expect(came.getByRole('link')).toHaveText([
    'Example Bonus€4,000',
    'Example Employer€3,000',
  ]);
  // A source without a logo shows its income's category icon in the tile.
  await expectSourceTile(came, 'Example Bonus', 'icon');
  await expectSourceTile(came, 'Example Employer', 'logo');
});

test('the running month reads as so far', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-11');

  const dialog = homePage.monthDialog('November 2026');
  await expect(dialog.getByRole('region', {name: 'The month'})).toHaveText(
    'In€0Out€1,200Kept so far−€1,200Balance now€24,300−€1,200 on Oct',
  );
  await expect(dialog.getByRole('region', {name: 'Where it came from'})).toContainText(
    'No income.',
  );
  await expect(dialog.getByRole('button', {name: 'Next month'})).toBeDisabled();
});

test('arrows step through months in place, and Back returns to Home', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await page.goto('/?month=2025-01');
  const length = await page.evaluate(() => history.length);

  await expect(homePage.monthDialog('January 2025')).toBeVisible();
  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(page).toHaveURL(/[?&]month=2024-12/);
  await expect(homePage.monthDialog('December 2024')).toBeVisible();
  // The first month of history has nothing before it.
  await expect(page.getByRole('button', {name: 'Previous month'})).toBeDisabled();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/[?&]month=2025-02/);
  await expect(homePage.monthDialog('February 2025')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(homePage.totalBalance).toHaveText('€24,300');
});

test('Escape and the close button leave the month', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await homePage.yearTable.getByRole('link', {name: 'October'}).click();
  const dialog = homePage.monthDialog('October 2026');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL('/');

  await homePage.yearTable.getByRole('link', {name: 'September'}).click();
  await page.getByRole('button', {name: 'Close the month'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('a merchant opens its page in Merchants', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  // The merchant's own page is not part of this check; answer it without reaching an API.
  await page.route(`**/merchants/${MARKET_ID}**`, (route) =>
    fulfillJson(route, {message: 'Merchant not found.'}, 404),
  );
  await page.route('**/merchants?**', (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', merchants: [], total: 0}),
  );
  await page.goto('/?month=2026-10');

  const merchants = homePage
    .monthDialog('October 2026')
    .getByRole('region', {name: 'Biggest merchants'});
  await expect(merchants.getByRole('button')).toHaveCount(2);
  await merchants.getByRole('button', {name: /Example Market/}).click();
  await expect(page).toHaveURL(new RegExp(`merchants=open.*merchant=${MARKET_ID}`));
});

test('a month outside the history says so', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2019-04');
  await expect(homePage.monthDialog('April 2019')).toContainText('No history for April 2019.');
});

test('an invalid month is ignored', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-13');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
    await page.goto('/?month=2025-01');
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
      const dialog = homePage.monthDialog(`${month} 2025`);
      const title = dialog.getByRole('heading', {name: `${month} 2025`});
      await expect(title).toBeVisible();
      // The longest month fits on one line beside both arrows and the close button.
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
    const close = await boxOf(page.getByRole('button', {name: 'Close the month'}));
    expect(places[0].right + 44).toBeLessThanOrEqual(close.x);
  });
}

for (const width of [1440, 390]) {
  test(`the month's hover rows keep their text on the section's edge at ${width}px`, async ({
    page,
    homePage,
  }) => {
    await page.setViewportSize({width, height: 900});
    await mockSyntheticHome(page);
    await page.goto('/?month=2026-03');
    const dialog = homePage.monthDialog('March 2026');
    for (const name of ['Where it went', 'Where it came from']) {
      const section = dialog.getByRole('region', {name});
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

test.describe('on a phone', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true});

  test('the month is a near full-height drawer without sideways scrolling', async ({
    page,
    homePage,
  }) => {
    await mockSyntheticHome(page);
    await page.goto('/?month=2026-03');
    const dialog = homePage.monthDialog('March 2026');
    await expect(dialog.getByRole('region', {name: 'Where it went'})).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.height).toBeGreaterThan(844 * 0.9);
    const overflow = await dialog.evaluate((element) =>
      Array.from(element.querySelectorAll('section')).some(
        (section) => section.scrollWidth > section.clientWidth + 1,
      ),
    );
    expect(overflow).toBe(false);
  });
});
