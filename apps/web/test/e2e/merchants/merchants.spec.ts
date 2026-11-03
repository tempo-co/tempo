import type {Page} from '@playwright/test';
import type {
  BankTransaction,
  MerchantGroup,
  MerchantGroupPeriods,
  MerchantGroupsResponse,
  MerchantRanking,
} from '@tempo/contracts';

import {API_URL, expect, test} from '../../fixtures';
import {fulfillJson, mockBankConnections, mockBankRefresh, mockJson} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const BRAND = `b_${'1'.repeat(32)}`;
const PERSON = `k_${'2'.repeat(32)}`;
const LONG = `k_${'3'.repeat(32)}`;
const UNBROKEN = `k_${'4'.repeat(32)}`;
const EMPLOYER = `k_${'5'.repeat(32)}`;
const LONG_NAME = 'Example Długoszewska-Przykładowa Catering & Events International Holdings';
const UNBROKEN_NAME = 'ExampleSuperLongMerchantNameWithoutAnySpacesAtAllBV';

/** Worst-case rows first: long and unbreakable names, a large amount, a count of one and none. */
const ranking: MerchantRanking = {
  baseCurrency: 'EUR',
  interval: 'month',
  start: '2026-10-01',
  end: '2026-10-31',
  through: '2026-10-18',
  baselinePeriods: [
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
    '2026-08-01',
    '2026-09-01',
  ],
  total: 7,
  merchants: [
    {
      id: LONG,
      name: LONG_NAME,
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '123456.78',
      count: 1,
      usual: '0.00',
      change: '123456.78',
    },
    {
      id: BRAND,
      name: 'Example Burger',
      kind: 'BRAND',
      logoUrl: null,
      spent: '64.00',
      count: 5,
      usual: '40.00',
      change: '24.00',
    },
    {
      id: UNBROKEN,
      name: UNBROKEN_NAME,
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '50.00',
      count: 1284,
      usual: '49.00',
      change: '1.00',
    },
    {
      id: PERSON,
      name: 'Alex Example',
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '25.00',
      count: 2,
      usual: '12.00',
      change: '13.00',
    },
    {
      id: `k_${'6'.repeat(32)}`,
      name: 'Jo',
      kind: 'MERCHANT',
      logoUrl: null,
      spent: '0.01',
      count: 1,
      usual: null,
      change: null,
    },
  ],
};

const listItem = (
  id: string,
  name: string,
  spent: string,
  extra: Partial<MerchantGroupsResponse['merchants'][number]> = {},
) => ({
  id,
  name,
  kind: 'MERCHANT' as const,
  logoUrl: null,
  spent,
  received: '0.00',
  count: 3,
  lastDate: '2026-10-12',
  ...extra,
});

const allMerchants = [
  listItem(LONG, LONG_NAME, '123456.78', {count: 1}),
  listItem(BRAND, 'Example Burger', '310.40', {kind: 'BRAND', count: 41}),
  listItem(UNBROKEN, UNBROKEN_NAME, '50.00', {count: 1284}),
  listItem(PERSON, 'Alex Example', '25.00', {received: '20.00'}),
  listItem(EMPLOYER, 'Example Employer', '0.00', {received: '98765.43', lastDate: null}),
];

const burger: MerchantGroup = {
  ...listItem(BRAND, 'Example Burger', '310.40', {
    kind: 'BRAND',
    count: 41,
    lastDate: '2026-10-14',
  }),
  baseCurrency: 'EUR',
  paid: '320.40',
  refunded: '10.00',
  paymentCount: 40,
  averagePayment: '8.01',
  firstDate: '2025-10-20',
  excluded: {unknownDirection: 0, missingBaseAmount: 2},
  variants: [
    {
      key: 'example burger online ordering platform example city central',
      name: 'Example Burger Online Ordering Platform Example City Central',
      spent: '200.40',
      received: '0.00',
      count: 25,
      lastDate: '2026-10-14',
    },
    {
      key: 'example burger nl',
      name: 'Example Burger NL',
      spent: '110.00',
      received: '0.00',
      count: 16,
      lastDate: '2026-10-12',
    },
  ],
};

const burgerPeriods = (interval: MerchantGroupPeriods['interval']): MerchantGroupPeriods => ({
  baseCurrency: 'EUR',
  interval,
  periods:
    interval === 'year'
      ? [
          {
            start: '2025-01-01',
            end: '2025-12-31',
            complete: true,
            spent: '60.00',
            received: '0.00',
            count: 7,
          },
          {
            start: '2026-01-01',
            end: '2026-10-18',
            complete: false,
            spent: '250.40',
            received: '0.00',
            count: 34,
          },
        ]
      : [
          {
            start: '2026-08-01',
            end: '2026-08-31',
            complete: true,
            spent: '40.00',
            received: '0.00',
            count: 5,
          },
          {
            start: '2026-09-01',
            end: '2026-09-30',
            complete: true,
            spent: '0.00',
            received: '0.00',
            count: 0,
          },
          {
            start: '2026-10-01',
            end: '2026-10-18',
            complete: false,
            spent: '30.40',
            received: '0.00',
            count: 4,
          },
        ],
});

function burgerTransaction(index: number, fields: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: `00000000-0000-4000-8000-${String(900 + index).padStart(12, '0')}`,
    transactionDate: `2026-10-1${index}`,
    bookingDate: `2026-10-1${index}`,
    valueDate: `2026-10-1${index}`,
    description: `Example Burger NL ${index}`,
    displayDescription: 'Example Burger NL',
    merchantLogoUrl: null,
    merchantGroupId: BRAND,
    counterpartyName: null,
    amount: '-8.00',
    currency: 'EUR',
    creditDebitIndicator: 'DBIT',
    direction: 'EXPENSE',
    transactionType: 'CARD_PAYMENT',
    transactionStatus: 'BOOK',
    category: 'FOOD_AND_DRINK',
    categoryStatus: 'COMPLETED',
    categorySource: 'AI',
    financialEventType: null,
    financialEventSource: null,
    financialEventRuleVersion: null,
    cashFlowTreatment: 'EXPENSE',
    ownTransfer: null,
    ownTransferOverride: null,
    currencyExchangeCounterpart: null,
    categoryConfidence: null,
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
    amountInBaseCurrency: '-8.00',
    baseAmountMethod: 'SAME',
    baseAmountRateDate: null,
    referenceNumber: null,
    referenceNumberScheme: null,
    bankName: 'Example Bank',
    bankCountry: 'NL',
    bankAccountName: 'Example Account Holder',
    bankAccountAlias: 'Example spending account',
    ...fields,
  };
}

async function mockSignedIn(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+02:00'));
  await mockJson(page, '**/accounts/me', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Example Owner',
    email: 'merchants@example.com',
    isEmailVerified: true,
  });
  await mockBankRefresh(page);
  await mockJson(page, '**/bank-connections/aspsps', []);
  await mockBankConnections(page, [
    {
      id: '00000000-0000-4000-8000-000000000002',
      provider: 'EXAMPLE',
      aspspName: 'Example Bank',
      aspspCountry: 'NL',
      status: 'AUTHORIZED',
      consentValidUntil: '2027-01-01T00:00:00Z',
      lastSyncedAt: '2026-10-18T09:00:00Z',
      lastSyncError: null,
      nextSyncAt: '2026-10-19T09:00:00Z',
      syncStatus: 'SUCCEEDED',
      baseCurrency: 'EUR',
      bankAccounts: [],
    },
  ]);
}

/** Answers the merchant endpoints and records each request's query. */
async function mockMerchants(page: Page) {
  const requests: URLSearchParams[] = [];
  await page.route(`${API_URL}/merchants/ranking?**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const interval = params.get('interval') as MerchantRanking['interval'];
    return fulfillJson(route, {
      ...ranking,
      interval,
      ...(interval === 'year' ? {start: '2026-01-01', end: '2026-12-31'} : {}),
      merchants: ranking.merchants.slice(0, Number(params.get('limit'))),
    });
  });
  await page.route(`${API_URL}/merchants?**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const search = params.get('search')?.toLowerCase();
    const matches = allMerchants.filter(
      (item) => !search || item.name.toLowerCase().includes(search),
    );
    const offset = Number(params.get('offset'));
    // Two per page here, so Load more is exercised without fifty fixtures.
    return fulfillJson(route, {
      baseCurrency: 'EUR',
      merchants: matches.slice(offset, offset + 2),
      total: matches.length,
    } satisfies MerchantGroupsResponse);
  });
  await page.route(`${API_URL}/merchants/${BRAND}`, (route) => fulfillJson(route, burger));
  await page.route(`${API_URL}/merchants/${PERSON}`, (route) =>
    fulfillJson(route, {message: 'Merchant not found.'}, 404),
  );
  await page.route(`${API_URL}/merchants/${BRAND}/periods?**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return fulfillJson(
      route,
      burgerPeriods(params.get('interval') as MerchantGroupPeriods['interval']),
    );
  });
  await page.route(`${API_URL}/bank-transactions?**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return fulfillJson(route, {
      transactions: [
        burgerTransaction(4),
        burgerTransaction(2, {amount: '10.00', category: 'REFUND'}),
      ],
      total: 2,
    });
  });
  await page.route(`${API_URL}/bank-transactions/${burgerTransaction(4).id}`, (route) =>
    fulfillJson(route, burgerTransaction(4)),
  );
  return requests;
}

const dialog = (page: Page) => page.getByRole('dialog', {name: 'Merchants'});

for (const viewport of [
  {width: 1280, height: 900},
  {width: 375, height: 812},
]) {
  test(`Home ranks the month's top merchants and opens them over Home at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockSignedIn(page);
    const requests = await mockMerchants(page);
    await page.goto('/');

    const card = page.getByRole('region', {name: 'Top merchants'});
    const rows = card.getByRole('listitem');
    await expect(rows).toHaveCount(5);
    expect(requests.find((params) => params.get('limit') === '5')?.toString()).toBe(
      new URLSearchParams({
        interval: 'month',
        period: '2026-10-01',
        asOf: '2026-10-18',
        limit: '5',
      }).toString(),
    );
    await expect(card).toContainText('Compared with usual by this day of the month.');
    await expect(rows.nth(0)).toContainText(LONG_NAME);
    await expect(rows.nth(0)).toContainText('1 transaction · usually nothing');
    await expect(rows.nth(0)).toContainText('€123,456.78');
    await expect(rows.nth(1)).toContainText('5 transactions · +60% vs usual');
    await expect(rows.nth(2)).toContainText('1,284 transactions · about usual');
    await expect(rows.nth(3)).toContainText('usually €12.00');
    await expect(rows.nth(4)).toHaveText(/^Jo1 transaction€0\.01$/);
    // Amounts are never truncated, however long the name.
    for (const amount of await card.locator('.numeric').all()) {
      expect(await amount.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await expectNoHorizontalOverflow(page);

    await rows.nth(1).getByRole('button').click();
    await expect(page).toHaveURL(`/?merchants=open&merchant=${BRAND}`);
    await expect(dialog(page).getByRole('heading', {name: 'Example Burger'})).toBeVisible();
    await dialog(page).getByRole('button', {name: 'All merchants'}).click();
    await expect(page).toHaveURL('/?merchants=open');
    await expect(dialog(page).getByRole('region', {name: 'All merchants'})).toBeVisible();
    await page.goBack();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL('/');

    await card.getByRole('button', {name: 'See all merchants'}).click();
    await expect(page).toHaveURL('/?merchants=open');
    await expect(dialog(page).getByRole('region', {name: 'Top merchants'})).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await dialog(page).getByRole('button', {name: 'Close merchants'}).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL('/');
  });
}

test('the merchants dialog ranks by week, month or year and searches every merchant', async ({
  page,
}) => {
  await page.setViewportSize({width: 375, height: 812});
  await mockSignedIn(page);
  const requests = await mockMerchants(page);
  await page.goto('/?merchants=open');

  const top = dialog(page).getByRole('region', {name: 'Top merchants'});
  await expect(top.getByRole('heading', {name: 'This month'})).toBeVisible();
  await expect(top).toContainText('Compared with the last 6 months by this point.');
  await expect(top.getByRole('listitem')).toHaveCount(5);
  await expect(top).toContainText('Top 5 of 7 merchants.');
  await top.getByRole('radio', {name: 'Year'}).click();
  await expect(top.getByRole('heading', {name: 'This year'})).toBeVisible();
  expect(requests.some((params) => params.get('interval') === 'year')).toBe(true);
  // Opening a merchant and coming back keeps the period.
  await top.getByRole('listitem').nth(1).getByRole('button').click();
  await dialog(page).getByRole('button', {name: 'All merchants'}).click();
  await expect(top.getByRole('radio', {name: 'Year'})).toBeChecked();

  const all = dialog(page).getByRole('region', {name: 'All merchants'});
  await expect(all).toContainText('5 merchants, most spent first');
  await expect(all.getByRole('listitem')).toHaveCount(2);
  await all.getByRole('button', {name: 'Load more'}).click();
  await expect(all.getByRole('listitem')).toHaveCount(4);
  await all.getByRole('button', {name: 'Load more'}).click();
  await expect(all.getByRole('listitem')).toHaveCount(5);
  // A group that only paid the owner shows what came in.
  await expect(all.getByRole('listitem').nth(4)).toContainText(
    'Example Employer3 transactions+€98,765.43',
  );
  await expect(all.getByRole('listitem').nth(2)).toContainText('1,284 transactions · last 12 Oct');
  await expectNoHorizontalOverflow(page);

  await dialog(page).getByRole('searchbox', {name: 'Search merchants and people'}).fill('burger');
  const results = dialog(page).getByRole('region', {name: 'Search results'});
  await expect(results).toContainText('1 match');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(top).toBeHidden();
  // Opening a result and coming back keeps the search.
  await results.getByRole('button').click();
  await expect(dialog(page).getByRole('heading', {name: 'Example Burger'})).toBeVisible();
  await dialog(page).getByRole('button', {name: 'All merchants'}).click();
  await expect(
    dialog(page).getByRole('searchbox', {name: 'Search merchants and people'}),
  ).toHaveValue('burger');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await dialog(page).getByRole('searchbox', {name: 'Search merchants and people'}).fill('nobody');
  await expect(results).toContainText('No merchant or person matches that name.');
});

test('merchant details show all-time totals, periods, grouped names and transactions', async ({
  page,
}) => {
  await page.setViewportSize({width: 375, height: 812});
  await mockSignedIn(page);
  const requests = await mockMerchants(page);
  await page.goto(`/?merchants=open&merchant=${BRAND}`);

  const details = dialog(page);
  await expect(details.getByRole('heading', {name: 'Example Burger'})).toBeVisible();
  await expect(details.getByText('2 names grouped by brand')).toBeVisible();
  await expect(details.getByText('Spent all time€310.40')).toBeVisible();
  await expect(details.getByText('€320.40 paid, €10.00 refunded')).toBeVisible();
  await expect(details.getByTestId('merchant-fact')).toHaveText([
    'Payments40',
    'Average payment€8.01',
    'Since 20 Oct 2025Last 14 Oct',
    'How oftenAbout weekly',
  ]);
  await expect(
    details.getByText('2 transactions without a converted amount or direction are not counted.'),
  ).toBeVisible();

  const overTime = details.getByRole('region', {name: 'Spending over time'});
  await expect(
    overTime.getByRole('table', {name: 'Spending per month'}).getByRole('row'),
  ).toHaveCount(4);
  await overTime.getByRole('radio', {name: 'Year'}).click();
  await expect(overTime.getByRole('table', {name: 'Spending per year'})).toContainText('2026€250');
  expect(
    requests.some(
      (params) => params.get('interval') === 'year' && params.get('to') === '2026-10-18',
    ),
  ).toBe(true);

  const grouped = details.getByRole('region', {name: 'Grouped names'});
  await expect(grouped.getByRole('listitem')).toHaveCount(2);
  await expect(grouped.getByRole('listitem').first()).toContainText('25 transactions€200.40');

  const transactions = details.getByRole('region', {name: 'Transactions'});
  await expect(transactions.getByRole('heading', {name: '2 transactions'})).toBeVisible();
  expect(requests.some((params) => params.get('filter[merchantGroup]') === BRAND)).toBe(true);
  await expectNoHorizontalOverflow(page);

  await transactions.getByRole('link', {name: 'Open in Transactions'}).click();
  await expect(page).toHaveURL(new RegExp(`/bank-transactions\\?merchantGroup=${BRAND}`));
  await expect(page.getByRole('button', {name: 'Remove filter: One merchant'})).toBeVisible();
});

for (const scenario of [
  {name: 'desktop', width: 1440, scale: 1},
  {name: 'tablet', width: 768, scale: 1},
  {name: 'phone', width: 390, scale: 1},
  {name: 'narrow phone', width: 320, scale: 1},
  {name: 'large amounts', width: 320, scale: 1, amount: '-12345678.90', currency: 'CHF'},
  {name: 'large text', width: 320, scale: 2},
]) {
  test(`transaction details open the payment history of their merchant on ${scenario.name}`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockMerchants(page);
    const transaction = burgerTransaction(4, {
      amount: scenario.amount ?? '-8.00',
      currency: scenario.currency ?? 'EUR',
    });
    await mockJson(page, `${API_URL}/bank-transactions/${transaction.id}`, transaction);
    await page.setViewportSize({width: scenario.width, height: 844});
    await page.goto(`/bank-transactions?transactionId=${transaction.id}`);

    const inspector = page.getByTestId('bank-transaction-inspector');
    const history = inspector.getByRole('link', {name: 'Payment history'});
    await expect(history).toBeVisible();
    if (scenario.scale > 1) {
      // Enlarge text without also doubling rem-based padding and icon dimensions.
      await inspector.evaluate((root, scale) => {
        const text = [...root.querySelectorAll<HTMLElement>('h2, p, span, a')].map((el) => ({
          el,
          size: parseFloat(getComputedStyle(el).fontSize),
          line: parseFloat(getComputedStyle(el).lineHeight),
        }));
        for (const {el, size, line} of text) {
          el.style.fontSize = `${size * scale}px`;
          if (Number.isFinite(line)) el.style.lineHeight = `${line * scale}px`;
        }
      }, scenario.scale);
    }
    await inspector.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({subtree: true})
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      );
    });
    const amount = inspector.getByTestId('bank-transaction-detail-amount');
    const currency = amount.locator('..').getByText(transaction.currency, {exact: true});
    const date = inspector.getByText('Oct 14, 2026', {exact: true});
    const type = inspector.getByText('Card Payment', {exact: true});
    const [amountBox, currencyBox, dateBox, typeBox, historyBox, inspectorBox] = await Promise.all(
      [amount, currency, date, type, history, inspector].map(boxOf),
    );
    expect(currencyBox.x).toBeGreaterThanOrEqual(amountBox.x + amountBox.width);
    expect(currencyBox.y).toBeLessThan(amountBox.y + amountBox.height);
    expect(dateBox.y).toBeGreaterThanOrEqual(amountBox.y + amountBox.height);
    if (scenario.scale === 1) expect(Math.abs(dateBox.y - typeBox.y)).toBeLessThan(1);
    if (scenario.width >= 768) {
      expect(historyBox.x).toBeGreaterThan(amountBox.x + amountBox.width);
      expect(historyBox.y).toBeLessThan(dateBox.y);
    } else {
      expect(historyBox.y).toBeGreaterThanOrEqual(
        Math.max(dateBox.y + dateBox.height, typeBox.y + typeBox.height),
      );
      expect(historyBox.height).toBeGreaterThanOrEqual(44);
    }
    for (const locator of [amount, currency, date, type, history]) {
      await expect(locator).toBeInViewport();
      const box = await boxOf(locator);
      expect(box.x).toBeGreaterThanOrEqual(inspectorBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(inspectorBox.x + inspectorBox.width);
      expect(await locator.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    const font = await amount.evaluate((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(font.size).toBeGreaterThanOrEqual(font.root * 1.875);
    if (scenario.amount) await expect(amount).toContainText('12,345,678.90');
    await expectNoHorizontalOverflow(page);
    if (scenario.scale > 1) {
      await history.focus();
      await page.keyboard.press('Enter');
    } else {
      await history.click();
    }
    await expect(page).toHaveURL(`/?merchants=open&merchant=${BRAND}`);
    await expect(dialog(page).getByRole('heading', {name: 'Example Burger'})).toBeVisible();
    // Closing returns to the transaction it was opened from.
    await dialog(page).getByRole('button', {name: 'Close merchants'}).click();
    await expect(page).toHaveURL(new RegExp(`transactionId=${transaction.id}`));
  });
}

test('a merchant without transactions shows not found', async ({page}) => {
  await mockSignedIn(page);
  await mockMerchants(page);
  await page.goto(`/?merchants=open&merchant=${PERSON}`);
  await expect(dialog(page).getByRole('heading', {name: 'Merchant not found'})).toBeVisible();
  await dialog(page).getByRole('button', {name: 'All merchants'}).click();
  await expect(dialog(page).getByRole('region', {name: 'All merchants'})).toBeVisible();
});

test('an invalid merchant id in the link opens the list', async ({page}) => {
  await mockSignedIn(page);
  await mockMerchants(page);
  await page.goto('/?merchants=open&merchant=not-a-merchant');
  await expect(dialog(page).getByRole('region', {name: 'All merchants'})).toBeVisible();
});
