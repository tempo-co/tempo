import type {Locator} from '@playwright/test';

import {homeHistory, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

/** A table row's cells as one line of text each, once the row is on screen. */
async function cells(row: Locator) {
  await expect(row).toBeVisible();
  const texts = await row.locator('th, td').allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, ' ').trim());
}

test('year by year shows each year, newest first and open, and its months open the month', async ({
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
    'Example Airline −€1,500',
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

  await years.nth(0).click();
  await expect(months).toHaveCount(0);
  await years.nth(1).click();
  expect(await cells(table.getByRole('row').nth(2))).toEqual([
    '2025',
    '€40,000',
    '€24,000',
    '+€16,000 40% of in',
    '€17,000 +€16,000',
    'Example Bonus +€4,000',
  ]);
  await table.getByRole('link', {name: 'June'}).click();
  await expect(page).toHaveURL(/[?&]month=2025-06/);
  await expect(homePage.monthDialog('June 2025')).toBeVisible();
});

test('spending by category shows a month on average per year, with small categories folded', async ({
  page,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Spending by category'});
  const rows = table.getByRole('row');
  expect(await cells(rows.nth(0))).toEqual(['Category', 'vs 2025', '2026*', '2025', '2024*']);
  // 2026 has ten whole months and 5 of November's 30 days: €13,200 of housing is €1,298 a month.
  expect(await cells(rows.nth(1))).toEqual([
    'Housing and utilities',
    '+8%',
    '€1,298',
    '€1,200',
    '€1,200',
  ]);
  expect(await cells(rows.nth(4))).toEqual(['Travel', 'new', '€148', '–', '–']);
  // Transport, entertainment and health are each under 3% of all spending.
  const more = table.getByRole('button', {name: '3 more categories'});
  expect(await cells(rows.nth(5))).toEqual(['3 more categories', '−2%', '€98', '€100', '€100']);
  expect(await cells(rows.last())).toEqual(['Total', '+12%', '€2,233', '€2,000', '€2,000']);
  await expect(table).toContainText('* part year: 2024 from Dec, 2026 up to 5 Nov');

  // Shading compares a row's years; December 2024 alone is too thin to shade.
  const housing = rows.nth(1).getByRole('link');
  await expect(housing.nth(0)).toHaveAttribute(
    'aria-label',
    'Housing and utilities, 2026: €1,298 a month · €13,200 in the year so far',
  );
  await expect(housing.nth(0)).toHaveCSS('font-weight', '600');
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

test('income by source names each source and lines up with the spending years', async ({page}) => {
  await mockSyntheticHome(page);
  await page.goto('/');

  const table = page.getByRole('region', {name: 'Income by source'});
  const rows = table.getByRole('row');
  expect(await cells(rows.nth(1))).toEqual([
    'Example Employer',
    '−2%',
    '€2,951',
    '€3,000',
    '€3,000',
  ]);
  expect(await cells(rows.nth(2))).toEqual(['Example Bonus', '−100%', '–', '€333', '–']);
  await expect(rows.nth(1).getByRole('link').first()).toHaveAttribute(
    'href',
    /search=Example(\+|%20)Employer/,
  );

  const spending = page.getByRole('region', {name: 'Spending by category'});
  for (const year of ['2026*', '2025']) {
    const a = await spending.getByRole('columnheader', {name: year, exact: true}).boundingBox();
    const b = await table.getByRole('columnheader', {name: year, exact: true}).boundingBox();
    expect(Math.round(b!.x)).toBe(Math.round(a!.x));
  }
});

test('a single month of history is one part year with no comparison', async ({page}) => {
  const history = homeHistory({
    spending: (month): Record<string, number> => (month === '2026-11' ? {FOOD_AND_DRINK: 40} : {}),
    income: () => ({}),
    events: [],
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
  expect(await cells(table.getByRole('row').nth(0))).toEqual(['Category', '', '2026*']);
  await expect(table).toContainText('* part year: 2026 from Nov up to 5 Nov');
  // Nothing came in, so there is no income table.
  await expect(page.getByRole('region', {name: 'Income by source'})).toHaveCount(0);
});
