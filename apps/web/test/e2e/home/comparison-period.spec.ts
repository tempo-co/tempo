import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {mockJson} from '../../utils/api-mocks';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('completed February compares through day 28, not full longer baseline months', async ({
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
    },
  });
  await page.goto('/?month=2026-02');
  await expect(page.getByTestId('spending-comparison')).toContainText('Usual by the 28th');
  await expect(page.getByTestId('category-breakdown')).toContainText(
    'Compared with usual through day 28 of each month.',
  );
  await expect(page.getByTestId('spending-comparison')).not.toContainText('for a month');
  await expect(page.getByTestId('category-breakdown')).not.toContainText('for a full month');
});
