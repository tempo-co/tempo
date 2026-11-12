import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {
  AFTER_SEEDED_TRANSACTION_YEAR_NOW,
  SEEDED_TRANSACTION_YEAR_NOW,
} from '../../constants/seed.constants';
import {expect, test} from '../../fixtures';
import {
  fulfillJson,
  mockBankRefresh,
  mockJson,
  transformBankConnections,
} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';
import {openTransactionFilter} from '../../utils/transaction-filters';

const DETAIL_TRANSACTION_ID = '00000000-0000-4000-8000-000000000011';

test.describe('bank transactions', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('renders, searches, and opens the transaction detail inspector', async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions');

    const firstTransactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});

    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect(page.getByTestId('bank-transactions-summary')).toHaveText(/^\d+ transactions$/);
    // Rows sit under their day, this year's without the year.
    const day = page.getByRole('region', {name: 'Wednesday 26 August', exact: true});
    await expect(day.getByRole('heading', {name: 'Wednesday 26 August'})).toBeVisible();
    await expect(day.getByTestId(/^bank-transaction-row-/)).toContainText(['Coffee shop']);
    await expect(firstTransactionRow.getByTestId('ledger-row-category')).toHaveText(
      'Categorizing…',
    );
    // With one account the rows name no account.
    await expect(firstTransactionRow.getByTestId('ledger-row-account')).toHaveCount(0);

    await page.getByTestId('bank-transactions-search').fill('does not exist');
    await expect(page.getByRole('heading', {name: 'No matching transactions'})).toBeVisible();
    await expect(page.getByText('Nothing matches “does not exist”.')).toBeVisible();
    await expect(page.getByTestId('bank-transactions-summary')).toHaveText('0 transactions');

    await page.getByRole('button', {name: 'Clear filters'}).click();
    await expect(page.getByText('Coffee shop')).toBeVisible();

    await firstTransactionRow.click({position: {x: 8, y: 8}});
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(page).toHaveURL(/\/bank-transactions(?:\?.*)?$/);
    const openedUrl = new URL(page.url());
    expect(openedUrl.searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Coffee shop'})).toBeVisible();
    await expect(inspector.getByTestId('bank-transaction-detail-amount')).toHaveText('-€4.50');
    await expect(inspector.getByRole('region', {name: 'Account', exact: true})).toContainText(
      'Daily spending',
    );
    await expect(inspector.getByText('Card Payment', {exact: true})).toBeVisible();
    const bankDetails = inspector.getByRole('button', {name: 'Bank details', exact: true});
    await expect(bankDetails).toHaveAttribute('aria-expanded', 'false');
    await expect(inspector.getByText('Original description', {exact: true})).toBeHidden();
    await bankDetails.click();
    await expect(bankDetails).toHaveAttribute('aria-expanded', 'true');
    const transactionDetails = inspector.getByTestId('bank-details-fold');
    const descriptionDetail = transactionDetails
      .getByText('Original description', {exact: true})
      .locator('..');
    await expect(descriptionDetail).toContainText('Coffee shop');
    await expect(transactionDetails.getByText('Merchant category code')).toBeVisible();
    await expect(transactionDetails.getByText('Transaction date')).toBeVisible();
    await expect(transactionDetails.getByText('Provider classification')).toBeVisible();
    await expect(inspector.getByText('100.50 EUR')).toBeVisible();
    await expect(inspector.getByText('4.50 USD')).toBeVisible();
    await expect(inspector.getByText('1 USD ≈ 0.9234 EUR (SPOT)', {exact: true})).toBeVisible();
    await expect(
      inspector.getByText('0.923400000000000000 USD (SPOT)', {exact: true}),
    ).not.toBeVisible();
    await expect(inspector.getByText('reference-coffee (RF)')).toBeVisible();
    await expect(inspector.getByTestId('bank-transaction-category-control')).toBeVisible();
    await expect(inspector.getByTestId('bank-transaction-category-status')).toHaveText(
      'Categorizing…',
    );

    const closeButton = inspector.getByRole('button', {name: 'Close transaction details'});
    await closeButton.click();
    await expect(inspector).toBeHidden();
    expect(new URL(page.url()).searchParams.has('transactionId')).toBe(false);
  });

  test('renders currency exchanges as internal activity rather than categories', async ({page}) => {
    let exchangeTransaction: Record<string, unknown> | undefined;

    await page.route('**/bank-transactions/currency-exchange-fixture', async (route) => {
      if (!exchangeTransaction) {
        await route.continue();
        return;
      }
      await fulfillJson(route, exchangeTransaction);
    });

    await page.route('**/bank-transactions?*', async (route) => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }
      const url = new URL(route.request().url());

      if (url.searchParams.get('filter[cashFlows][]') === 'CURRENCY_EXCHANGE') {
        const pageIndex = url.searchParams.get('pagination[pageIndex]');
        await fulfillJson(route, {
          transactions: pageIndex === '0' ? [exchangeTransaction] : [],
          total: 1,
        });
        return;
      }

      const response = await route.fetch();
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
        total: number;
      };
      const existingExchangeTransaction = payload.transactions.find(
        (transaction) => transaction.financialEventType === 'CURRENCY_EXCHANGE',
      );
      exchangeTransaction = existingExchangeTransaction ?? {
        ...payload.transactions[0],
        id: 'currency-exchange-fixture',
        description: 'Exchanged to GBP',
        displayDescription: 'Exchanged to GBP',
        amount: '-10.00000000',
        currency: 'EUR',
        creditDebitIndicator: 'DBIT',
        direction: 'EXPENSE',
        category: null,
        categoryStatus: 'NOT_APPLICABLE',
        categorySource: null,
        financialEventType: 'CURRENCY_EXCHANGE',
        financialEventSource: 'RULE',
        financialEventRuleVersion: 'provider-currency-exchange-v1',
        cashFlowTreatment: 'INTERNAL',
        exchangeRate: null,
        instructedAmount: null,
        instructedCurrency: null,
      };
      const shouldInjectExchange = url.searchParams.get('pagination[pageIndex]') === '0';
      await route.fulfill({
        response,
        json: {
          ...payload,
          transactions:
            existingExchangeTransaction || !shouldInjectExchange
              ? payload.transactions
              : [exchangeTransaction, ...payload.transactions],
          total: existingExchangeTransaction ? payload.total : payload.total + 1,
        },
      });
    });

    await page.goto('/bank-transactions');

    const exchangeRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Currency exchange'});
    await expect(exchangeRow).toHaveCount(1);
    await expect(exchangeRow.getByTestId('ledger-row-category')).toHaveText('Currency exchange');

    await exchangeRow
      .getByRole('button', {name: 'View Exchanged to GBP transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Currency exchange', {exact: true}).first()).toBeVisible();
    const movement = inspector.getByRole('region', {name: 'Money movement'});
    await expect(movement.getByRole('heading', {name: 'One currency to another'})).toBeVisible();
    await expect(movement).toContainText('Excluded from income and spending');
    await expect(inspector.getByRole('combobox', {name: 'Transaction category'})).toHaveCount(0);
    await expect(movement.getByText('Exchange rate unavailable', {exact: true})).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();

    const filters = await openTransactionFilter(page, 'Cash flow');
    const activityOption = filters.getByRole('option', {name: 'Currency exchange', exact: true});
    await expect(activityOption).toHaveAttribute('data-filter-selected', 'false');
    await activityOption.click();
    await expect(activityOption).toHaveAttribute('data-filter-selected', 'true');
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Currency exchange'}),
    ).toHaveCount(1);
    await expect(filters.getByRole('tab', {name: 'Cash flow Currency exchange'})).toBeVisible();
    await page.keyboard.press('Escape');

    // Shared links that use the financialEventTypes parameter filter the same rows; their page keys are dropped.
    await page.goto(
      '/bank-transactions?pageIndex=1&pageSize=10&financialEventTypes=%5B%22CURRENCY_EXCHANGE%22%5D',
    );
    const chip = page.getByRole('button', {name: 'Remove filter: Currency exchange', exact: true});
    await expect(chip).toBeVisible();
    await expect(page).not.toHaveURL(/pageIndex|pageSize|financialEventTypes/);
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await chip.click();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/cashFlows/);

    await page.goto('/bank-transactions?financialEventTypes=%5B%22CURRENCY_EXCHANGE%22%5D');
    await openTransactionFilter(page, 'Cash flow');
    await page.getByRole('button', {name: 'Reset Cash flow', exact: true}).click();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/cashFlows/);

    await page.goto('/bank-transactions');
    await openTransactionFilter(page, 'Cash flow');
    await page.getByRole('option', {name: 'Currency exchange', exact: true}).click();
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.goBack();
    await expect(page.getByTestId('bank-transaction-filters-trigger')).toBeVisible();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();

    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');
    const sheet = await openTransactionFilter(page, 'Cash flow');
    await sheet.getByRole('option', {name: 'Currency exchange', exact: true}).click();
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await expect(page.getByTestId('ledger-row-meta')).toHaveText('Currency exchange');
  });

  test('classifies a transaction from the detail inspector', async ({page}) => {
    // Only this test changes a category, and only on this seeded transaction, so no other test
    // depends on it. Picking a category the row does not have yet keeps the test retry-safe.
    const transactionName = 'Extra transaction 1';
    await page.goto('/bank-transactions');
    const transactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: transactionName});
    const rowCategory = transactionRow.getByTestId('ledger-row-category');
    await expect(rowCategory).toBeVisible();
    const currentCategory = await rowCategory.textContent();
    const target = currentCategory?.includes('Food and drink')
      ? {name: 'Shopping', className: /text-category-shopping/, icon: 'svg.lucide-shopping-bag'}
      : {
          name: 'Food and drink',
          className: /text-category-food-and-drink/,
          icon: 'svg.lucide-utensils',
        };

    await transactionRow
      .getByRole('button', {name: `View ${transactionName} transaction details`})
      .click();

    const inspector = page.getByTestId('bank-transaction-inspector');
    const categorySelect = inspector.getByRole('combobox', {name: 'Transaction category'});
    await expect(categorySelect).toBeVisible();
    await categorySelect.click();
    await expect(page.getByRole('option')).toHaveCount(19);
    await expect(page.getByRole('option')).toHaveText([
      'Housing and utilities',
      'Food and drink',
      'Transportation',
      'Shopping',
      'Subscriptions',
      'Health',
      'Travel',
      'Entertainment',
      'Personal care',
      'Education',
      'Insurance',
      'Fees',
      'Cash withdrawal',
      'Income',
      'Refund',
      'Transfer in',
      'Transfer out',
      'Needs review',
      'Other',
    ]);
    // Every option has a category icon; the selected one also shows a check mark.
    await expect(page.getByRole('option').filter({has: page.locator('svg')})).toHaveCount(19);
    const targetOption = page.getByRole('option', {name: target.name, exact: true});
    await expect(targetOption.locator('svg').locator('..')).toHaveClass(target.className);
    await targetOption.click();

    await expect(categorySelect).toHaveText(target.name);
    await expect(categorySelect.locator(target.icon).locator('..')).toHaveClass(target.className);
    await expect(inspector.getByTestId('bank-transaction-category-status')).toHaveText('Manual');

    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(rowCategory).toHaveText(target.name);
    await expect(rowCategory.locator('svg').locator('..')).toHaveClass(target.className);
    await transactionRow
      .getByRole('button', {name: `View ${transactionName} transaction details`})
      .click();
    await expect(inspector).toBeVisible();
    await expect(categorySelect).toHaveText(target.name);
    await expect(inspector.getByTestId('bank-transaction-category-status')).toHaveText('Manual');
  });

  test('does not show the bank account filter when there is one account', async ({page}) => {
    await page.goto('/bank-transactions');
    const filters = await openTransactionFilter(page, 'Categories');

    await expect(filters.getByRole('tab', {name: /^Cash flow/})).toBeVisible();
    await expect(filters.getByRole('tab', {name: /^Bank accounts/})).toHaveCount(0);
  });

  test('does not count inactive accounts when deciding whether to show the filter', async ({
    page,
  }) => {
    await transformBankConnections(page, (connections) =>
      connections.map((connection) => ({
        ...connection,
        bankAccounts: connection.bankAccounts.map((account) => ({...account, isActive: false})),
      })),
    );

    await page.goto('/bank-transactions');
    const filters = await openTransactionFilter(page, 'Categories');

    await expect(filters.getByRole('tab', {name: /^Cash flow/})).toBeVisible();
    await expect(filters.getByRole('tab', {name: /^Bank accounts/})).toHaveCount(0);
  });

  test('says in the filters when bank accounts cannot be loaded', async ({page}) => {
    // The connections request is retried before it counts as failed.
    test.slow();
    await mockJson(page, '**/bank-connections', {message: 'bank connections unavailable'}, 500);

    await page.goto('/bank-transactions');
    const filters = await openTransactionFilter(page, 'Bank accounts');
    await expect(filters.getByRole('tabpanel', {name: 'Bank accounts'})).toHaveText(
      'Bank accounts are unavailable.',
      {timeout: 15_000},
    );
  });

  test('uses concise display descriptions while keeping raw descriptions in details', async ({
    page,
  }) => {
    const googlePayDescription =
      'BEA, Google Pay Synthetic Market,PAS998 NR:TEST01, 01.01.30/10:00 SAMPLE';
    const sepaIdealDescription =
      'SEPA iDEAL/Wero IBAN: NL00BANK00000000000000 BIC: BANKNL2A Naam: Synthetic Shop Omschrijving: order-123 Kenmerk: 01-01-2030 10:00';
    const sepaTransferDescription =
      'SEPA Overboeking IBAN: GB00BANK00000000000000 BIC: BANKGB21 Naam: Synthetic Recipient Kenmerk: NOTPROVIDED';
    const regularCardDescription = 'BEA, Synthetic Cafe,PAS997 NR:123456, 02.01.30/11:00 SAMPLE';
    const atmCardDescription =
      'GEA, Betaalpas *Synthetic Bank,PAS998 NR:00000001, 03.01.30/12:00 SAMPLE-ATM1, Land: BEL';
    const unrelatedGooglePayDescription =
      'Transfer note: Google Pay shared dinner reimbursement for September';
    const ordinaryNaamDescription = 'Payment note: Naam: not a structured counterparty label';
    const longUnstructuredDescription =
      'A long bank description without a provider-specific structure that should use the available counterparty label';

    await page.route('**/bank-transactions?*', async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
      };
      payload.transactions[0] = {
        ...payload.transactions[0],
        description: googlePayDescription,
        displayDescription: 'Synthetic Market,PAS998',
        counterpartyName: null,
      };
      payload.transactions[1] = {
        ...payload.transactions[1],
        description: sepaIdealDescription,
        displayDescription: 'Synthetic Shop',
        counterpartyName: 'Synthetic Shop',
      };
      payload.transactions[2] = {
        ...payload.transactions[2],
        description: sepaTransferDescription,
        displayDescription: 'Synthetic Recipient',
        counterpartyName: null,
      };
      payload.transactions[3] = {
        ...payload.transactions[3],
        description: regularCardDescription,
        displayDescription: 'Synthetic Cafe,PAS997',
        counterpartyName: null,
      };
      payload.transactions[4] = {
        ...payload.transactions[4],
        description: longUnstructuredDescription,
        displayDescription: 'Synthetic Counterparty',
        counterpartyName: 'Synthetic Counterparty',
      };
      payload.transactions[5] = {
        ...payload.transactions[5],
        description: atmCardDescription,
        displayDescription: 'Betaalpas *Synthetic Bank,PAS998',
        counterpartyName: null,
      };
      const transactionWithoutDisplayDescription = {...payload.transactions[6]};
      delete transactionWithoutDisplayDescription.displayDescription;
      payload.transactions[6] = {
        ...transactionWithoutDisplayDescription,
        description: unrelatedGooglePayDescription,
        counterpartyName: null,
      };
      payload.transactions[7] = {
        ...payload.transactions[7],
        description: ordinaryNaamDescription,
        displayDescription: 'API-provided ordinary title',
        counterpartyName: null,
      };
      await route.fulfill({response, json: payload});
    });
    await page.route(`**/bank-transactions/${DETAIL_TRANSACTION_ID}`, async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...payload,
          description: googlePayDescription,
          displayDescription: 'API detail title',
          counterpartyName: null,
        },
      });
    });

    await page.goto('/bank-transactions');

    const rows = page.getByTestId(/^bank-transaction-row-/);
    await expect(rows.nth(0).getByText('Synthetic Market,PAS998', {exact: true})).toBeVisible();
    await expect(rows.nth(1).getByText('Synthetic Shop', {exact: true})).toBeVisible();
    await expect(rows.nth(2).getByText('Synthetic Recipient', {exact: true})).toBeVisible();
    await expect(rows.nth(3).getByText('Synthetic Cafe,PAS997', {exact: true})).toBeVisible();
    await expect(rows.nth(4).getByText('Synthetic Counterparty', {exact: true})).toBeVisible();
    await expect(
      rows.nth(5).getByText('Betaalpas *Synthetic Bank,PAS998', {exact: true}),
    ).toBeVisible();
    await expect(rows.nth(6).getByText(unrelatedGooglePayDescription, {exact: true})).toBeVisible();
    await expect(rows.nth(7).getByText('API-provided ordinary title', {exact: true})).toBeVisible();
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(
      googlePayDescription,
    );
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(
      sepaIdealDescription,
    );
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(
      sepaTransferDescription,
    );
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(
      regularCardDescription,
    );
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(
      longUnstructuredDescription,
    );
    await expect(page.getByTestId('bank-transaction-ledger')).not.toContainText(atmCardDescription);

    await rows
      .nth(0)
      .getByRole('button', {name: 'View Synthetic Market,PAS998 transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector.getByRole('heading', {name: 'API detail title'})).toBeVisible();
    await inspector.getByRole('button', {name: 'Bank details', exact: true}).click();
    await expect(inspector.getByText(googlePayDescription, {exact: true})).toBeVisible();
  });

  test('reopens a transaction inspector from the list and its shareable URL', async ({page}) => {
    await page.goto('/bank-transactions');

    const transactionTrigger = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'})
      .getByRole('button', {name: 'View Coffee shop transaction details'});
    await transactionTrigger.click();

    const sharedUrl = page.url();
    expect(new URL(sharedUrl).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);

    // Wait until the opened transaction is saved for offline use, then change it on the server: after
    // a reload the inspector shows the transaction as Tempo has it now, not the saved copy.
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            localStorage.getItem('tempo-offline-cache')?.includes(`["bank-transaction","${id}"]`),
          DETAIL_TRANSACTION_ID,
        ),
      )
      .toBe(true);
    let serverTitle = 'Corner bakery';
    await page.route(`**/bank-transactions/${DETAIL_TRANSACTION_ID}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as object;
      await route.fulfill({response, json: {...body, displayDescription: serverTitle}});
    });

    await page.goto('/bank-transactions');
    await transactionTrigger.click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector.getByRole('heading', {name: 'Corner bakery'})).toBeVisible();

    serverTitle = 'Harbour kiosk';
    await page.goto(sharedUrl);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Harbour kiosk'})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
  });

  test('presents transaction detail in a responsive inspector', async ({page}) => {
    test.slow();
    await mockBankRefresh(page);
    for (const viewport of [
      {width: 1440, height: 900},
      {width: 393, height: 852},
      {width: 320, height: 852},
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/bank-transactions');

      const firstTransactionRow = page
        .getByTestId(/^bank-transaction-row-/)
        .filter({hasText: 'Coffee shop'});
      const descriptionTrigger = firstTransactionRow.getByRole('button', {
        name: 'View Coffee shop transaction details',
      });
      await descriptionTrigger.click();

      const inspector = page.getByTestId('bank-transaction-inspector');
      await expect(inspector).toBeVisible();
      expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
      expect((await inspector.getAttribute('data-vaul-drawer')) !== null).toBe(
        viewport.width < 768,
      );
      await expect(inspector.getByRole('heading', {name: 'Coffee shop'})).toBeVisible();
      await expect(inspector.getByRole('region', {name: 'Category', exact: true})).toBeVisible();
      await expect(inspector.getByRole('region', {name: 'Account', exact: true})).toContainText(
        'Daily spending',
      );
      const bankDetails = inspector.getByRole('button', {name: 'Bank details', exact: true});
      await expect(bankDetails).toHaveAttribute('aria-expanded', 'false');
      await bankDetails.click();
      await expect(bankDetails).toHaveAttribute('aria-expanded', 'true');
      await expect(inspector.getByText('Original description', {exact: true})).toBeVisible();
      await expect(inspector.getByText('Transaction date', {exact: true})).toBeVisible();
      const amount = inspector.getByTestId('bank-transaction-detail-amount');
      const currency = amount.locator('..').getByText('EUR', {exact: true});
      await expect(amount).toBeVisible();
      await expect(currency).toHaveText('EUR');
      const [amountBox, currencyBox] = await Promise.all([boxOf(amount), boxOf(currency)]);
      expect(currencyBox.x).toBeGreaterThan(amountBox.x + amountBox.width);
      expect(currencyBox.y).toBeLessThan(amountBox.y + amountBox.height);
      expect(currencyBox.y + currencyBox.height).toBeGreaterThan(amountBox.y);

      const bankDetailsFields = inspector.getByTestId('bank-details-fold').locator('dl');
      const detailColumns = await bankDetailsFields.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
      );
      expect(detailColumns).toBe(viewport.width < 640 ? 1 : 2);
      await expectNoHorizontalOverflow(page);

      const inspectorBox = await boxOf(inspector);
      expect(inspectorBox.width).toBeLessThanOrEqual(viewport.width);
      const inspectorBody = inspector.getByTestId('bank-transaction-inspector-body');
      const inspectorViewport = inspectorBody.locator('[data-radix-scroll-area-viewport]');
      await expect(inspectorViewport).toHaveCount(1);
      expect(await inspectorViewport.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
        await inspectorViewport.evaluate((element) => element.clientHeight),
      );
      const title = inspector.getByRole('heading', {name: 'Coffee shop', exact: true});
      const titleBeforeScroll = await boxOf(title);
      const amountBeforeScroll = await boxOf(amount);
      await inspectorViewport.hover();
      await page.mouse.wheel(0, 500);
      await expect
        .poll(() => inspectorViewport.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect((await boxOf(title)).y).toBeCloseTo(titleBeforeScroll.y, 0);
      expect((await boxOf(amount)).y).toBeCloseTo(amountBeforeScroll.y, 0);
      await expect(
        inspector.getByRole('button', {name: 'Transfer settings', exact: true}),
      ).toBeVisible();

      const closeButton = inspector.getByRole('button', {name: 'Close transaction details'});
      await closeButton.click();
      await expect(inspector).toBeHidden();
      await expect(descriptionTrigger).toBeFocused();
    }
  });

  test('shows a retryable error state inside the transaction inspector', async ({page}) => {
    await mockJson(
      page,
      `**/bank-transactions/${DETAIL_TRANSACTION_ID}`,
      {message: 'Synthetic detail failure'},
      500,
    );
    await page.goto('/bank-transactions');

    const transactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});
    await transactionRow
      .getByRole('button', {name: 'View Coffee shop transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(
      inspector.getByRole('heading', {name: "Couldn't load this transaction"}),
    ).toBeVisible();
    await expect(inspector.getByRole('button', {name: 'Try again'})).toBeVisible();
  });

  test('explains when a transaction no longer exists', async ({page}) => {
    await mockJson(
      page,
      `**/bank-transactions/${DETAIL_TRANSACTION_ID}`,
      {message: 'Transaction not found'},
      404,
    );
    await page.goto('/bank-transactions');

    const transactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});
    await transactionRow
      .getByRole('button', {name: 'View Coffee shop transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector.getByRole('heading', {name: 'Transaction not found'})).toBeVisible();
    await expect(inspector.getByRole('button', {name: 'Close transaction details'})).toBeVisible();
  });

  test('filters seeded transactions by bank account and booking date', async ({page}) => {
    await transformBankConnections(page, (connections) => {
      const firstConnection = connections[0];
      firstConnection.bankAccounts = [
        ...firstConnection.bankAccounts,
        {
          ...firstConnection.bankAccounts[0],
          id: '00000000-0000-4000-8000-000000000097',
          name: 'Secondary account',
          alias: 'Secondary spending',
        },
      ];
      return connections;
    });
    await page.goto('/bank-transactions');

    await openTransactionFilter(page, 'Bank accounts');
    await expect(page.getByRole('option', {name: /Daily spending/})).toBeVisible();
    await page.getByRole('option', {name: /Daily spending/}).click();
    await expect(page).toHaveURL(/bankAccountIds/);
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', {name: 'Booking date'}).first().click();
    for (let monthIndex = 0; monthIndex < 24; monthIndex += 1) {
      if (await page.getByText('August 2026', {exact: true}).isVisible()) break;
      await page.getByRole('button', {name: 'Go to previous month'}).click();
    }
    await page.getByRole('dialog').getByRole('gridcell', {name: '26'}).last().click();

    await expect(page).toHaveURL(/bookingDate/);
    await expect(page.getByText('Coffee shop')).toBeVisible();
    await expect(page.getByText('Provider purchase')).not.toBeVisible();
  });

  test('picks booking dates from quick ranges and the month and year dropdowns', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions');

    const trigger = page.getByRole('button', {name: /^Booking date/}).first();
    await trigger.click();
    const quickRanges = page.getByRole('group', {name: 'Quick ranges'});
    await quickRanges.getByRole('button', {name: 'Last year'}).click();

    const lastYear = new Date().getFullYear() - 1;
    await expect(page).toHaveURL(/bookingDate/);
    await expect(trigger).toHaveAccessibleName(
      `Booking date: Jan 01, ${lastYear} - Dec 31, ${lastYear}`,
    );
    await expect(quickRanges.getByRole('button', {name: 'Last year'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('combobox', {name: 'Year:'})).toHaveValue(String(lastYear));

    const targetYear = lastYear - 2;
    await page.getByRole('combobox', {name: 'Year:'}).selectOption(String(targetYear));
    await page.getByRole('combobox', {name: 'Month:'}).selectOption({label: 'March'});
    await expect(page.getByText(`March ${targetYear}`, {exact: true})).toBeAttached();
    await page.getByRole('gridcell', {name: '10', exact: true}).click();
    await page.getByRole('gridcell', {name: '20', exact: true}).click();

    await expect(trigger).toHaveAccessibleName(
      `Booking date: Mar 10, ${targetYear} - Mar 20, ${targetYear}`,
    );
    await expect(quickRanges.getByRole('button', {name: 'Last year'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('filters transactions by one or multiple categories', async ({page}) => {
    await page.route('**/bank-transactions?*', async (route) => {
      const requestUrl = new URL(route.request().url());
      const categoryValues = requestUrl.searchParams.getAll('filter[categories][]');
      const categorySourceValues = requestUrl.searchParams.getAll('filter[categorySources][]');
      if (categoryValues.length === 0 && categorySourceValues.length === 0) {
        await route.continue();
        return;
      }
      requestUrl.searchParams.delete('filter[categories][]');
      requestUrl.searchParams.delete('filter[categorySources][]');
      const response = await route.fetch({url: requestUrl.toString()});
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
        total: number;
      };
      const categorizedTransactions = [
        ...payload.transactions.map((transaction, index) => ({
          ...transaction,
          category: index === 0 ? 'FOOD_AND_DRINK' : index === 1 ? 'SHOPPING' : 'NEEDS_REVIEW',
          categoryStatus: 'COMPLETED',
          categorySource: index === 0 ? 'MANUAL' : index === 1 ? 'HISTORY' : 'AI',
        })),
        {
          ...payload.transactions[payload.transactions.length - 1],
          id: '00000000-0000-4000-8000-000000000099',
          description: 'Uncategorized purchase',
          displayDescription: 'Uncategorized purchase',
          category: null,
          categoryStatus: 'PENDING',
          categorySource: null,
        },
      ];
      const transactions =
        categoryValues.length > 0
          ? categorizedTransactions.filter((transaction) =>
              categoryValues.includes(
                transaction.category === null ? 'UNCATEGORIZED' : String(transaction.category),
              ),
            )
          : categorizedTransactions;
      const sourceFilteredTransactions =
        categorySourceValues.length > 0
          ? transactions.filter((transaction) =>
              categorySourceValues.includes(String(transaction.categorySource)),
            )
          : transactions;

      await route.fulfill({
        response,
        json: {
          ...payload,
          transactions: sourceFilteredTransactions,
          total: sourceFilteredTransactions.length,
        },
      });
    });
    await page.goto('/bank-transactions');

    const filters = await openTransactionFilter(page, 'Categories');
    await expect(filters.getByRole('option')).toHaveCount(20);
    await page.getByRole('option', {name: 'Food and drink', exact: true}).click();

    const singleCategoryParam = new URL(page.url()).searchParams.get('categories');
    expect(singleCategoryParam).not.toBeNull();
    expect(JSON.parse(singleCategoryParam!)).toEqual(['FOOD_AND_DRINK']);
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();
    await expect(page.getByText('Salary', {exact: true})).not.toBeVisible();

    const shoppingOption = page.getByRole('option', {name: 'Shopping', exact: true});
    await expect(shoppingOption).toHaveAttribute('aria-selected', 'false');
    await shoppingOption.click();

    const multipleCategoryParam = new URL(page.url()).searchParams.get('categories');
    expect(multipleCategoryParam).not.toBeNull();
    expect(JSON.parse(multipleCategoryParam!)).toEqual(['FOOD_AND_DRINK', 'SHOPPING']);
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Salary'}),
    ).toBeVisible();

    await page.getByRole('option', {name: 'Needs review', exact: true}).click();
    const categoryWithNeedsReviewParam = new URL(page.url()).searchParams.get('categories');
    expect(categoryWithNeedsReviewParam).not.toBeNull();
    expect(JSON.parse(categoryWithNeedsReviewParam!)).toEqual([
      'FOOD_AND_DRINK',
      'SHOPPING',
      'NEEDS_REVIEW',
    ]);
    const reviewRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Provider purchase'});
    await expect(reviewRow).toContainText('Needs review');

    await page.getByRole('option', {name: 'Not categorized', exact: true}).click();
    const categoryWithUncategorizedParam = new URL(page.url()).searchParams.get('categories');
    expect(categoryWithUncategorizedParam).not.toBeNull();
    expect(JSON.parse(categoryWithUncategorizedParam!)).toEqual([
      'FOOD_AND_DRINK',
      'SHOPPING',
      'NEEDS_REVIEW',
      'UNCATEGORIZED',
    ]);
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Salary'}),
    ).toBeVisible();
    await expect(page.getByText('Uncategorized purchase', {exact: true})).toBeVisible();

    await expect(
      filters.getByRole('tab', {name: 'Categories 4 categories', exact: true}),
    ).toBeVisible();
    // Reset sits in the panel's fixed footer: in view with the options scrolled to the top, beside Clear all.
    const resetCategories = filters.getByRole('button', {name: 'Reset Categories', exact: true});
    await expect(resetCategories).toBeInViewport();
    // Outside the scrolling options, so it never sits at the end of the list.
    expect(
      await resetCategories.evaluate((button) =>
        Boolean(button.closest('[data-radix-scroll-area-viewport]')),
      ),
    ).toBe(false);
    const [resetBox, clearBox] = await Promise.all([
      boxOf(resetCategories),
      boxOf(filters.getByRole('button', {name: 'Clear all', exact: true})),
    ]);
    expect(resetBox.y).toBeCloseTo(clearBox.y, 0);
    await expect(filters.getByRole('option', {name: 'Reset'})).toHaveCount(0);
    await resetCategories.click();
    await expect(page).not.toHaveURL(/categories=/);
    await expect(resetCategories).toHaveCount(0);
    await openTransactionFilter(page, 'Category source');
    await expect(filters.getByRole('option')).toHaveCount(3);
    await page.getByRole('option', {name: 'Manual', exact: true}).click();

    const manualSourceParam = new URL(page.url()).searchParams.get('categorySources');
    expect(manualSourceParam).not.toBeNull();
    expect(JSON.parse(manualSourceParam!)).toEqual(['MANUAL']);
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();
    await expect(page.getByText('Salary', {exact: true})).not.toBeVisible();

    await page.getByRole('option', {name: 'Manual', exact: true}).click();
    await page.getByRole('option', {name: 'From your history', exact: true}).click();
    const historySourceParam = new URL(page.url()).searchParams.get('categorySources');
    expect(historySourceParam).not.toBeNull();
    expect(JSON.parse(historySourceParam!)).toEqual(['HISTORY']);
    await expect(page.getByText('Salary', {exact: true})).toBeVisible();
    await expect(page.getByText('Coffee shop', {exact: true})).not.toBeVisible();

    await filters.getByRole('button', {name: 'Clear all', exact: true}).click();
    const clearedUrl = new URL(page.url());
    expect(clearedUrl.searchParams.has('categories')).toBe(false);
    expect(clearedUrl.searchParams.has('categorySources')).toBe(false);
    await expect(page.getByText('Salary', {exact: true})).toBeVisible();
    await page.unrouteAll({behavior: 'ignoreErrors'});
  });

  test('filters from the phone sheet one filter at a time and clears all values', async ({
    page,
  }) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');

    await page.getByTestId('bank-transaction-filters-trigger').click();
    const sheet = page.getByTestId('bank-transaction-filters');
    await expect(sheet.getByRole('heading', {name: 'Filters', exact: true})).toBeVisible();
    await sheet.evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
    const listHeight = (await boxOf(sheet)).height;
    // Phones have no date control of their own, so the date is the sheet's first filter; each names its values.
    const facets = sheet.getByRole('list').getByRole('button');
    await expect(facets).toHaveText([
      /^Booking dateAny/,
      /^CategoriesAny/,
      /^Cash flowAny/,
      /^Category sourceAny/,
      /^Amount in EURAny/,
    ]);
    for (const facet of await facets.all()) {
      expect((await boxOf(facet)).height).toBeGreaterThanOrEqual(44);
    }

    await facets.filter({hasText: 'Categories'}).click();
    await expect(sheet.getByRole('heading', {name: 'Categories', exact: true})).toBeVisible();
    // Every step keeps the sheet's height, and the options are finger-sized.
    expect((await boxOf(sheet)).height).toBeCloseTo(listHeight, 0);
    const notCategorized = sheet.getByRole('option', {name: 'Not categorized', exact: true});
    expect((await boxOf(notCategorized)).height).toBeGreaterThanOrEqual(44);
    await notCategorized.click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categories')!)).toEqual([
      'UNCATEGORIZED',
    ]);
    await sheet.getByRole('option', {name: 'Needs review', exact: true}).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categories')!)).toEqual([
      'UNCATEGORIZED',
      'NEEDS_REVIEW',
    ]);
    await sheet.getByRole('button', {name: 'Back to filters'}).click();
    await expect(facets.filter({hasText: 'Categories'})).toContainText(
      'Not categorized, Needs review',
    );

    // The list step has no Reset; a filter's own step has one in the fixed footer, beside Clear all.
    await expect(sheet.getByRole('button', {name: /^Reset /})).toHaveCount(0);
    await openTransactionFilter(page, 'Category source');
    const resetSource = sheet.getByRole('button', {name: 'Reset Category source', exact: true});
    await expect(resetSource).toHaveCount(0);
    await sheet.getByRole('option', {name: 'Manual', exact: true}).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categorySources')!)).toEqual([
      'MANUAL',
    ]);
    await expect(resetSource).toBeInViewport();
    expect(
      await resetSource.evaluate((button) =>
        Boolean(button.closest('[data-radix-scroll-area-viewport]')),
      ),
    ).toBe(false);
    await resetSource.click();
    await expect(page).not.toHaveURL(/categorySources=/);
    await expect(resetSource).toHaveCount(0);
    await sheet.getByRole('option', {name: 'Manual', exact: true}).click();
    await expect(page).toHaveURL(/categorySources=/);
    await expect(
      page.getByTestId('bank-transaction-filters-trigger').getByText('2', {exact: true}),
    ).toBeVisible();

    // The booking date lives in the sheet on phones; its Reset is the footer's too.
    await openTransactionFilter(page, 'Booking date');
    await sheet.getByRole('button', {name: 'This month', exact: true}).click();
    await expect(page).toHaveURL(/bookingDate=/);
    await sheet.getByRole('button', {name: 'Reset Booking date', exact: true}).click();
    await expect(page).not.toHaveURL(/bookingDate=/);

    await sheet.getByRole('button', {name: 'Clear all', exact: true}).click();
    const clearedUrl = new URL(page.url());
    expect(clearedUrl.searchParams.has('categories')).toBe(false);
    expect(clearedUrl.searchParams.has('categorySources')).toBe(false);
    await sheet.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Salary', {exact: true})).toBeVisible();
  });

  test('reflows transaction records for a phone viewport', async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');

    const firstTransactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});
    const descriptionTrigger = firstTransactionRow.getByRole('button', {
      name: 'View Coffee shop transaction details',
    });

    await expect(page.getByRole('heading', {name: 'Bank transactions'})).toBeVisible();
    await expect(page.getByTestId('bank-transactions-summary')).toBeVisible();
    // Phones keep search, Order and Filters on one line; the date moves into Filters.
    await expect(page.getByRole('button', {name: /^Booking date/})).toBeHidden();
    const search = page.getByTestId('bank-transactions-search');
    const order = page.getByRole('button', {name: 'Order: Newest first'});
    const filtersTrigger = page.getByTestId('bank-transaction-filters-trigger');
    const [searchBox, orderBox, filtersBox] = await Promise.all(
      [search, order, filtersTrigger].map(boxOf),
    );
    expect(orderBox).toMatchObject({width: 48, height: 48});
    expect(filtersBox.height).toBe(48);
    expect(searchBox.y).toBeCloseTo(orderBox.y, 0);
    expect(filtersBox.x + filtersBox.width).toBeLessThanOrEqual(393 - 16);

    // The category moves under the title, beside its icon; one account names no account.
    const meta = firstTransactionRow.getByTestId('ledger-row-meta');
    await expect(meta).toHaveText('Categorizing…');
    await expect(meta.locator('svg')).toHaveCount(1);
    await expect(firstTransactionRow.getByTestId('ledger-row-category')).toBeHidden();
    const [rowBox, tileBox] = await Promise.all([
      boxOf(firstTransactionRow),
      boxOf(firstTransactionRow.getByTestId('merchant-logo-tile')),
    ]);
    expect(Math.round(rowBox.height)).toBe(60);
    expect({width: tileBox.width, height: tileBox.height}).toEqual({width: 36, height: 36});
    await expectNoHorizontalOverflow(page);

    await descriptionTrigger.focus();
    await expect(descriptionTrigger).toBeFocused();
    await descriptionTrigger.press('Enter');
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(descriptionTrigger).toBeFocused();

    // Ordered by amount the list is flat, and each row carries its date.
    await order.click();
    const orderSheet = page.getByTestId('bank-transaction-order');
    const largestOut = orderSheet.getByRole('radio', {name: 'Largest out first'});
    await orderSheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    for (const option of await orderSheet.getByRole('radio').all()) {
      expect((await boxOf(option)).height).toBeGreaterThanOrEqual(56);
    }
    await expect(orderSheet.getByRole('radio', {name: 'Newest first'})).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await largestOut.click();
    await expect(orderSheet).toBeHidden();
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'amount',
      order: 'ASC',
    });
    await expect(page.getByRole('button', {name: 'Order: Largest out first'})).toBeVisible();
    await expect(page.getByRole('region', {name: /August/})).toHaveCount(0);
    await expect(meta).toHaveText(/^26 Aug ·Categorizing…$/);

    await page.clock.setFixedTime(AFTER_SEEDED_TRANSACTION_YEAR_NOW);
    await page.reload();
    await expect(meta).toHaveText(/^26 Aug 2026 ·/);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps a selected booking date range within a phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-transactions');

    const sheet = await openTransactionFilter(page, 'Booking date');
    let dayButtons = sheet.locator('button[name="day"]:not([disabled]):not(.day-outside)');
    if ((await dayButtons.count()) < 2) {
      await sheet.getByRole('button', {name: 'Go to previous month'}).click();
      dayButtons = sheet.locator('button[name="day"]:not([disabled]):not(.day-outside)');
    }
    await dayButtons.nth(0).click();
    await dayButtons.nth(1).click();

    const calendar = sheet.getByTestId('bank-transaction-mobile-calendar');
    const metrics = await calendar.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    await sheet.getByRole('button', {name: 'Back to filters'}).click();
    await expect(sheet.getByRole('button', {name: /^Booking date/})).not.toContainText('Any');
    await expectNoHorizontalOverflow(page);
  });

  test('orders by date in day groups and by amount in one flat list', async ({page}) => {
    await page.clock.setFixedTime(SEEDED_TRANSACTION_YEAR_NOW);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions');
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();

    const rows = page.getByTestId(/^bank-transaction-row-/);
    const order = (current: string) => page.getByRole('button', {name: `Order: ${current}`});
    const choose = async (current: string, next: string, sort: {by: string; order: string}) => {
      const matches = (rawUrl: string) => {
        const url = new URL(rawUrl);
        return (
          url.pathname.endsWith('/bank-transactions') &&
          url.searchParams.get('sort[by]') === sort.by &&
          url.searchParams.get('sort[order]') === sort.order
        );
      };
      const responsePromise = page.waitForResponse((response) => matches(response.url()));
      await order(current).click();
      await page.getByRole('menuitemradio', {name: next}).click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as {transactions: Array<{id: string}>};
      await expect(rows.first()).toHaveAttribute(
        'data-testid',
        `bank-transaction-row-${payload.transactions[0].id}`,
      );
      await expect(order(next)).toBeVisible();
    };

    await choose('Newest first', 'Largest in first', {by: 'amount', order: 'DESC'});
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'amount',
      order: 'DESC',
    });
    // One list without day headings; each row names its date instead.
    await expect(page.getByRole('region', {name: /August/})).toHaveCount(0);
    await expect(page.getByRole('list', {name: 'Transactions'})).toBeVisible();
    await expect(rows.filter({hasText: 'Coffee shop'})).toContainText('26 Aug');

    await choose('Largest in first', 'Largest out first', {by: 'amount', order: 'ASC'});
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'amount',
      order: 'ASC',
    });

    await choose('Largest out first', 'Oldest first', {by: 'bookingDate', order: 'ASC'});
    const days = page.getByRole('region', {name: /August/});
    await expect(days.first()).toBeVisible();
    const headings = await page.getByRole('heading', {level: 2}).allTextContents();
    expect(headings[headings.length - 1]).toBe('Wednesday 26 August');

    await choose('Oldest first', 'Newest first', {by: 'bookingDate', order: 'DESC'});
    expect(new URL(page.url()).searchParams.has('sort')).toBe(false);
    await expect(page.getByRole('heading', {level: 2}).first()).toHaveText('Wednesday 26 August');

    // A link ordered by a field the page no longer offers opens in the default order.
    await page.goto(
      `/bank-transactions?sort=${encodeURIComponent(JSON.stringify({by: 'category', order: 'ASC'}))}`,
    );
    await expect(order('Newest first')).toBeVisible();
    await expect(page.getByRole('heading', {level: 2}).first()).toHaveText('Wednesday 26 August');
  });

  test('preserves original values for mixed-currency amount results', async ({page}) => {
    await page.route('**/bank-transactions?*', async (route) => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }

      const url = new URL(route.request().url());
      const sortBy = url.searchParams.get('sort[by]');
      const sortOrder = url.searchParams.get('sort[order]') as 'ASC' | 'DESC' | null;
      if (sortBy !== 'amount' || !sortOrder) {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const payload = (await response.json()) as {
        transactions: Array<Record<string, unknown>>;
        total: number;
      };
      const template = payload.transactions[0];
      const ronTransaction = {
        ...template,
        id: '00000000-0000-4000-8000-000000000201',
        description: 'Synthetic RON purchase',
        displayDescription: 'Synthetic RON purchase',
        amount: '100.00000000',
        currency: 'RON',
      };
      const eurTransaction = {
        ...template,
        id: '00000000-0000-4000-8000-000000000202',
        description: 'Synthetic EUR purchase',
        displayDescription: 'Synthetic EUR purchase',
        amount: '30.00000000',
        currency: 'EUR',
      };
      await route.fulfill({
        response,
        json: {
          ...payload,
          transactions:
            sortOrder === 'DESC'
              ? [eurTransaction, ronTransaction]
              : [ronTransaction, eurTransaction],
          total: 2,
        },
      });
    });

    await page.goto('/bank-transactions');
    await page.getByRole('button', {name: 'Order: Newest first'}).click();
    await page.getByRole('menuitemradio', {name: 'Largest in first'}).click();

    const rows = page.getByTestId(/^bank-transaction-row-/);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Synthetic EUR purchase');
    await expect(rows.nth(0).getByTestId('ledger-row-amount')).toHaveText('€30.00');
    await expect(rows.nth(1)).toContainText('Synthetic RON purchase');
    await expect(rows.nth(1).getByTestId('ledger-row-amount')).toContainText('RON');
    await expect(rows.nth(1).getByTestId('ledger-row-amount')).toContainText('100.00');
  });

  test('keeps worst-case transaction values readable at every width', async ({page}) => {
    // Four viewports of inspector checks run close to the default limit in WebKit.
    test.setTimeout(20_000);
    const sepaReference =
      '/TRTP/SEPA-TRANSFER/IBAN/NL91ABNA0417164300/BIC/ABNANL2A/NAME/EXAMPLE-SHOP-BV/REMI/INV-2026-000123456789';
    let transactions: Array<Record<string, unknown>> = [];
    await page.route('**/bank-transactions?*', async (route) => {
      if (!['fetch', 'xhr'].includes(route.request().resourceType())) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const payload = (await response.json()) as {transactions: Array<Record<string, unknown>>};
      const template = payload.transactions[0];
      const synthetic = (id: number, overrides: Record<string, unknown>) => ({
        ...template,
        id: `00000000-0000-4000-8000-${String(300 + id).padStart(12, '0')}`,
        financialEventType: null,
        financialEventSource: null,
        currencyExchangeCounterpart: null,
        ownTransfer: null,
        ownTransferOverride: null,
        ...overrides,
      });
      transactions = [
        synthetic(1, {
          description: 'Synthetic large expense',
          displayDescription: 'Synthetic large expense',
          amount: '-12345678.90000000',
          currency: 'EUR',
        }),
        synthetic(2, {
          description: 'Synthetic large refund',
          displayDescription: 'Synthetic large refund',
          amount: '-12345678.90000000',
          currency: 'CHF',
        }),
        synthetic(3, {
          description: sepaReference,
          displayDescription: sepaReference,
          amount: '-250.00000000',
          currency: 'EUR',
        }),
        synthetic(4, {
          description: 'Synthetic rounding remainder',
          displayDescription: 'Synthetic rounding remainder',
          amount: '-0.00400000',
          currency: 'EUR',
        }),
      ];
      await route.fulfill({response, json: {transactions, total: 1284}});
    });
    await page.route('**/bank-transactions/00000000-0000-4000-8000-0000000003*', async (route) => {
      const transaction = transactions.find((candidate) =>
        new URL(route.request().url()).pathname.endsWith(`/${String(candidate.id)}`),
      );
      if (transaction) await fulfillJson(route, transaction);
      else await route.continue();
    });
    await mockJson(page, '**/bank-transactions/*/recurring?**', null);

    const rows = page.getByTestId(/^bank-transaction-row-/);
    // An amount is never cut short: it fits its own box, which fits the row.
    const readClippedAmounts = () =>
      rows.evaluateAll((elements) =>
        elements.flatMap((row) => {
          const amount = row.querySelector('[data-testid="ledger-row-amount"]');
          const button = row.querySelector('button');
          if (!amount || !button) return [];
          const rowBox = button.getBoundingClientRect();
          const amountBox = amount.getBoundingClientRect();
          return amount.scrollWidth > amount.clientWidth + 1 ||
            amountBox.right > rowBox.right + 1 ||
            amountBox.left < rowBox.left
            ? [amount.textContent]
            : [];
        }),
      );

    for (const viewport of [
      {width: 1440, height: 900},
      {width: 1024, height: 768},
      {width: 768, height: 1024},
      {width: 320, height: 852},
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/bank-transactions');
      await expect(rows).toHaveCount(4);
      await expect(page.getByTestId('bank-transactions-summary')).toHaveText('1,284 transactions');
      await expect(rows.nth(0)).toContainText('-€12,345,678.90');
      await expect(rows.nth(1)).toContainText('-CHF 12,345,678.90');
      // Each row's button fills its day card edge to edge (inside the 1px border), so hover and clicks do too.
      expect(
        await rows.evaluateAll((elements) =>
          elements.flatMap((row) => {
            const button = row.querySelector('button')!.getBoundingClientRect();
            const card = row.closest('ul')!.getBoundingClientRect();
            return Math.abs(button.left - card.left - 1) > 0.5 ||
              Math.abs(card.right - 1 - button.right) > 0.5
              ? [row.textContent]
              : [];
          }),
        ),
      ).toEqual([]);
      await expect(rows.nth(3)).toContainText('€0.00');
      await expect(rows.nth(3)).not.toContainText('-€0.00');
      expect(await readClippedAmounts()).toEqual([]);
      await expectNoHorizontalOverflow(page);
      for (const index of [0, 1]) {
        await rows
          .nth(index)
          .getByRole('button', {name: /^View .* transaction details$/})
          .click();
        const inspector = page.getByTestId('bank-transaction-inspector');
        const amount = inspector.getByTestId('bank-transaction-detail-amount');
        await expect(amount).toBeVisible();
        await expect(inspector.getByTestId('bank-transaction-detail-direction')).toBeVisible();
        await inspector.evaluate((el) =>
          Promise.all(el.getAnimations({subtree: true}).map((animation) => animation.finished)),
        );
        const [inspectorBox, amountBox] = await Promise.all([
          boxOf(inspector),
          boxOf(amount.locator('span')),
        ]);
        expect(amountBox.x + amountBox.width).toBeLessThanOrEqual(
          inspectorBox.x + inspectorBox.width - 16,
        );
        const overflow = await inspector.evaluate((el) => {
          const edge = el.getBoundingClientRect().right;
          return [...el.querySelectorAll('*')]
            .filter((node) => node.getBoundingClientRect().right > edge + 1)
            .map((node) => ({
              tag: node.tagName,
              text: node.textContent?.slice(0, 70),
              width: node.getBoundingClientRect().width,
              right: node.getBoundingClientRect().right,
              classes: node.className,
            }));
        });
        expect(overflow, `${viewport.width}px transaction ${index}`).toEqual([]);
        await inspector.getByRole('button', {name: 'Close transaction details'}).click();
      }
    }

    await rows
      .nth(3)
      .getByRole('button', {name: /^View .* transaction details$/})
      .click();
    const zeroInspector = page.getByTestId('bank-transaction-inspector');
    await expect(zeroInspector.getByTestId('bank-transaction-detail-amount')).toHaveText('€0.00');
    // A zero amount moved no money, so it has no direction arrow.
    await expect(zeroInspector.getByTestId('bank-transaction-detail-direction')).toHaveCount(0);

    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');
    await rows
      .nth(2)
      .getByRole('button', {name: /^View .* transaction details$/})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    const title = inspector.getByRole('heading', {name: sepaReference});
    await expect(title).toBeVisible();
    const [inspectorBox, titleBox] = await Promise.all([boxOf(inspector), boxOf(title)]);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(inspectorBox.x + inspectorBox.width);
  });
});

test.describe('bank transactions without synced data', () => {
  test('shows the empty state for an account without transactions', async ({
    page,
    freshAccount,
  }) => {
    await page.goto('/bank-transactions');
    await expect(page.getByTestId('current-account-email')).toHaveText(freshAccount.email);

    await expect(page.getByRole('heading', {name: 'No transactions yet'})).toBeVisible();
    await expect(
      page.getByText('Connect a bank and its transactions appear here after the first sync.'),
    ).toBeVisible();
    await page.getByRole('link', {name: 'Connect a bank'}).click();
    await expect(page).toHaveURL(/\/bank-connections$/);
  });
});
