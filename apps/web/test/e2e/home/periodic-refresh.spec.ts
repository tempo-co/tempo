import type {Page} from '@playwright/test';

import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {SEEDED_TRANSACTION_YEAR_NOW} from '../../constants/seed.constants';
import {septemberSummary} from '../../data/home-summary.data';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections} from '../../utils/api-mocks';

const connection: BankConnection = {
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'ENABLE_BANKING',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  status: 'AUTHORIZED',
  consentValidUntil: '2027-01-01T00:00:00Z',
  lastSyncedAt: '2026-09-30T00:00:00Z',
  lastSyncError: null,
  nextSyncAt: null,
  syncStatus: 'SUCCEEDED',
  baseCurrency: 'EUR',
  bankAccounts: [],
};

test.use({storageState: VERIFIED_USER_AUTH_FILE});

/** Late categorization or conversion changes data without any sync status change. */
async function mockDerivedData(page: Page) {
  const state = {enriched: false, reads: {summary: 0, review: 0, recent: 0}};
  await page.clock.install({time: SEEDED_TRANSACTION_YEAR_NOW});
  await mockBankConnections(page, () => [connection]);
  await page.route('**/bank-transactions/summary**', (route) => {
    state.reads.summary++;
    return fulfillJson(route, {
      ...septemberSummary,
      totals: {...septemberSummary.totals, spending: state.enriched ? '1400.00' : '1200.00'},
    });
  });
  await page.route('**/bank-transactions/review-counts', (route) => {
    state.reads.review++;
    return fulfillJson(route, {
      needsReview: 0,
      categorizationFailed: 0,
      categorizing: state.enriched ? 0 : 3,
      unknownDirection: 0,
      missingBaseAmount: 0,
    });
  });
  await page.route('**/bank-transactions?**', (route) => {
    state.reads.recent++;
    return fulfillJson(route, {
      transactions: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          bookingDate: '2026-09-30',
          amount: '-200.00',
          currency: 'EUR',
          displayDescription: 'Example shop',
          category: state.enriched ? 'OTHER' : null,
          categoryStatus: state.enriched ? 'COMPLETED' : 'PENDING',
        },
      ],
      total: 1,
    });
  });
  return state;
}

test('Home refreshes derived financial data every 30 seconds while visible', async ({page}) => {
  const state = await mockDerivedData(page);
  await page.goto('/?month=2026-09');
  const spending = page.getByTestId('spending-summary');
  const attention = page.getByRole('region', {name: 'Needs attention', exact: true});
  await expect(spending.getByRole('link', {name: '€1,200.00', exact: true})).toBeVisible();
  await expect(attention).toContainText('3 transactions');
  expect(state.reads).toEqual({summary: 1, review: 1, recent: 1});

  state.enriched = true;
  await page.clock.runFor(29_000);
  expect(state.reads).toEqual({summary: 1, review: 1, recent: 1});
  await page.clock.runFor(1_500);
  await expect(spending.getByRole('link', {name: '€1,400.00', exact: true})).toBeVisible();
  // Every count is now zero, so the card disappears.
  await expect(attention).toHaveCount(0);
  await expect.poll(() => state.reads).toEqual({summary: 2, review: 2, recent: 2});
  // A background refresh keeps the rendered data instead of flashing skeletons.
  await expect(page.getByLabel('Loading spending')).toHaveCount(0);
});

test('Home does not refresh while the tab is hidden', async ({page}) => {
  const state = await mockDerivedData(page);
  await page.goto('/?month=2026-09');
  await expect(
    page.getByTestId('spending-summary').getByRole('link', {name: '€1,200.00', exact: true}),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(95_000);
  expect(state.reads).toEqual({summary: 1, review: 1, recent: 1});
});
