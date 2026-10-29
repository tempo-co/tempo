import type {Locator, Page} from '@playwright/test';
import {type Server, createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

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
const RECOVERED_LOGO = BROKEN_LOGO.replace('b'.repeat(64), 'c'.repeat(64));
// Synthetic white RGBA, 128px canvas, 104px mark: alpha 64, 128, 192, 255, transparent outside.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABwElEQVR4nO3SwU1DARQDwZRGaZRGZ58a9kk4SBlLe/dhXs/zvPS5vf2AABAAAkAACAABIAAEgAAQAPqPAL5GfY/6GbUaADEAYgAAAMCh1QCIARADAAAADq0GQAyAGAAAAHBoNQBiAMQAAACAQ6sBEAMgBgAAABxaDYAYADEAAADg0GoAxACIAQAAAIdWAyAGQAwAAAA4tBoAMQBiAAAAwKHVAIgBEAMAAAAOrQZADIAYAAAAcGg1AGIAxAAAAIBDqwEQAyAGAAAAHFoNgBgAMQAAAODQagDEAIgBAAAAh1YDIAZADAAAADi0GgAxAGIAAADAodUAiAEQAwAAAA6tBkAMgBgAAABwaDUAYgDEAAAAgEOrARADIAYAAAAcWg2AGAAxAAAA4NBqAMQAiAEAAACHVgMgBkAMAAAAOLQaADEAYgAAAMCh1QCIARADAAAADq0GQAyAGAAAAHBoNQBiAMQAAACAQ6sBEAMgBgAAABxaDYAYADEAAADg0GoAxACIAQAAAIdWAyAGQAwAAAA4tBoAMQBiAAAAwKHVAIgBEAMAAAAOrQZADAB9bm8/IAAEgAAQAAJAAAgAASAABID+ul8gA6oorVvsJAAAAABJRU5ErkJggg==',
  'base64',
);

const PALETTES = {
  light: {
    field: [241, 227, 216],
    ink: [143, 64, 50],
    edge: [208, 184, 169],
    category: [160, 86, 44],
  },
  dark: {field: [53, 42, 40], ink: [229, 154, 123], edge: [89, 65, 58], category: [229, 152, 108]},
};
type Theme = keyof typeof PALETTES;

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

const imageServers = new Set<Server>();

test.afterEach(async () => {
  for (const server of imageServers) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    imageServers.delete(server);
  }
});

/** JSON is mocked; images use real HTTP, the API's CORP policy and a synthetic cookie gate. */
async function mockMerchantLogos(page: Page) {
  const state = {
    logoRequests: [] as string[],
    servedImages: [] as {path: string; authenticated: boolean}[],
    unexpected: [] as string[],
    rows: structuredClone(rows),
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const authenticated =
      request.headers.cookie?.split('; ').includes('logo-session=synthetic') ?? false;
    state.servedImages.push({path, authenticated});
    if (!authenticated) {
      response.writeHead(401).end();
    } else if ([LOGO, RECOVERED_LOGO].some((src) => path.endsWith(`${src}/mask-v1`))) {
      response
        .writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Cross-Origin-Resource-Policy': 'same-site',
        })
        .end(PNG);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  imageServers.add(server);
  const imagePort = (server.address() as AddressInfo).port;
  await page
    .context()
    .addCookies([{name: 'logo-session', value: 'synthetic', domain: 'localhost', path: '/'}]);
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
    expenseMonthlyTotal: '24.50',
    incomeMonthlyTotal: '0.00',
    expenseThisMonth: {month: '2026-10', paid: '0.00', remaining: '24.50'},
    incomeThisMonth: {month: '2026-10', paid: '0.00', remaining: '0.00'},
    // A recurring payment shows its latest payment's logo, like that payment's transaction row.
    upcoming: [
      {
        key: 'a'.repeat(32),
        name: 'Example Market',
        direction: 'EXPENSE',
        nextExpectedDate: '2026-10-11',
        typicalAmount: '24.50',
        amountKind: 'FIXED',
        currency: 'EUR',
        category: 'FOOD_AND_DRINK',
        merchantLogoUrl: LOGO,
        flags: [],
      },
    ],
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
    return fulfillJson(route, {transactions: state.rows, total: state.rows.length});
  });
  await page.route(`**/bank-connections/${CONNECTION_ID}/transactions**`, (route) =>
    fulfillJson(route, {transactions: state.rows, total: state.rows.length}),
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
    return route.continue({url: `http://localhost:${imagePort}${path}`});
  });
  return state;
}

async function expectPalette(tile: Locator, theme: Theme) {
  const {field, ink, edge} = PALETTES[theme];
  await expect(tile).toHaveCSS('background-color', `rgb(${field.join(', ')})`);
  await expect(tile).toHaveCSS('color', `rgb(${ink.join(', ')})`);
  await expect(tile).toHaveCSS('border-color', `rgb(${edge.join(', ')})`);
}

async function expectLogo(tile: Locator, theme: Theme, src = LOGO) {
  const image = tile.locator('img');
  await expect(image).toHaveAttribute('src', `${API_URL}${src}/mask-v1`);
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(128);
  // Ordinary image requests include the cross-origin API session; anonymous CORS masks do not.
  expect(await image.evaluate((el: HTMLImageElement) => el.crossOrigin)).toBeNull();
  await expectPalette(tile, theme);
}

/** Inspect the browser's composited screenshot, not a canvas drawing of the unfiltered source. */
async function expectTintedPixels(tile: Locator, theme: Theme) {
  const screenshot = await tile.screenshot({scale: 'css', animations: 'disabled'});
  const pixels = await tile.page().evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    // Flat centres avoid interpolation boundaries and the round tile's edge.
    return [8, 24, 50, 78, 104].map((sourceX) => {
      const x = 1 + Math.floor((sourceX * (image.width - 2)) / 128);
      return Array.from(context.getImageData(x, Math.floor(image.height / 2), 1, 1).data);
    });
  }, screenshot.toString('base64'));
  const {field, ink} = PALETTES[theme];
  const alpha = [0, 64, 128, 192, 255];
  const expected = alpha.map((a) => [
    ...ink.map((channel, i) => Math.round((channel * a) / 255 + field[i] * (1 - a / 255))),
    255,
  ]);
  for (let i = 0; i < pixels.length; i++) {
    for (let channel = 0; channel < 4; channel++) {
      expect(Math.abs(pixels[i][channel] - expected[i][channel])).toBeLessThanOrEqual(1);
    }
  }
  await test.info().attach(`tinted-tile-${theme}`, {body: screenshot, contentType: 'image/png'});
  await test.info().attach(`composited-alpha-${theme}`, {
    body: JSON.stringify({theme, alpha, pixels, expected}),
    contentType: 'application/json',
  });
}

async function expectIcon(tile: Locator) {
  await expect(tile.locator('svg')).toHaveCount(1);
  await expect(tile.locator('img')).toHaveCount(0);
}

/** Checks the tile of each row: the logo, the category icon, the icon after a failed image, the activity icon. */
async function expectRowTiles(tileOf: (row: BankTransaction) => Locator, theme: Theme) {
  await expectLogo(tileOf(withLogo), theme);
  await expectTintedPixels(tileOf(withLogo), theme);
  await expectIcon(tileOf(withoutLogo));
  await expectPalette(tileOf(withoutLogo), theme);
  await expectIcon(tileOf(brokenLogo));
  await expectIcon(tileOf(ownTransfer));
  await expectPalette(tileOf(brokenLogo), theme);
  await expectPalette(tileOf(ownTransfer), theme);
  await expect(tileOf(ownTransfer).locator('svg')).toHaveCSS(
    'color',
    `rgb(${PALETTES[theme].ink.join(', ')})`,
  );
}

/** Every list of transactions uses one row height and one tile size; the row may add a 1px divider. */
async function expectTransactionRowSize(row: Locator, tile: Locator) {
  const [rowBox, tileBox] = await Promise.all([boxOf(row), boxOf(tile)]);
  expect({width: tileBox.width, height: tileBox.height}).toEqual({width: 36, height: 36});
  expect(rowBox.height).toBeGreaterThanOrEqual(60);
  expect(rowBox.height).toBeLessThanOrEqual(61);
}

/** The tile sits before the title on the same row and does not push the amount off screen. */
async function expectTileBeforeTitle(tile: Locator, title: Locator) {
  const [tileBox, titleBox] = await Promise.all([boxOf(tile), boxOf(title)]);
  expect(tileBox.x + tileBox.width).toBeLessThanOrEqual(titleBox.x);
  expect(tileBox.y).toBeLessThan(titleBox.y + titleBox.height);
  expect(tileBox.y + tileBox.height).toBeGreaterThan(titleBox.y);
}

// Route fixtures own these requests; service-worker/offline behaviour has separate coverage.
test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`merchant logo tiles at ${width}px in ${theme}`, () => {
      test.use({viewport: {width, height: 1000}});

      test('show Clay alpha logos and matching fallbacks across transaction surfaces', async ({
        page,
      }) => {
        test.slow();
        await page.addInitScript((theme) => localStorage.setItem('vite-ui-theme', theme), theme);
        await page.clock.install({time: new Date('2026-10-01T12:00:00Z')});
        const state = await mockMerchantLogos(page);

        await page.goto('/bank-transactions');
        const tableRow = (row: BankTransaction) =>
          page.getByTestId(`bank-transaction-row-${row.id}`);
        const tableTile = (row: BankTransaction) =>
          tableRow(row).getByTestId('merchant-logo-tile').locator('visible=true');
        await expectRowTiles(tableTile, theme);
        const maskRequests = state.logoRequests.length;
        const otherTheme = theme === 'light' ? 'dark' : 'light';
        // Switch the live CSS theme without remounting or replacing the loaded mask.
        await tableTile(withLogo)
          .locator('img')
          .evaluate((el) => el.setAttribute('data-loaded-mask', 'same'));
        await page.evaluate((theme) => {
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(theme);
        }, otherTheme);
        await expectPalette(tableTile(withLogo), otherTheme);
        await expectTintedPixels(tableTile(withLogo), otherTheme);
        await expectPalette(tableTile(withoutLogo), otherTheme);
        await page.evaluate((theme) => {
          document.documentElement.classList.remove('light', 'dark');
          document.documentElement.classList.add(theme);
        }, theme);
        await expectLogo(tableTile(withLogo), theme);
        await expect(tableTile(withLogo).locator('img')).toHaveAttribute(
          'data-loaded-mask',
          'same',
        );
        expect(state.logoRequests.length).toBe(maskRequests);
        const categoryIcon =
          width < 1024
            ? tableRow(withLogo).getByTestId('bank-transaction-mobile-meta').locator('svg')
            : tableRow(withLogo).getByRole('cell').nth(2).locator('svg');
        await expect(categoryIcon).toHaveCSS(
          'color',
          `rgb(${PALETTES[theme].category.join(', ')})`,
        );
        await expectTileBeforeTitle(
          tableTile(withLogo),
          tableRow(withLogo).getByText('Example Market', {exact: true}),
        );
        await expectTransactionRowSize(tableRow(withLogo), tableTile(withLogo));
        // A row whose category has a second line keeps the same height.
        await expectTransactionRowSize(tableRow(ownTransfer), tableTile(ownTransfer));
        if (width < 1024) {
          // Phones keep the small category icon in the meta line under the title.
          const meta = tableRow(withLogo).getByTestId('bank-transaction-mobile-meta');
          await expect(meta).toContainText('Food and drink');
          await expect(meta.locator('svg')).toHaveCount(1);
          await expect(meta.locator('img')).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);
        await test.info().attach(`transactions-${width}-${theme}`, {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        await tableRow(withLogo)
          .getByRole('button', {name: 'View Example Market transaction details'})
          .click();
        const inspector = page.getByTestId('bank-transaction-inspector');
        const inspectorTile = inspector.getByTestId('merchant-logo-tile');
        await expectLogo(inspectorTile, theme);
        await inspector.evaluate((el) =>
          Promise.all(el.getAnimations({subtree: true}).map((animation) => animation.finished)),
        );
        await expectTintedPixels(inspectorTile, theme);
        expect(await boxOf(inspectorTile)).toMatchObject({width: 40, height: 40});
        await test.info().attach(`inspector-${width}-${theme}`, {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
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
        await expectRowTiles((row) => connectionRow(row).getByTestId('merchant-logo-tile'), theme);
        await expectTileBeforeTitle(
          connectionRow(withLogo).getByTestId('merchant-logo-tile'),
          connectionRow(withLogo).getByText('Example Market', {exact: true}),
        );
        await expectTransactionRowSize(
          connectionRow(withLogo),
          connectionRow(withLogo).getByTestId('merchant-logo-tile'),
        );
        await expectNoHorizontalOverflow(page);
        await test.info().attach(`connections-${width}-${theme}`, {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });

        await page.goto('/?month=2026-09');
        const recent = page.getByRole('region', {name: 'Latest in September 2026'});
        const recentRow = (row: BankTransaction) =>
          recent.locator('li').filter({hasText: row.displayDescription!});
        await expectRowTiles((row) => recentRow(row).getByTestId('merchant-logo-tile'), theme);
        await expectTileBeforeTitle(
          recentRow(withLogo).getByTestId('merchant-logo-tile'),
          recentRow(withLogo).getByText('Example Market', {exact: true}),
        );
        await expectTransactionRowSize(
          recentRow(withLogo).getByRole('link'),
          recentRow(withLogo).getByTestId('merchant-logo-tile'),
        );
        const upcoming = page
          .getByRole('region', {name: 'Recurring payments'})
          .getByRole('listitem')
          .filter({hasText: 'Example Market'});
        await expectLogo(upcoming.getByTestId('merchant-logo-tile'), theme);
        await expectTintedPixels(upcoming.getByTestId('merchant-logo-tile'), theme);
        await expectTransactionRowSize(
          upcoming.getByRole('button'),
          upcoming.getByTestId('merchant-logo-tile'),
        );
        await expectNoHorizontalOverflow(page);

        // The existing failed tile recovers when a later refresh supplies a new source version.
        const recoveringTile = recentRow(brokenLogo).getByTestId('merchant-logo-tile');
        await recentRow(brokenLogo).evaluate((el) => el.setAttribute('data-mounted-row', 'same'));
        state.rows[2].merchantLogoUrl = RECOVERED_LOGO;
        await page.clock.fastForward(30_000);
        await expectLogo(recoveringTile, theme, RECOVERED_LOGO);
        await expect(recentRow(brokenLogo)).toHaveAttribute('data-mounted-row', 'same');
        await test.info().attach(`home-${width}-${theme}`, {
          body: await page.screenshot({fullPage: true}),
          contentType: 'image/png',
        });
        expect(
          state.logoRequests.every((path) =>
            [LOGO, BROKEN_LOGO, RECOVERED_LOGO].some((src) => path.endsWith(`${src}/mask-v1`)),
          ),
        ).toBe(true);
        expect(state.servedImages.length).toBeGreaterThan(0);
        expect(state.servedImages.every(({authenticated}) => authenticated)).toBe(true);
        expect(state.unexpected).toEqual([]);
      });
    });
  }
}
