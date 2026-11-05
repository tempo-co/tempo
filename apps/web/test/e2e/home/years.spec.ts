import type {Locator} from '@playwright/test';

import {
  EMPLOYER,
  homeHistory,
  mockSourceLogo,
  mockSyntheticHome,
} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {
  boxOf,
  expectCategoryIcon,
  expectNoHorizontalOverflow,
  expectSourceTile,
} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** Where the text in each of a row's cells starts and ends, in px; a cell without text has nulls. */
const textEdges = (row: Locator) =>
  row.locator('th, td').evaluateAll((cells) =>
    cells.map((cell) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const boxes: DOMRect[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        boxes.push(...Array.from(range.getClientRects()).filter((box) => box.width > 0));
      }
      if (boxes.length === 0) return {left: null, right: null};
      return {
        left: Math.min(...boxes.map((box) => box.left)),
        right: Math.max(...boxes.map((box) => box.right)),
      };
    }),
  );

/** A table row's cells as one line of text each, once the row is on screen. */
async function cells(row: Locator) {
  await expect(row).toBeVisible();
  const texts = await row.locator('th, td').allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, ' ').trim());
}

test('year by year shows each year, newest first and open; a click anywhere on a year opens it', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const table = homePage.yearTable;
  const years = table
    .getByRole('button', {expanded: true})
    .or(table.getByRole('button', {expanded: false}));
  await expect(years).toHaveText(['2026so far', '2025', '2024']);
  await expect(years.nth(0)).toHaveAttribute('aria-expanded', 'true');
  expect(await cells(table.getByRole('row').nth(1))).toEqual([
    '2026 so far',
    '€30,000',
    '€22,700',
    '+€7,300 24% of in',
    '€24,300 +€7,300',
  ]);
  // The open year lists its months, newest first.
  const months = table.getByRole('link', {name: /^[A-Z][a-z]+$/});
  await expect(months).toHaveText([
    'November',
    'October',
    'September',
    'August',
    'July',
    'June',
    'May',
    'April',
    'March',
    'February',
    'January',
  ]);

  // The whole row is the control: a click on its balance closes it, with a hover state on every cell.
  const current = table.getByRole('row').nth(1);
  const balance = current.getByRole('cell').last();
  const idle = await current.evaluate((row) => getComputedStyle(row).backgroundColor);
  await balance.hover();
  await expect(current).not.toHaveCSS('background-color', idle);
  await balance.click();
  await expect(years.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(months).toHaveCount(0);
  // From the keyboard, the year's button opens it, and the focused row is outlined.
  await years.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(years.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(current).toHaveCSS('outline-style', 'solid');
  await expect(months).toHaveCount(11);
  await years.nth(0).click();
  await expect(months).toHaveCount(0);
  await years.nth(1).click();
  expect(await cells(table.getByRole('row').nth(2))).toEqual([
    '2025',
    '€40,000',
    '€24,000',
    '+€16,000 40% of in',
    '€17,000 +€16,000',
  ]);
  // A month's whole row opens it, with a hover state on every cell; its link opens it from the keyboard.
  const june = table.getByRole('row').filter({has: page.getByRole('link', {name: 'June'})});
  const kept = june.getByRole('cell').nth(3);
  const plain = await june.evaluate((row) => getComputedStyle(row).backgroundColor);
  await kept.hover();
  await expect(june).not.toHaveCSS('background-color', plain);
  await kept.click();
  await expect(page).toHaveURL(/[?&]month=2025-06/);
  await expect(homePage.monthDialog('June 2025')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(homePage.monthDialog('June 2025')).toBeHidden();
  const july = table.getByRole('link', {name: 'July'});
  await july.focus();
  await expect(
    table.getByRole('row').filter({has: page.getByRole('link', {name: 'July'})}),
  ).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]month=2025-07/);
  await expect(homePage.monthDialog('July 2025')).toBeVisible();
});

test('spending by category shows a month on average per year, with small categories folded', async ({
  page,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Spending by category'});
  const rows = table.getByRole('row');
  // Part years say so under the year: history starts in December 2024, and 2026 is still running.
  expect(await cells(rows.nth(0))).toEqual([
    'Category',
    'vs 2025',
    '2026 so far',
    '2025',
    '2024 from Dec',
  ]);
  // 2026 has ten whole months and 5 of November's 30 days: €13,200 of housing is €1,298 a month.
  expect(await cells(rows.nth(1))).toEqual([
    'Housing and utilities',
    '+8%',
    '€1,298',
    '€1,200',
    '€1,200',
  ]);
  expect(await cells(rows.nth(4))).toEqual(['Travel', 'new', '€148', '–', '–']);
  await expectCategoryIcon(rows.nth(1), 'Housing and utilities');
  // Transport, entertainment and health are each under 3% of all spending.
  const more = table.getByRole('button', {name: '3 more categories'});
  expect(await cells(rows.nth(5))).toEqual(['3 more categories', '−2%', '€98', '€100', '€100']);
  expect(await cells(rows.last())).toEqual(['Total', '+12%', '€2,233', '€2,000', '€2,000']);

  // Shading compares a row's years; December 2024 alone is too thin to shade.
  const housing = rows.nth(1).getByRole('link');
  await expect(housing.nth(0)).toHaveAttribute(
    'aria-label',
    'Housing and utilities, 2026: €1,298 a month · €13,200 in the year so far',
  );
  await expect(housing.nth(0)).toHaveCSS('font-weight', '600');
  // A focused cell shows the same as a tip; figures carry no native browser tooltips.
  await housing.nth(0).focus();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Housing and utilities, 2026: €1,298 a month · €13,200 in the year so far',
  );
  await expect(page.getByRole('main').locator('[title]')).toHaveCount(0);
  // So does a figure without a link, such as a year's total.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await rows.last().getByText('€2,233').focus();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Total, 2026: €2,233 a month · €22,700 in the year so far',
  );
  await expect(housing.nth(2)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const search = async (link: Locator) =>
    decodeURIComponent((await link.getAttribute('href')) ?? '');
  expect(await search(housing.nth(0))).toContain('categories=["HOUSING_AND_UTILITIES"]');
  // Each cell opens its year, from the first month of history in the first year.
  expect(await search(housing.nth(0))).toMatch(/"from":"2025-12-31T23:00:00\.000Z"/);
  expect(await search(housing.nth(2))).toMatch(/"from":"2024-11-30T23:00:00\.000Z"/);

  await more.click();
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(5)).toContainText('Transportation');
  await table.getByRole('button', {name: 'Show fewer'}).click();
  await expect(more).toBeVisible();
});

test('on a phone, each category shows its latest year and change, and opens into every year', async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 900});
  await mockSyntheticHome(page);
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Spending by category'});
  await expect(table.getByRole('table')).toBeHidden();
  await expect(table).toContainText('Categoryvs 20252026so far');
  const rows = table.getByRole('button');
  await expect(rows).toHaveText([
    'Housing and utilities+8%€1,298',
    'Food and drink−2%€492',
    'Shopping−2%€197',
    'Travelnew€148',
    '3 more categories',
    'Total+12%€2,233',
  ]);
  await expect(
    table
      .getByRole('listitem')
      .filter({has: page.getByRole('button', {name: '3 more categories'})}),
  ).toHaveText('3 more categories−2%€98');
  for (const row of await rows.all()) expect((await boxOf(row)).height).toBeGreaterThanOrEqual(44);
  await expectCategoryIcon(rows.first(), 'Housing and utilities');

  // A row opens in place into each year, newest first, each opening its transactions.
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  const years = table.getByRole('list', {name: 'Housing and utilities by year'}).getByRole('link');
  await expect(years).toHaveText(['2026so far€1,298', '2025€1,200', '2024from Dec€1,200']);
  await expect(years.first()).toHaveAttribute(
    'aria-label',
    'Housing and utilities, 2026: €1,298 a month · €13,200 in the year so far',
  );
  expect(decodeURIComponent((await years.first().getAttribute('href')) ?? '')).toContain(
    'categories=["HOUSING_AND_UTILITIES"]',
  );
  await rows.first().click();
  await expect(years).toHaveCount(0);

  await table.getByRole('button', {name: /^3 more categories/}).click();
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(4)).toHaveText('Transportation−2%€59');
  await table.getByRole('button', {name: 'Show fewer'}).click();
  await expect(rows).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
});

test('income by source names each source with its logo or icon and lines up with the spending years', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  const history = homeHistory({sourceLogos: true});
  const long = 'Example Employer Holding International Services Group Benelux Payroll Department';
  for (const period of history.breakdown.year.source)
    for (const part of period.parts) if (part.key === EMPLOYER) part.label = long;
  await mockSyntheticHome(page, {history});
  await mockSourceLogo(page);
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Income by source'});
  const rows = table.getByRole('row');
  // A name cut short shows in full on hover; one that fits has no tip.
  await rows.nth(2).getByText('Example Bonus').hover();
  await page.waitForTimeout(500);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await rows.nth(1).getByText(long).hover();
  await expect(page.getByRole('tooltip')).toHaveText(long);
  expect(await cells(rows.nth(1))).toEqual([long, '−2%', '€2,951', '€3,000', '€3,000']);
  expect(await cells(rows.nth(2))).toEqual(['Example Bonus', '−100%', '–', '€333', '–']);
  await expect(rows.nth(1).getByRole('link').first()).toHaveAttribute(
    'href',
    /search=Example(\+|%20)Employer/,
  );
  await expectSourceTile(rows.nth(1), long, 'logo');
  await expectSourceTile(rows.nth(2), 'Example Bonus', 'icon');

  const spending = page.getByRole('region', {name: 'Spending by category'});
  for (const year of [/^2026/, /^2025$/]) {
    const a = await spending.getByRole('columnheader', {name: year}).boundingBox();
    const b = await table.getByRole('columnheader', {name: year}).boundingBox();
    expect(Math.round(b!.x)).toBe(Math.round(a!.x));
  }

  // On a phone each source row shows the same tile.
  await page.setViewportSize({width: 390, height: 900});
  const phoneRows = table.getByRole('button');
  await expect(phoneRows.first()).toBeVisible();
  await expectSourceTile(phoneRows.nth(0), long, 'logo');
  await expectSourceTile(phoneRows.nth(1), 'Example Bonus', 'icon');
});

test('a single month of history is one part year with no comparison', async ({page}) => {
  const history = homeHistory({
    spending: (month): Record<string, number> => (month === '2026-11' ? {FOOD_AND_DRINK: 40} : {}),
    income: () => ({}),
  });
  const keep = (period: {start: string}) => period.start >= '2026-11';
  history.trend.periods = history.trend.periods.filter(keep);
  history.flow.periods = history.flow.periods.filter(keep);
  history.breakdown.year.category = history.breakdown.year.category.filter(
    (p) => p.start >= '2026',
  );
  history.breakdown.year.source = history.breakdown.year.source.filter((p) => p.start >= '2026');
  history.breakdown.year.category[0].complete = false;
  await mockSyntheticHome(page, {history});
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Spending by category'});
  expect(await cells(table.getByRole('row').nth(0))).toEqual([
    'Category',
    '',
    '2026 from Nov · so far',
  ]);
  // Nothing came in, so there is no income table.
  await expect(page.getByRole('region', {name: 'Income by source'})).toHaveCount(0);
});

for (const width of [1440, 1024]) {
  test(`each per-year heading lines up with its column's figures at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await mockSyntheticHome(page);
    await page.goto('/');

    for (const title of ['Income by source', 'Spending by category']) {
      const rows = page.getByRole('region', {name: title}).getByRole('row');
      await expect(rows.nth(1)).toBeVisible();
      const [heads, body] = await Promise.all([textEdges(rows.nth(0)), textEdges(rows.nth(1))]);
      const first = await rows
        .nth(1)
        .locator('th')
        .first()
        .evaluate((cell) => {
          const box = cell.firstElementChild!.getBoundingClientRect();
          return box.left;
        });
      // The name column starts where its names (and their icons) do; every figure ends under its heading.
      expect.soft(Math.abs(heads[0].left! - first), `${title} name`).toBeLessThanOrEqual(1);
      for (let index = 1; index < heads.length; index++)
        expect
          .soft(Math.abs(heads[index].right! - body[index].right!), `${title} column ${index}`)
          .toBeLessThanOrEqual(1);
    }
  });
}

for (const width of [1440, 390]) {
  test(`opening a year moves no column at ${width}px`, async ({page, homePage}) => {
    await page.setViewportSize({width, height: 1000});
    await mockSyntheticHome(page);
    await page.goto('/');

    const table = homePage.yearTable;
    const columns = () =>
      table.locator('thead th').evaluateAll((heads) =>
        heads
          .filter((head) => (head as HTMLElement).offsetParent !== null)
          .map((head) => {
            const box = head.getBoundingClientRect();
            return {x: box.x, width: box.width};
          }),
      );
    const year = table.getByRole('button', {name: /^2026/});
    await expect(year).toHaveAttribute('aria-expanded', 'true');
    const open = await columns();
    expect(open.length).toBe(width < 640 ? 3 : 5);
    await year.click();
    await expect(year).toHaveAttribute('aria-expanded', 'false');
    expect(await columns()).toEqual(open);
    await table.getByRole('button', {name: /^2024/}).click();
    expect(await columns()).toEqual(open);
  });
}
