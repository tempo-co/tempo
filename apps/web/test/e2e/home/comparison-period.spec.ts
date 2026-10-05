import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('completed February compares full baseline months while the chart stays day-by-day', async ({
  page,
}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await mockJson(page, '**/bank-transactions/summary**', {
    ...septemberSummary,
    month: '2026-02',
    through: '2026-02-28',
    daysInMonth: 28,
    daily: septemberSummary.daily.slice(0, 28),
    baseline: {
      ...septemberSummary.baseline,
      months: ['2025-11', '2025-12', '2026-01'],
      daily: septemberSummary.baseline.daily.slice(0, 28),
      // The full-month range deliberately differs from the chart's day-28 range.
      spendingRangeByThrough: {low: '1350.00', high: '1650.00'},
    },
  });
  await page.goto('/?month=2026-02');
  await expect(page.getByTestId('spending-comparison')).toContainText(
    'Nov–Jan average: €1,350.00 · less than any of those months',
  );
  await expect(page.getByTestId('category-breakdown')).toContainText(
    'Compared with usual for a full month.',
  );
  await expect(page.getByTestId('spending-summary')).toContainText(
    'Chart compares spending by the same day of each month; the headline compares full months.',
  );
  const lastRow = page
    .getByRole('table', {name: 'Exact daily spending', includeHidden: true})
    .getByRole('row', {includeHidden: true})
    .last();
  await expect(lastRow).toContainText('€1,260.00');
});

for (const current of [true, false]) {
  for (const {spending, verdict} of [
    {spending: '2000.00', verdict: 'more than any of those months'},
    {spending: '1200.00', verdict: 'within your previous 2 months'},
    {spending: '50.00', verdict: 'less than any of those months'},
    {spending: '1050.00', verdict: 'within your previous 2 months'},
    {spending: '1650.00', verdict: 'within your previous 2 months'},
  ]) {
    test(`${current ? 'current' : 'completed'} month: ${spending} uses the headline range and actual history count`, async ({
      page,
    }) => {
      await page.setViewportSize({width: 320, height: 844});
      await page.clock.setFixedTime(
        new Date(current ? '2026-02-05T12:00:00' : '2026-10-01T12:00:00'),
      );
      await mockJson(page, '**/bank-transactions/summary**', {
        ...septemberSummary,
        month: '2026-02',
        through: current ? '2026-02-05' : '2026-02-28',
        daysInMonth: 28,
        daily: septemberSummary.daily.slice(0, current ? 5 : 28),
        totals: {...septemberSummary.totals, spending},
        baseline: {
          ...septemberSummary.baseline,
          months: ['2025-12', '2026-01'],
          daily: septemberSummary.baseline.daily
            .slice(0, 28)
            .map((day) => ({...day, low: '0.00', high: '0.00'})),
        },
      });
      await page.goto('/?month=2026-02');
      const comparison = page.getByTestId('spending-comparison');
      await expect(comparison).toContainText(
        current ? 'Usual by the 5th: €1,350.00' : 'Dec–Jan average: €1,350.00',
      );
      await expect(comparison).toContainText(
        `${verdict}${current ? ' by this day' : ''} · only 2 months of history`,
      );
      await expect(page.getByTestId('category-breakdown')).toContainText(
        current
          ? 'Compared with usual by this day of the month.'
          : 'Compared with usual for a full month.',
      );
      await expectNoHorizontalOverflow(page);
      expect(await comparison.evaluate((element) => getComputedStyle(element).textAlign)).toBe(
        'start',
      );
    });
  }
}

test('one earlier month keeps its caveat without inventing a range', async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await mockJson(page, '**/bank-transactions/summary**', {
    ...septemberSummary,
    baseline: {
      ...septemberSummary.baseline,
      months: ['2026-08'],
      spendingRangeByThrough: null,
      daily: septemberSummary.baseline.daily.map((day) => ({...day, low: null, high: null})),
    },
  });
  await page.goto('/?month=2026-09');
  await expect(page.getByTestId('spending-comparison')).toHaveText(
    '€150.00 less than usualAug average: €1,350.00 · only 1 month of history',
  );
});

for (const width of [768, 1100, 1440]) {
  test(`long comparison aligns with its headline at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await mockJson(page, '**/bank-transactions/summary**', {
      ...septemberSummary,
      totals: {...septemberSummary.totals, spending: '2000.00'},
    });
    await page.goto('/?month=2026-09');
    const card = page.getByTestId('spending-summary');
    const comparison = card.getByTestId('spending-comparison');
    await expect(comparison).toContainText('more than any of those months');
    const headline = await card.getByRole('link').first().boundingBox();
    const side = await comparison.boundingBox();
    const beside = side!.y < headline!.y + headline!.height;
    expect(await comparison.evaluate((element) => getComputedStyle(element).textAlign)).toBe(
      beside ? 'right' : 'start',
    );
    await expectNoHorizontalOverflow(page);
  });
}
