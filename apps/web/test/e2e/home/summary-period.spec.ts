import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {expect, test} from '../../fixtures';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test('requests whole-month history for a completed month and today for the current month', async ({
  page,
}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  const completed = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith('/bank-transactions/summary') &&
      url.searchParams.get('month') === '2026-09'
    );
  });
  await page.goto('/?month=2026-09');
  expect(new URL((await completed).url()).searchParams.get('asOf')).toBe('2026-10-01');
  await expect(page.getByTestId('spending-summary')).toBeVisible();
  const current = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith('/bank-transactions/summary') &&
      url.searchParams.get('month') === '2026-10'
    );
  });
  await page.goto('/');
  expect(new URL((await current).url()).searchParams.get('asOf')).toBe('2026-10-01');
  await expect(page.getByTestId('spending-summary')).toBeVisible();
});
