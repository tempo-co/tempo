import type {BankTransactionReviewCounts} from '../../../src/features/dashboard/types/bank-transaction-summary';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {mockJson, transformBankConnections} from '../../utils/api-mocks';
import {expectNoHorizontalOverflow} from '../../utils/layout';

const reviewCounts: BankTransactionReviewCounts = {
  needsReview: 2,
  categorizationFailed: 3,
  categorizing: 4,
  unknownDirection: 5,
  missingBaseAmount: 6,
};

const drills = [
  {label: 'Needs review', count: 2, search: {categories: ['NEEDS_REVIEW']}},
  {label: 'Not categorized', count: 3, search: {categoryStatuses: ['FAILED']}},
  {
    label: 'Categorizing',
    count: 4,
    section: 'Processing',
    search: {categoryStatuses: ['CATEGORIZING']},
  },
  {label: 'Unknown direction', count: 5, search: {cashFlows: ['UNKNOWN']}},
  {
    label: 'Preparing EUR amounts',
    section: 'Processing',
    count: 6,
    search: {baseAmount: 'MISSING', cashFlows: ['SPENDING', 'INCOME', 'UNKNOWN']},
  },
];

test.use({storageState: VERIFIED_USER_AUTH_FILE});
test.afterEach(async ({page}) => {
  await page.unrouteAll({behavior: 'wait'});
});
test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
  await mockJson(page, '**/bank-transactions/review-counts', reviewCounts);
  await mockJson(page, '**/bank-transactions/summary**', septemberSummary);
  await transformBankConnections(page, (connections) =>
    connections.map((connection) => ({...connection, baseCurrency: 'EUR'})),
  );
});

for (const {label, count, search, ...options} of drills) {
  test(`opens the all-time ${label} drill without inheriting the viewed month`, async ({page}) => {
    await page.goto('/?month=2026-09');
    const card = page.getByRole('region', {
      name: 'section' in options ? options.section : 'Needs attention',
      exact: true,
    });
    const link = card.getByRole('link', {name: new RegExp(`^${label}`)});
    await expect(link).toContainText(`${count} transactions · all months`);
    await link.click();
    await expect(page).toHaveURL(/\/bank-transactions/);
    const url = new URL(page.url());
    for (const [key, value] of Object.entries(search)) {
      const actual = url.searchParams.get(key);
      expect(actual).not.toBeNull();
      expect(Array.isArray(value) ? JSON.parse(actual!) : actual).toEqual(value);
    }
    expect(url.searchParams.has('bookingDate')).toBe(false);
    expect(url.searchParams.has('month')).toBe(false);
  });
}

test('hides zero-count rows and keeps overlapping counts separate', async ({page}) => {
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 1,
    missingBaseAmount: 1,
  } satisfies BankTransactionReviewCounts);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/?month=2026-09');
  const card = page.getByRole('region', {name: 'Needs attention', exact: true});
  await expect(card.getByRole('link')).toHaveCount(1);
  await expect(card.getByRole('link', {name: /^Unknown direction/})).toContainText(
    '1 transaction · all months',
  );
  await expect(
    page
      .getByRole('region', {name: 'Processing', exact: true})
      .getByRole('link', {name: /^Preparing EUR amounts/}),
  ).toContainText('1 transaction · all months');
  await expect(card).toContainText('A transaction can appear in more than one group.');
  await expect(card).not.toContainText('2 transactions');
  await expectNoHorizontalOverflow(page);
});

test('shows only Processing for background work and hides it once complete', async ({page}) => {
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 2,
    unknownDirection: 0,
    missingBaseAmount: 1,
  } satisfies BankTransactionReviewCounts);
  await page.goto('/?month=2026-09');
  const processing = page.getByRole('region', {name: 'Processing', exact: true});
  await expect(processing).toBeVisible();
  await expect(processing).toContainText(
    'Transactions without a EUR amount are excluded from spending and income totals.',
  );
  await expect(page.getByRole('region', {name: 'Needs attention', exact: true})).toHaveCount(0);
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 0,
    missingBaseAmount: 0,
  } satisfies BankTransactionReviewCounts);
  await page.reload();
  await expect(page.getByTestId('spending-summary')).toBeVisible();
  await expect(page.getByLabel('Loading attention counts')).toHaveCount(0);
  await expect(processing).toHaveCount(0);
});

test('hides Needs attention when every review count is zero', async ({page}) => {
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 0,
    missingBaseAmount: 0,
  } satisfies BankTransactionReviewCounts);
  await page.goto('/?month=2026-09');
  // Wait for the review counts to render something else first, so the card can't be loading.
  await expect(page.getByTestId('spending-summary')).toBeVisible();
  await expect(page.getByLabel('Loading attention counts')).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Needs attention', exact: true})).toHaveCount(0);
});

for (const baseCurrency of ['USD', null]) {
  test(`labels missing amounts using ${baseCurrency ?? 'an unresolved base currency'}`, async ({
    page,
  }) => {
    await mockJson(page, '**/bank-transactions/summary**', {...septemberSummary, baseCurrency});
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({...connection, baseCurrency})),
    );
    await page.goto('/?month=2026-09');
    const card = page.getByRole('region', {name: 'Processing', exact: true});
    await expect(
      card.getByRole('link', {
        name: new RegExp(`^Preparing ${baseCurrency ?? 'base-currency'} amounts`),
      }),
    ).toBeVisible();
  });
}
