import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {expect, test} from '../../fixtures';
import {fulfillJson, mockJson, transformBankConnections} from '../../utils/api-mocks';
import {boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

const DETAIL_TRANSACTION_ID = '00000000-0000-4000-8000-000000000011';

test.describe('bank transactions', () => {
  test.use({storageState: VERIFIED_USER_AUTH_FILE});

  test('renders, searches, and opens the transaction detail inspector', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions');

    const firstTransactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});

    await expect(page.getByText('Coffee shop')).toBeVisible();
    const sourceCell = firstTransactionRow.getByRole('cell').nth(3);
    await expect(sourceCell).toHaveText(/^ABN AMRO\s*·\s*[A-Z]{3}$/);
    await expect(
      page.getByTestId('bank-transactions-table').getByRole('columnheader', {name: 'Category'}),
    ).toBeVisible();
    await expect(firstTransactionRow.getByRole('cell')).toHaveCount(5);
    await expect(firstTransactionRow.getByRole('cell').nth(2)).toContainText('Not categorized');
    await expect(firstTransactionRow.getByRole('cell').nth(0)).toContainText('Aug 26, 2026');

    await page.getByTestId('bank-transactions-search').fill('does not exist');
    await expect(page.getByText('No bank transactions found')).toBeVisible();

    await page.getByRole('button', {name: 'Clear filters'}).first().click();
    await expect(page.getByText('Coffee shop')).toBeVisible();

    await firstTransactionRow.click({position: {x: 8, y: 8}});
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(page).toHaveURL(/\/bank-transactions(?:\?.*)?$/);
    const openedUrl = new URL(page.url());
    expect(openedUrl.searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Coffee shop'})).toBeVisible();
    await expect(inspector.getByText('Bank transaction', {exact: true})).toBeVisible();
    const transactionDetails = inspector.getByTestId('bank-transaction-details-sections');
    const descriptionDetail = transactionDetails
      .getByText('Description', {exact: true})
      .locator('..');
    await expect(descriptionDetail).toContainText('Coffee shop');
    await expect(inspector.getByRole('heading', {level: 2, name: 'Notes'})).toHaveCount(0);
    await expect(inspector.getByText('Remittance information', {exact: true})).toHaveCount(0);
    await expect(inspector.getByText('Merchant category code')).toBeVisible();
    await expect(inspector.getByText('Bank account', {exact: true})).toBeVisible();
    await expect(inspector.getByText('Daily spending')).toBeVisible();
    await expect(inspector.getByText('Transaction date')).toBeVisible();
    await expect(inspector.getByText('Card payment', {exact: true})).toBeVisible();
    await expect(inspector.getByText('Provider classification')).toBeVisible();
    await expect(inspector.getByText('100.50 EUR')).toBeVisible();
    await expect(inspector.getByText('4.50 USD')).toBeVisible();
    await expect(inspector.getByText('0.9234 USD (SPOT)', {exact: true})).toBeVisible();
    await expect(
      inspector.getByText('0.923400000000000000 USD (SPOT)', {exact: true}),
    ).not.toBeVisible();
    await expect(inspector.getByText('reference-coffee (RF)')).toBeVisible();
    await expect(inspector.getByTestId('bank-transaction-id-row')).toHaveCount(0);
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

      if (url.searchParams.get('filter[financialEventTypes][]') === 'CURRENCY_EXCHANGE') {
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
      const pageIndex = url.searchParams.get('pagination[pageIndex]');
      const shouldInjectExchange = pageIndex === '0' || pageIndex === '1';
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

    await page.goto('/bank-transactions?pageIndex=1&pageSize=10');

    const exchangeRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Currency exchange'});
    await expect(exchangeRow).toHaveCount(1);
    await expect(exchangeRow.getByRole('cell').nth(2)).toContainText('Currency exchange');
    await expect(exchangeRow.getByRole('cell').nth(2)).toContainText('Category not applicable');
    await expect(exchangeRow.getByRole('cell').nth(2)).toContainText('Internal movement');

    await exchangeRow
      .getByRole('button', {name: 'View Exchanged to GBP transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Currency exchange', {exact: true}).first()).toBeVisible();
    await expect(inspector.getByText('Internal movement', {exact: true})).toBeVisible();
    await expect(
      inspector.getByText('Category not applicable', {exact: true}).first(),
    ).toBeVisible();
    await expect(inspector.getByRole('combobox', {name: 'Transaction category'})).toHaveCount(0);
    await expect(inspector.getByText('Rate unavailable', {exact: true})).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();

    await page.getByRole('button', {name: 'Activity'}).click();
    const activityOption = page.getByRole('option', {name: 'Currency exchange', exact: true});
    await expect(activityOption).toHaveAttribute('data-filter-selected', 'false');
    await activityOption.click();
    await expect(activityOption).toHaveAttribute('data-filter-selected', 'true');
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Currency exchange'}),
    ).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('pageIndex')).toBe('0');

    await page.goto(
      '/bank-transactions?pageIndex=1&pageSize=10&financialEventTypes=%5B%22CURRENCY_EXCHANGE%22%5D',
    );
    await page.getByRole('button', {name: 'Clear filters', exact: true}).first().click();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('pageIndex')).toBe('0');

    await page.goto(
      '/bank-transactions?pageIndex=1&pageSize=10&financialEventTypes=%5B%22CURRENCY_EXCHANGE%22%5D',
    );
    await page.getByRole('button', {name: /Activity/}).click();
    await page.getByRole('option', {name: 'Reset', exact: true}).click();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('pageIndex')).toBe('0');

    await page.goto('/bank-transactions?pageIndex=99&pageSize=50');
    await expect(page).toHaveURL(/pageIndex=0/);
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();

    await page.goto('/bank-transactions');
    await page.getByRole('button', {name: 'Activity', exact: true}).click();
    await page.getByRole('option', {name: 'Currency exchange', exact: true}).click();
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await page.goBack();
    await expect(page.getByRole('button', {name: 'Activity', exact: true})).toBeVisible();
    await expect(
      page.getByTestId(/^bank-transaction-row-/).filter({hasText: 'Coffee shop'}),
    ).toBeVisible();

    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');
    await page.getByTestId('bank-transaction-mobile-filters-trigger').click();
    const mobileFilters = page.getByTestId('bank-transaction-mobile-filters');
    const activitySection = mobileFilters.getByRole('heading', {name: 'Activity'}).locator('..');
    await activitySection.getByRole('option', {name: 'Currency exchange', exact: true}).click();
    await expect(page.getByTestId(/^bank-transaction-row-/)).toHaveCount(1);
    await expect(page.getByTestId('bank-transaction-mobile-meta')).toContainText(
      'Currency exchange',
    );
    await expect(page.getByTestId('bank-transaction-mobile-meta')).not.toContainText(
      'Internal movement',
    );
  });

  test('classifies a transaction from the detail inspector', async ({page}) => {
    // Only this test changes a category, and only on this seeded transaction, so no other test
    // depends on it. Picking a category the row does not have yet keeps the test retry-safe.
    const transactionName = 'Extra transaction 1';
    await page.goto('/bank-transactions');
    const transactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: transactionName});
    await expect(
      page.getByTestId('bank-transactions-table').getByRole('columnheader', {name: 'Category'}),
    ).toBeVisible();
    const currentCategory = await transactionRow.getByRole('cell').nth(2).textContent();
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
    await expect(inspector.getByText('Manual', {exact: true})).toBeVisible();

    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(transactionRow.getByRole('cell').nth(2).locator('svg').locator('..')).toHaveClass(
      target.className,
    );
    await transactionRow
      .getByRole('button', {name: `View ${transactionName} transaction details`})
      .click();
    await expect(inspector).toBeVisible();
    await expect(categorySelect).toHaveText(target.name);
    await expect(inspector.getByText('Manual')).toBeVisible();
  });

  test('does not show the bank account filter when there is one account', async ({page}) => {
    await page.goto('/bank-transactions');

    await expect(page.getByRole('button', {name: 'Bank accounts'})).toHaveCount(0);
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

    await expect(page.getByRole('button', {name: 'Bank accounts'})).toHaveCount(0);
  });

  test('keeps the bank account filter visible but disabled when connections cannot be loaded', async ({
    page,
  }) => {
    await mockJson(page, '**/bank-connections', {message: 'bank connections unavailable'}, 500);

    await page.goto('/bank-transactions');

    const filter = page.getByRole('button', {name: 'Bank accounts'});
    await expect(filter).toBeVisible();
    await expect(filter).toBeDisabled();
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
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(
      googlePayDescription,
    );
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(
      sepaIdealDescription,
    );
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(
      sepaTransferDescription,
    );
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(
      regularCardDescription,
    );
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(
      longUnstructuredDescription,
    );
    await expect(page.getByTestId('bank-transactions-table')).not.toContainText(atmCardDescription);

    await rows
      .nth(0)
      .getByRole('button', {name: 'View Synthetic Market,PAS998 transaction details'})
      .click();
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector.getByRole('heading', {name: 'API detail title'})).toBeVisible();
    await expect(inspector.getByText(googlePayDescription, {exact: true})).toBeVisible();
  });

  test('reopens a transaction inspector from its shareable URL', async ({page}) => {
    await page.goto('/bank-transactions');

    const transactionTrigger = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'})
      .getByRole('button', {name: 'View Coffee shop transaction details'});
    await transactionTrigger.click();

    const sharedUrl = page.url();
    expect(new URL(sharedUrl).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);

    await page.goto(sharedUrl);
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', {name: 'Coffee shop'})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('transactionId')).toBe(DETAIL_TRANSACTION_ID);
  });

  test('presents transaction detail in a responsive inspector', async ({page}) => {
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
      await expect(
        inspector.getByRole('heading', {level: 2, name: 'Transaction details'}),
      ).toBeVisible();
      await expect(inspector.getByRole('heading', {level: 3, name: 'Dates'})).toBeVisible();
      await expect(inspector.getByRole('heading', {level: 3, name: 'Account'})).toBeVisible();
      const amount = inspector.getByTestId('bank-transaction-detail-amount');
      const currency = inspector.getByTestId('bank-transaction-detail-currency');
      await expect(amount).toBeVisible();
      await expect(currency).toHaveText('EUR');
      const [amountBox, currencyBox] = await Promise.all([boxOf(amount), boxOf(currency)]);
      expect(currencyBox.x).toBeGreaterThan(amountBox.x + amountBox.width);
      expect(currencyBox.y).toBeLessThan(amountBox.y + amountBox.height);
      expect(currencyBox.y + currencyBox.height).toBeGreaterThan(amountBox.y);

      if (viewport.width < 768) {
        const detailGrid = inspector
          .getByTestId('bank-transaction-details-sections')
          .locator(':scope > div');
        const detailGridColumns = await detailGrid.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        );
        expect(detailGridColumns).toBe(1);
        const datesGrid = inspector
          .getByRole('heading', {name: 'Dates'})
          .locator('..')
          .locator('dl');
        const datesGridColumns = await datesGrid.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        );
        expect(datesGridColumns).toBe(2);
        const detailFieldWrapping = await inspector
          .getByTestId('bank-transaction-details-sections')
          .locator('dl dt, dl dd')
          .evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).whiteSpace),
          );
        expect(detailFieldWrapping.every((whiteSpace) => whiteSpace === 'nowrap')).toBe(true);
      }
      await expectNoHorizontalOverflow(page);

      const inspectorBox = await boxOf(inspector);
      expect(inspectorBox.width).toBeLessThanOrEqual(viewport.width);
      const inspectorBody = inspector.getByTestId('bank-transaction-inspector-body');
      const inspectorViewport = inspectorBody.locator('[data-radix-scroll-area-viewport]');
      const inspectorScrollbar = inspectorBody.locator('[data-orientation="vertical"]');
      await expect(inspectorScrollbar).toBeVisible();
      await expect(inspectorScrollbar.locator('.bg-border')).toBeVisible();
      expect(await inspectorViewport.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
        await inspectorViewport.evaluate((element) => element.clientHeight),
      );

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
      inspector.getByRole('heading', {name: 'Could not load bank transaction'}),
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

    await page.getByRole('button', {name: 'Bank accounts'}).click();
    await expect(page.getByRole('option', {name: /Daily spending/})).toBeVisible();
    await page.getByRole('option', {name: /Daily spending/}).click();
    await expect(page).toHaveURL(/bankAccountIds/);
    await expect(page.getByText('Coffee shop')).toBeVisible();

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
          categorySource: index === 0 ? 'MANUAL' : 'AI',
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

    const categoryFilter = page.getByRole('button', {name: 'Categories', exact: true});
    await expect(categoryFilter).toBeVisible();
    await categoryFilter.click();
    await expect(page.getByRole('option')).toHaveCount(20);
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

    const categorySourceFilter = page.getByRole('button', {
      name: 'Category source',
      exact: true,
    });
    await categorySourceFilter.click();
    await expect(page.getByRole('option')).toHaveCount(2);
    await page.getByRole('option', {name: 'Manual', exact: true}).click();

    const manualSourceParam = new URL(page.url()).searchParams.get('categorySources');
    expect(manualSourceParam).not.toBeNull();
    expect(JSON.parse(manualSourceParam!)).toEqual(['MANUAL']);
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();
    await expect(page.getByText('Salary', {exact: true})).not.toBeVisible();

    await page.getByRole('button', {name: 'Clear filters'}).first().click();
    const clearedUrl = new URL(page.url());
    expect(clearedUrl.searchParams.has('categories')).toBe(false);
    expect(clearedUrl.searchParams.has('categorySources')).toBe(false);
    await expect(page.getByText('Salary', {exact: true})).toBeVisible();
    await page.unrouteAll({behavior: 'ignoreErrors'});
  });

  test('filters from the responsive mobile drawer and clears all values', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');

    await page.getByTestId('bank-transaction-mobile-filters-trigger').click();
    const mobileFilters = page.getByTestId('bank-transaction-mobile-filters');
    const categoriesSection = mobileFilters
      .getByRole('heading', {name: 'Categories'})
      .locator('..');
    const categorySourceSection = mobileFilters
      .getByRole('heading', {name: 'Category source'})
      .locator('..');

    await categoriesSection.getByRole('option', {name: 'Not categorized', exact: true}).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categories')!)).toEqual([
      'UNCATEGORIZED',
    ]);
    await categoriesSection.getByRole('option', {name: 'Needs review', exact: true}).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categories')!)).toEqual([
      'UNCATEGORIZED',
      'NEEDS_REVIEW',
    ]);
    await categorySourceSection.getByRole('option', {name: 'Manual', exact: true}).click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('categorySources')!)).toEqual([
      'MANUAL',
    ]);
    await expect(
      page.getByTestId('bank-transaction-mobile-filters-trigger').getByText('2', {exact: true}),
    ).toBeVisible();

    await mobileFilters.getByRole('button', {name: 'Clear all', exact: true}).click();
    const clearedUrl = new URL(page.url());
    expect(clearedUrl.searchParams.has('categories')).toBe(false);
    expect(clearedUrl.searchParams.has('categorySources')).toBe(false);
    await expect(page.getByText('Salary', {exact: true})).toBeVisible();
  });

  test('reflows transaction records for a phone viewport', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto('/bank-transactions');

    const table = page.getByTestId('bank-transactions-table');
    const firstTransactionRow = page
      .getByTestId(/^bank-transaction-row-/)
      .filter({hasText: 'Coffee shop'});
    const descriptionTrigger = firstTransactionRow.getByRole('button', {
      name: 'View Coffee shop transaction details',
    });

    await expect(page.getByRole('heading', {name: 'Bank transactions'})).toBeVisible();
    const headingGroup = page.getByTestId('bank-transactions-heading');
    const [headingBox, summaryBox] = await Promise.all([
      boxOf(headingGroup.getByRole('heading')),
      boxOf(headingGroup.locator('p')),
    ]);
    expect(summaryBox.y).toBeLessThan(headingBox.y + headingBox.height);
    await expect(page.getByRole('button', {name: 'Bank accounts', exact: true})).not.toBeVisible();
    await expect(page.getByTestId('bank-transaction-desktop-filters')).toBeHidden();
    const mobileFiltersTrigger = page.getByTestId('bank-transaction-mobile-filters-trigger');
    await expect(mobileFiltersTrigger).toBeVisible();
    const mobileFiltersTriggerBox = await boxOf(mobileFiltersTrigger);
    expect(mobileFiltersTriggerBox.width).toBeGreaterThanOrEqual(88);
    await expect(mobileFiltersTrigger).toHaveCSS('height', '48px');
    await mobileFiltersTrigger.click();
    const mobileFilters = page.getByTestId('bank-transaction-mobile-filters');
    await expect(mobileFilters).toBeVisible();
    await expect(mobileFilters.getByRole('heading', {name: 'Filters'})).toBeVisible();
    await expect(mobileFilters.getByRole('heading', {name: 'Booking date'})).toBeVisible();
    await expect(mobileFilters.getByRole('heading', {name: 'Categories'})).toBeVisible();
    await expect(mobileFilters.getByRole('heading', {name: 'Category source'})).toBeVisible();
    await expect(mobileFilters.getByRole('heading', {name: 'Activity'})).toBeVisible();
    const mobileFiltersBody = page.getByTestId('bank-transaction-mobile-filters-body');
    await expect.poll(() => mobileFiltersBody.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(mobileFiltersBody).toHaveCSS('padding-top', '16px');
    await expect(mobileFiltersBody).toHaveCSS('padding-bottom', '16px');
    const mobileFiltersScrollArea = page.getByTestId('bank-transaction-mobile-filters-scroll-area');
    const mobileFiltersViewport = mobileFiltersScrollArea.locator(
      ':scope > [data-radix-scroll-area-viewport]',
    );
    const mobileFiltersScrollbar = mobileFiltersScrollArea.locator(
      ':scope > [data-orientation="vertical"]',
    );
    await expect(mobileFiltersScrollbar).toBeVisible();
    await expect(mobileFiltersScrollbar.locator('.bg-border')).toBeVisible();
    const mobileFiltersViewportMetrics = await mobileFiltersViewport.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(mobileFiltersViewportMetrics.scrollHeight).toBeGreaterThan(
      mobileFiltersViewportMetrics.clientHeight,
    );
    const calendarFrame = mobileFilters.getByTestId('bank-transaction-mobile-calendar');
    const calendarTable = calendarFrame.locator('table');
    const firstCalendarWeek = calendarTable.locator('tbody tr').first();
    const [calendarTableBox, lastCalendarCellBox] = await Promise.all([
      boxOf(calendarTable),
      boxOf(firstCalendarWeek.locator('td').last()),
    ]);
    expect(lastCalendarCellBox.width).toBeGreaterThan(40);
    expect(lastCalendarCellBox.x + lastCalendarCellBox.width).toBeGreaterThan(
      calendarTableBox.x + calendarTableBox.width - 24,
    );
    const categoriesSection = mobileFilters
      .getByRole('heading', {name: 'Categories'})
      .locator('..');
    const categorySourceSection = mobileFilters
      .getByRole('heading', {name: 'Category source'})
      .locator('..');
    await expect(categoriesSection.getByPlaceholder('Search categories...')).toBeVisible();
    await expect(categorySourceSection.getByRole('option')).toHaveCount(2);
    await expect(mobileFilters.getByRole('button', {name: 'Done', exact: true})).toBeVisible();
    await mobileFilters.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(mobileFilters).toBeHidden();
    await expect(firstTransactionRow).toBeVisible();
    const lastTransactionRow = table
      .locator('tbody tr[data-testid^="bank-transaction-row-"]')
      .last();
    await expect(lastTransactionRow).toBeVisible();
    await expect(lastTransactionRow).toHaveCSS('border-top-width', '1px');
    await expect(firstTransactionRow.locator('td').nth(2)).toBeHidden();
    const [tableBox, firstTransactionRowBox] = await Promise.all([
      boxOf(table),
      boxOf(firstTransactionRow),
    ]);
    expect(firstTransactionRowBox.x).toBeCloseTo(tableBox.x, 0);
    expect(firstTransactionRowBox.x + firstTransactionRowBox.width).toBeCloseTo(
      tableBox.x + tableBox.width,
      0,
    );
    await expect(descriptionTrigger).toHaveCount(1);
    await expect(table).toHaveAttribute('aria-label', 'Bank transactions');
    const mobileMeta = firstTransactionRow.getByTestId('bank-transaction-mobile-meta');
    const mobileMetaLabel = mobileMeta.getByTestId('bank-transaction-mobile-meta-label');
    await expect(mobileMeta).toContainText('26 Aug');
    await expect(mobileMetaLabel).toBeVisible();
    await expect(mobileMetaLabel).not.toHaveText('Daily spending');
    await expect(mobileMeta).toContainText('ABN AMRO');
    const pagination = page.getByTestId('pagination');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveCSS('width', '361px');
    await expect(pagination.getByRole('button', {name: 'Go to previous page'})).toBeVisible();
    await expect(pagination.getByRole('button', {name: 'Go to next page'})).toBeVisible();
    await expect(pagination.getByRole('button', {name: 'Go to first page'})).not.toBeVisible();
    await expect(pagination.getByRole('button', {name: 'Go to last page'})).not.toBeVisible();
    const rowsSelector = pagination.getByRole('combobox', {name: 'Rows per page'});
    const rowsValue = rowsSelector.locator(':scope > span');
    const rowsChevron = rowsSelector.locator('svg');
    const [rowsValueBox, rowsChevronBox] = await Promise.all([
      boxOf(rowsValue),
      boxOf(rowsChevron),
    ]);
    expect(rowsChevronBox.x - (rowsValueBox.x + rowsValueBox.width)).toBeGreaterThanOrEqual(8);
    await expect
      .poll(() => pagination.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThan(52);
    await expect
      .poll(() => firstTransactionRow.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThan(80);
    const tableWrapper = table.locator('xpath=../../..');
    await expect(tableWrapper).toHaveCSS('border-top-width', '0px');
    await expect(tableWrapper).toHaveCSS('border-radius', '0px');
    await expect(firstTransactionRow).toHaveCSS('border-top-width', '1px');
    const mobileMetaContainer = firstTransactionRow.getByTestId('bank-transaction-mobile-meta');
    const mobileMetaRight = firstTransactionRow.getByTestId('bank-transaction-mobile-meta-right');
    const mobileAmount = firstTransactionRow.locator('td').filter({hasText: '-€4.50'});
    await expect(mobileMetaRight).toBeVisible();
    await expect(mobileMetaRight).toHaveCSS('text-align', 'right');
    const [, metaRightBox, amountBox] = await Promise.all([
      boxOf(mobileMetaContainer),
      boxOf(mobileMetaRight),
      boxOf(mobileAmount),
    ]);
    expect(metaRightBox.x + metaRightBox.width).toBeCloseTo(amountBox.x + amountBox.width, 0);
    expect(metaRightBox.y).toBeGreaterThan(amountBox.y);
    await expectNoHorizontalOverflow(page);

    await descriptionTrigger.focus();
    await expect(descriptionTrigger).toBeFocused();
    await descriptionTrigger.press('Enter');
    const inspector = page.getByTestId('bank-transaction-inspector');
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', {name: 'Close transaction details'}).click();
    await expect(inspector).toBeHidden();
    await expect(descriptionTrigger).toBeFocused();
  });

  test('keeps a selected booking date range within a phone viewport', async ({page}) => {
    await page.setViewportSize({width: 320, height: 852});
    await page.goto('/bank-transactions');

    await page.getByTestId('bank-transaction-mobile-filters-trigger').click();
    const mobileFilters = page.getByTestId('bank-transaction-mobile-filters');
    await expect(mobileFilters).toBeVisible();
    let dayButtons = mobileFilters.locator('button[name="day"]:not([disabled]):not(.day-outside)');
    if ((await dayButtons.count()) < 2) {
      await mobileFilters.getByRole('button', {name: 'Go to previous month'}).click();
      dayButtons = mobileFilters.locator('button[name="day"]:not([disabled]):not(.day-outside)');
    }
    await dayButtons.nth(0).click();
    await dayButtons.nth(1).click();

    const bookingDateSection = mobileFilters
      .getByRole('heading', {name: 'Booking date'})
      .locator('..');
    const metrics = await bookingDateSection.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    await expectNoHorizontalOverflow(page);
  });

  test('sorts and paginates with the shared table controls', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/bank-transactions?pageIndex=0&pageSize=10');

    const table = page.getByTestId('bank-transactions-table');
    const rowsSelector = page
      .getByTestId('pagination')
      .getByRole('combobox', {name: 'Rows per page'});
    await rowsSelector.click();
    await expect(page.getByRole('option')).toHaveText(['10', '50', '100']);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Coffee shop', {exact: true})).toBeVisible();
    const readColumnBoxes = () =>
      table.locator('thead th').evaluateAll((headers) =>
        headers.map((header) => {
          const box = header.getBoundingClientRect();
          return {
            text: header.textContent?.replace(/\\s+/g, ' ').trim(),
            x: box.x,
            width: box.width,
          };
        }),
      );
    const firstPageColumns = await readColumnBoxes();
    expect(firstPageColumns.map(({text}) => text)).toEqual([
      'Booking date',
      'Description',
      'Category',
      'Source',
      'Amount',
    ]);
    expect(firstPageColumns[1].width).toBeGreaterThan(
      Math.max(...firstPageColumns.filter((_, index) => index !== 1).map(({width}) => width)),
    );

    const amountHeaderButton = table
      .getByRole('columnheader', {name: 'Amount'})
      .getByRole('button', {name: 'Amount'});
    await expect(amountHeaderButton).toHaveCSS('justify-content', 'flex-end');
    const [amountHeaderBox, amountCellBox, amountHeaderContentRight, amountCellContentBox] =
      await Promise.all([
        boxOf(amountHeaderButton),
        boxOf(table.locator('tbody tr').first().locator('td').nth(4)),
        amountHeaderButton.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().right;
        }),
        boxOf(table.locator('tbody tr').first().locator('td').nth(4).locator('div')),
      ]);
    expect(amountHeaderBox.x + amountHeaderBox.width).toBeCloseTo(
      amountCellBox.x + amountCellBox.width,
      0,
    );
    expect(amountHeaderContentRight).toBeCloseTo(
      amountCellContentBox.x + amountCellContentBox.width,
      0,
    );

    let sort: string | null;
    const readSortedTransactions = async (order: 'ASC' | 'DESC') => {
      const matchesAmountSort = (rawUrl: string) => {
        const url = new URL(rawUrl);
        return (
          url.pathname.endsWith('/bank-transactions') &&
          url.searchParams.get('sort[by]') === 'amount' &&
          url.searchParams.get('sort[order]') === order
        );
      };
      const requestPromise = page.waitForRequest((request) => matchesAmountSort(request.url()));
      const responsePromise = page.waitForResponse((response) => matchesAmountSort(response.url()));
      await amountHeaderButton.click();
      const [request, response] = await Promise.all([requestPromise, responsePromise]);
      expect(new URL(request.url()).searchParams.get('sort[by]')).toBe('amount');
      expect(new URL(request.url()).searchParams.get('sort[order]')).toBe(order);
      expect(response.ok()).toBe(true);
      const responseUrl = new URL(response.url());
      expect(responseUrl.searchParams.get('sort[by]')).toBe('amount');
      expect(responseUrl.searchParams.get('sort[order]')).toBe(order);
      const payload = (await response.json()) as {
        transactions: Array<{id: string; description: string; amount: string; currency: string}>;
        total: number;
      };
      await expect(table.locator('tbody tr').first()).toHaveAttribute(
        'data-testid',
        `bank-transaction-row-${payload.transactions[0].id}`,
      );
      return payload;
    };

    await readSortedTransactions('DESC');
    sort = new URL(page.url()).searchParams.get('sort');
    expect(sort).toBe(JSON.stringify({by: 'amount', order: 'DESC'}));

    await readSortedTransactions('ASC');
    sort = new URL(page.url()).searchParams.get('sort');
    expect(sort).toBe(JSON.stringify({by: 'amount', order: 'ASC'}));

    await page.goto('/bank-transactions?pageIndex=0&pageSize=10');
    await expect(table.locator('tbody tr').first()).toBeVisible();

    const bookingDateButton = table
      .getByRole('columnheader', {name: 'Booking date'})
      .getByRole('button', {
        name: 'Booking date',
      });
    await bookingDateButton.click();
    sort = new URL(page.url()).searchParams.get('sort');
    expect(sort).toBe(JSON.stringify({by: 'bookingDate', order: 'ASC'}));
    await bookingDateButton.click();
    sort = new URL(page.url()).searchParams.get('sort');
    expect(sort).toBe(JSON.stringify({by: 'bookingDate', order: 'DESC'}));

    await page.getByRole('button', {name: 'Go to next page'}).click();
    await expect(page).toHaveURL(/pageIndex=1/);
    await expect(page.getByText('Extra transaction 9')).toBeVisible();
    const secondPageColumns = await readColumnBoxes();
    expect(secondPageColumns).toHaveLength(firstPageColumns.length);
    secondPageColumns.forEach((column, index) => {
      expect(column.x).toBeCloseTo(firstPageColumns[index].x, 0);
      expect(column.width).toBeCloseTo(firstPageColumns[index].width, 0);
    });
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

    await page.goto('/bank-transactions?pageIndex=0&pageSize=10');
    const table = page.getByTestId('bank-transactions-table');
    const amountHeaderButton = table
      .getByRole('columnheader', {name: 'Amount'})
      .getByRole('button', {name: 'Amount'});
    await amountHeaderButton.click();

    const rows = table.getByTestId(/^bank-transaction-row-/);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Synthetic EUR purchase');
    await expect(rows.nth(0).locator('td').nth(4)).toHaveText('€30.00');
    await expect(rows.nth(1)).toContainText('Synthetic RON purchase');
    await expect(rows.nth(1).locator('td').nth(4)).toContainText('RON');
    await expect(rows.nth(1).locator('td').nth(4)).toContainText('100.00');
  });

  test('sorts the category and source columns', async ({page}) => {
    await page.goto('/bank-transactions?pageIndex=0&pageSize=10');

    const table = page.getByTestId('bank-transactions-table');
    await expect(table.locator('tbody tr').first()).toBeVisible();

    const categorySortButton = table
      .getByRole('columnheader', {name: 'Category'})
      .getByRole('button', {name: 'Category'});
    await categorySortButton.click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'category',
      order: 'DESC',
    });
    await categorySortButton.click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'category',
      order: 'ASC',
    });

    const sourceSortButton = table
      .getByRole('columnheader', {name: 'Source'})
      .getByRole('button', {name: 'Source'});
    await sourceSortButton.click();
    expect(JSON.parse(new URL(page.url()).searchParams.get('sort')!)).toEqual({
      by: 'source',
      order: 'DESC',
    });
  });
});

test.describe('bank transactions without synced data', () => {
  test('shows the empty state for an account without transactions', async ({
    page,
    freshAccount,
  }) => {
    await page.goto('/bank-transactions');
    await expect(page.getByTestId('sidebar-current-account-email')).toHaveText(freshAccount.email);

    await expect(page.getByRole('heading', {name: 'No bank transactions found'})).toBeVisible();
    await expect(
      page.getByText('Synchronize a bank connection to make its transactions appear here.'),
    ).toBeVisible();
  });
});
