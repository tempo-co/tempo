import type {Locator, Page} from '@playwright/test';

import type {BankConnection} from '../../../src/features/banking/types/bank-connection';
import {
  BankTransaction,
  BankTransactionDirection,
} from '../../../src/features/banking/types/bank-transaction';
import {septemberSummary} from '../../data/home-summary.data';
import {API_URL, expect, test} from '../../fixtures';
import {
  fulfillJson,
  mockBalanceTrend,
  mockBankConnections,
  mockBankRefresh,
  mockCashFlow,
  mockJson,
} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const CONNECTION_ID = '00000000-0000-4000-8000-000000000720';
const LOGO = `/merchant-logos/00000000-0000-4000-8000-000000000730/${'a'.repeat(64)}`;
const BROKEN_LOGO = `/merchant-logos/00000000-0000-4000-8000-000000000731/${'b'.repeat(64)}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j63kAAAAASUVORK5CYII=',
  'base64',
);

function transaction(
  index: number,
  displayDescription: string,
  overrides: Partial<BankTransaction>,
): BankTransaction {
  return {
    id: `00000000-0000-4000-8000-00000000070${index}`,
    displayDescription,
    merchantLogoUrl: null,
    description: `CARD ${displayDescription.toUpperCase()} TERMINAL 0${index}`,
    counterpartyName: null,
    transactionDate: `2026-09-1${index}`,
    bookingDate: `2026-09-1${index}`,
    valueDate: `2026-09-1${index}`,
    amount: '-24.50',
    currency: 'EUR',
    creditDebitIndicator: 'DBIT',
    direction: BankTransactionDirection.EXPENSE,
    transactionType: 'CARD_PAYMENT',
    transactionStatus: 'BOOK',
    providerTransactionDescription: null,
    merchantCategoryCode: null,
    remittanceInformation: null,
    balanceAfterAmount: null,
    balanceAfterCurrency: null,
    instructedAmount: null,
    instructedCurrency: null,
    exchangeRate: null,
    exchangeRateUnitCurrency: null,
    exchangeRateType: null,
    referenceNumber: null,
    referenceNumberScheme: null,
    bankName: 'Example Bank',
    bankCountry: 'NL',
    bankAccountName: 'Example account',
    bankAccountAlias: null,
    category: 'FOOD_AND_DRINK',
    categoryStatus: 'COMPLETED',
    categorySource: 'AI',
    categoryConfidence: '0.99',
    financialEventType: null,
    financialEventSource: null,
    financialEventRuleVersion: null,
    cashFlowTreatment: 'EXPENSE',
    ...overrides,
  };
}

const withLogo = transaction(1, 'Example Market', {merchantLogoUrl: LOGO});
const withoutLogo = transaction(2, 'Example Bakery', {});
const brokenLogo = transaction(3, 'Example Cafe', {merchantLogoUrl: BROKEN_LOGO});
const ownTransfer = transaction(4, 'Example Savings', {
  category: 'TRANSFER_OUT',
  transactionType: 'TRANSFER',
  cashFlowTreatment: 'INTERNAL',
  ownTransfer: {evidence: 'IBAN', counterpart: null},
});
const rows = [withLogo, withoutLogo, brokenLogo, ownTransfer];

const connection: BankConnection = {
  id: CONNECTION_ID,
  provider: 'EXAMPLE',
  aspspName: 'Example Bank',
  aspspCountry: 'NL',
  status: 'AUTHORIZED',
  consentValidUntil: '2027-01-01T00:00:00Z',
  lastSyncedAt: '2026-10-01T11:00:00Z',
  lastSyncError: null,
  nextSyncAt: '2026-10-02T11:00:00Z',
  syncStatus: 'SUCCEEDED',
  bankAccounts: [],
};

/** Serves every API call the four surfaces make; logo images come from the API's image route. */
async function mockMerchantLogos(page: Page) {
  const state = {logoRequests: [] as string[], unexpected: [] as string[]};
  const api = new URL(API_URL ?? '/api', 'http://localhost');
  await page.route(
    (url) => url.origin === api.origin && url.pathname.startsWith(api.pathname.replace(/\/$/, '')),
    (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      state.unexpected.push(new URL(route.request().url()).pathname);
      return fulfillJson(route, {}, 500);
    },
  );
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000700',
    name: 'Example Owner',
    email: 'merchant-logos@example.com',
    isEmailVerified: true,
  });
  await mockJson(page, '**/health', {});
  await mockBankConnections(page, [connection]);
  await mockBankRefresh(page);
  await mockJson(page, '**/bank-connections/aspsps', []);
  await mockJson(page, '**/bank-transactions/summary**', septemberSummary);
  await mockJson(page, '**/recurring-series/summary?**', {
    expenseMonthlyTotal: '0.00',
    incomeMonthlyTotal: '0.00',
    upcoming: [],
    expenseUnconvertedCount: 0,
    incomeUnconvertedCount: 0,
    baseCurrency: 'EUR',
  });
  await mockCashFlow(page);
  await mockBalanceTrend(page);
  await mockJson(page, '**/bank-transactions/review-counts', {
    needsReview: 0,
    categorizationFailed: 0,
    categorizing: 0,
    unknownDirection: 0,
    missingBaseAmount: 0,
  });
  await page.route('**/bank-transactions?**', (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    return fulfillJson(route, {transactions: rows, total: rows.length});
  });
  await page.route(`**/bank-connections/${CONNECTION_ID}/transactions**`, (route) =>
    fulfillJson(route, {transactions: rows, total: rows.length}),
  );
  await page.route(/\/bank-transactions\/[\da-f-]{36}$/, (route) =>
    fulfillJson(
      route,
      rows.find((row) => row.id === route.request().url().split('/').pop()),
    ),
  );
  await page.route('**/merchant-logos/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    state.logoRequests.push(path);
    return path.endsWith(LOGO)
      ? route.fulfill({contentType: 'image/png', body: PNG})
      : route.fulfill({status: 404, body: ''});
  });
  return state;
}

async function expectLogo(tile: Locator) {
  const image = tile.locator('img');
  await expect(image).toHaveAttribute('src', `${API_URL}${LOGO}`);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  await expect(tile.locator('svg')).toHaveCount(0);
}

async function expectIcon(tile: Locator) {
  await expect(tile.locator('svg')).toHaveCount(1);
  await expect(tile.locator('img')).toHaveCount(0);
}

/** Checks the tile of each row: the logo, the category icon, the icon after a failed image, the activity icon. */
async function expectRowTiles(tileOf: (row: BankTransaction) => Locator) {
  await expectLogo(tileOf(withLogo));
  await expectIcon(tileOf(withoutLogo));
  await expect(tileOf(withoutLogo)).toHaveClass(/text-category-food-and-drink/);
  await expectIcon(tileOf(brokenLogo));
  await expectIcon(tileOf(ownTransfer));
  await expect(tileOf(ownTransfer)).toHaveClass(/text-muted-foreground/);
}

/** The tile sits before the title on the same row and does not push the amount off screen. */
async function expectTileBeforeTitle(tile: Locator, title: Locator) {
  const [tileBox, titleBox] = await Promise.all([boxOf(tile), boxOf(title)]);
  expect(tileBox.x + tileBox.width).toBeLessThanOrEqual(titleBox.x);
  expect(tileBox.y).toBeLessThan(titleBox.y + titleBox.height);
  expect(tileBox.y + tileBox.height).toBeGreaterThan(titleBox.y);
}

test.use({storageState: {cookies: [], origins: []}});

for (const width of [1440, 390]) {
  test.describe(`merchant logo tiles at ${width}px`, () => {
    test.use({viewport: {width, height: 1000}});

    test('show the merchant logo before each transaction name, or the category icon', async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
      const state = await mockMerchantLogos(page);

      await page.goto('/bank-transactions');
      const tableRow = (row: BankTransaction) => page.getByTestId(`bank-transaction-row-${row.id}`);
      const tableTile = (row: BankTransaction) =>
        tableRow(row).getByTestId('merchant-logo-tile').locator('visible=true');
      await expectRowTiles(tableTile);
      await expectTileBeforeTitle(
        tableTile(withLogo),
        tableRow(withLogo).getByText('Example Market', {exact: true}),
      );
      if (width < 1024) {
        // Phones keep the small category icon in the meta line under the title.
        const meta = tableRow(withLogo).getByTestId('bank-transaction-mobile-meta');
        await expect(meta).toContainText('Food and drink');
        await expect(meta.locator('svg')).toHaveCount(1);
        await expect(meta.locator('img')).toHaveCount(0);
      }
      await expectNoHorizontalOverflow(page);

      await tableRow(withLogo)
        .getByRole('button', {name: 'View Example Market transaction details'})
        .click();
      const inspector = page.getByTestId('bank-transaction-inspector');
      const inspectorTile = inspector.getByTestId('merchant-logo-tile');
      await expectLogo(inspectorTile);
      await expectTileBeforeTitle(
        inspectorTile,
        inspector.getByRole('heading', {name: 'Example Market', exact: true}),
      );
      await page.getByRole('button', {name: 'Close transaction details', exact: true}).click();
      await expect(inspector).toBeHidden();

      await page.goto('/bank-connections');
      await page.getByTestId(`connection-card-toggle-${CONNECTION_ID}`).click();
      const connectionRow = (row: BankTransaction) =>
        page.getByTestId(`bank-transaction-row-${row.id}`);
      await expectRowTiles((row) => connectionRow(row).getByTestId('merchant-logo-tile'));
      await expectTileBeforeTitle(
        connectionRow(withLogo).getByTestId('merchant-logo-tile'),
        connectionRow(withLogo).getByText('Example Market', {exact: true}),
      );
      await expectNoHorizontalOverflow(page);

      await page.goto('/?month=2026-09');
      const recent = page.getByRole('region', {name: 'Latest in September 2026'});
      const recentRow = (row: BankTransaction) =>
        recent.locator('li').filter({hasText: row.displayDescription!});
      await expectRowTiles((row) => recentRow(row).getByTestId('merchant-logo-tile'));
      await expectTileBeforeTitle(
        recentRow(withLogo).getByTestId('merchant-logo-tile'),
        recentRow(withLogo).getByText('Example Market', {exact: true}),
      );
      await expectNoHorizontalOverflow(page);

      expect(
        state.logoRequests.every((path) => path.endsWith(LOGO) || path.endsWith(BROKEN_LOGO)),
      ).toBe(true);
      expect(state.unexpected).toEqual([]);
    });
  });
}
