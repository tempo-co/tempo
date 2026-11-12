import {type BankTransaction} from '@tempo/contracts';

import {VERIFIED_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, expect, test} from '../../fixtures';
import {openTransactionFilter} from '../../utils/transaction-filters';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

for (const [value, label] of [
  ['SPENDING', 'Spending'],
  ['INCOME', 'Income'],
  ['INTERNAL', 'Internal movements'],
  ['CURRENCY_EXCHANGE', 'Currency exchange'],
  ['OWN_TRANSFER', 'Own transfer'],
  ['UNKNOWN', 'Unknown direction'],
]) {
  test(`cash flow ${label} is selectable and renders real filtered results`, async ({page}) => {
    await page.goto('/bank-transactions');
    await openTransactionFilter(page, 'Cash flow');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`filter%5BcashFlows%5D%5B%5D=${value}`) &&
        !response.url().includes('/totals'),
    );
    await page.getByRole('option', {name: label, exact: true}).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const list = (await response.json()) as {total: number; transactions: BankTransaction[]};
    expect(JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[]).toEqual([
      value,
    ]);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', {name: `Remove filter: ${label}`, exact: true}),
    ).toBeVisible();
    if (list.total === 0) {
      await expect(page.getByRole('heading', {name: 'No matching transactions'})).toBeVisible();
    } else {
      for (const row of list.transactions) {
        await expect(page.getByTestId(`bank-transaction-row-${row.id}`)).toBeVisible();
        if (value === 'SPENDING' || value === 'INCOME' || value === 'UNKNOWN') {
          expect(row.financialEventType).not.toBe('CURRENCY_EXCHANGE');
          expect(row.ownTransfer).toBeNull();
        }
        if (value === 'SPENDING') {
          expect(
            row.direction === 'EXPENSE' ||
              (row.direction === 'INCOME' && row.category === 'REFUND'),
          ).toBe(true);
        }
        if (value === 'CURRENCY_EXCHANGE') expect(row.financialEventType).toBe('CURRENCY_EXCHANGE');
        if (value === 'OWN_TRANSFER') expect(row.ownTransfer).not.toBeNull();
        if (value === 'INCOME') {
          expect(row.direction).toBe('INCOME');
          expect(row.category).not.toBe('REFUND');
        }
      }
    }
  });
}

test('mobile pickers share combined drills, preserve category status and clear all', async ({
  page,
}) => {
  await page.setViewportSize({width: 390, height: 844});
  const params = new URLSearchParams({
    cashFlows: JSON.stringify(['SPENDING', 'INCOME', 'UNKNOWN']),
    baseAmount: 'MISSING',
    categoryStatuses: JSON.stringify(['FAILED']),
  });
  await page.goto(`/bank-transactions?${params}`);
  await expect(page.getByRole('button', {name: 'Remove filter: Not categorized'})).toBeVisible();
  const drawer = await openTransactionFilter(page, 'Cash flow');
  for (const label of ['Spending', 'Income', 'Unknown direction']) {
    await expect(drawer.getByRole('option', {name: label, exact: true})).toHaveAttribute(
      'data-filter-selected',
      'true',
    );
  }
  await drawer.getByRole('option', {name: 'Internal movements', exact: true}).click();
  await expect
    .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
    .toEqual(['SPENDING', 'INCOME', 'INTERNAL', 'UNKNOWN']);
  await openTransactionFilter(page, 'Amount in EUR');
  await expect(
    drawer.getByRole('option', {name: 'Not available yet', exact: true}),
  ).toHaveAttribute('data-filter-selected', 'true');
  await drawer.getByRole('option', {name: 'Available', exact: true}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('baseAmount')).toBe('PRESENT');
  expect(JSON.parse(new URL(page.url()).searchParams.get('categoryStatuses')!)).toEqual(['FAILED']);
  await drawer.getByRole('button', {name: 'Clear all', exact: true}).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('cashFlows')).toBe(false);
  expect(new URL(page.url()).searchParams.has('baseAmount')).toBe(false);
  expect(new URL(page.url()).searchParams.has('categoryStatuses')).toBe(false);
  await drawer.getByRole('button', {name: 'Done', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('amount availability picker shares direct URL filters and clears combinations', async ({
  page,
}) => {
  const params = new URLSearchParams({
    cashFlows: JSON.stringify(['INCOME']),
    baseAmount: 'PRESENT',
  });
  await page.goto(`/bank-transactions?${params}`);
  await expect(
    page.getByRole('button', {name: 'Remove filter: Income', exact: true}),
  ).toBeVisible();
  const panel = await openTransactionFilter(page, 'Amount in EUR');
  await expect(panel.getByRole('tab', {name: 'Amount in EUR Has base amount'})).toBeVisible();
  await expect(page.getByRole('option', {name: 'Available', exact: true})).toHaveAttribute(
    'data-filter-selected',
    'true',
  );
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('filter%5BbaseAmount%5D=MISSING'),
  );
  await page.getByRole('option', {name: 'Not available yet', exact: true}).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(panel.getByRole('tab', {name: 'Amount in EUR No base amount yet'})).toBeVisible();
  let search = new URL(page.url()).searchParams;
  expect(search.get('baseAmount')).toBe('MISSING');
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['INCOME']);
  await panel.getByRole('button', {name: 'Clear all', exact: true}).click();
  await expect(panel.getByRole('tab', {name: 'Amount in EUR', exact: true})).toBeVisible();
  search = new URL(page.url()).searchParams;
  expect(search.has('baseAmount')).toBe(false);
  expect(search.has('cashFlows')).toBe(false);
});

test('cash flow picker applies the real spending predicate from the first page', async ({page}) => {
  // Older links carry page keys; the list loads more in place, so they are dropped.
  await page.goto('/bank-transactions?pageIndex=2&pageSize=10');
  await expect(page).not.toHaveURL(/pageIndex|pageSize/);
  await openTransactionFilter(page, 'Cash flow');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('filter%5BcashFlows%5D%5B%5D=SPENDING') &&
      !response.url().includes('/totals'),
  );
  await page.getByRole('option', {name: 'Spending', exact: true}).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const list: unknown = await response.json();
  const expected = await page.request.get(
    `${API_URL}/bank-transactions?filter[cashFlows][]=SPENDING&sort[by]=bookingDate&sort[order]=DESC&pagination[pageIndex]=0&pagination[pageSize]=50`,
  );
  expect(expected.ok()).toBe(true);
  expect(list).toEqual(await expected.json());
  await expect(page).toHaveURL(/cashFlows/);
  const search = new URL(page.url()).searchParams;
  expect(JSON.parse(search.get('cashFlows')!)).toEqual(['SPENDING']);
  await expect(page.getByRole('option', {name: 'Spending', exact: true})).toHaveAttribute(
    'data-filter-selected',
    'true',
  );
  await page.getByRole('button', {name: 'Reset Cash flow', exact: true}).click();
  await expect(page).not.toHaveURL(/cashFlows/);
});

for (const mobile of [false, true]) {
  test(`connected internal movements remain editable after dashboard navigation (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize({width: mobile ? 390 : 1440, height: 900});
    await page.goto('/?month=2026-08');
    await page
      .getByRole('dialog', {name: 'August 2026'})
      .getByRole('region', {name: 'Where it went'})
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(/bank-transactions/);
    const bookingDate = new URL(page.url()).searchParams.get('bookingDate');
    await openTransactionFilter(page, 'Cash flow');
    const parent = page.getByRole('option', {name: 'Internal movements', exact: true});
    const exchange = page.getByRole('option', {name: 'Currency exchange', exact: true});
    const transfer = page.getByRole('option', {name: 'Own transfer', exact: true});
    await parent.click();
    await expect(exchange).toHaveAttribute('data-filter-selected', 'true');
    await expect(transfer).toHaveAttribute('data-filter-selected', 'true');
    await expect(parent).toHaveAttribute('data-filter-selected', 'true');
    await expect
      .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
      .toEqual(['SPENDING', 'INTERNAL']);
    await exchange.click();
    await expect(parent).toHaveAttribute('data-filter-selected', 'mixed');
    await expect(parent).toHaveAccessibleDescription('Partially selected');
    await expect
      .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
      .toEqual(['SPENDING', 'OWN_TRANSFER']);
    await exchange.click();
    await expect(parent).toHaveAttribute('data-filter-selected', 'true');
    await expect
      .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
      .toEqual(['SPENDING', 'INTERNAL']);
    // The desktop panel names each filter's values beside it.
    if (!mobile)
      await expect(
        page
          .getByTestId('bank-transaction-filters')
          .getByRole('tab', {name: 'Cash flow Spending, Internal movements'}),
      ).toBeVisible();
    await parent.click();
    await expect(exchange).toHaveAttribute('data-filter-selected', 'false');
    await expect(transfer).toHaveAttribute('data-filter-selected', 'false');
    expect(new URL(page.url()).searchParams.get('bookingDate')).toBe(bookingDate);
    await expect
      .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
      .toEqual(['SPENDING']);
  });
}

for (const mobile of [false, true]) {
  for (const [key, values, remaining] of [
    ['cashFlows', ['INTERNAL'], 'OWN_TRANSFER'],
    ['cashFlows', ['CURRENCY_EXCHANGE', 'OWN_TRANSFER'], 'OWN_TRANSFER'],
    ['cashFlows', ['INTERNAL', 'CURRENCY_EXCHANGE'], 'OWN_TRANSFER'],
    ['cashFlows', ['CURRENCY_EXCHANGE'], 'OWN_TRANSFER'],
    ['financialEventTypes', ['OWN_TRANSFER'], 'CURRENCY_EXCHANGE'],
  ] as [string, string[], string][]) {
    test(`internal URL ${key} ${values.join('+')} can be narrowed and cleared (${mobile ? 'mobile' : 'desktop'})`, async ({
      page,
    }) => {
      await page.setViewportSize({width: mobile ? 390 : 1440, height: 900});
      const params = new URLSearchParams({
        [key]: JSON.stringify(values),
        baseAmount: 'PRESENT',
        categoryStatuses: JSON.stringify(['FAILED']),
      });
      await page.goto(`/bank-transactions?${params}`);
      await expect(
        page.getByRole('button', {
          name: `Remove filter: ${values.includes('INTERNAL') || values.length === 2 ? 'Internal movements' : values[0] === 'OWN_TRANSFER' ? 'Own transfer' : 'Currency exchange'}`,
          exact: true,
        }),
      ).toBeVisible();
      await openTransactionFilter(page, 'Cash flow');
      const parent = page.getByRole('option', {name: 'Internal movements', exact: true});
      const both = values.includes('INTERNAL') || values.length === 2;
      await expect(parent).toHaveAttribute('data-filter-selected', both ? 'true' : 'mixed');
      await expect
        .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
        .toEqual(both ? ['INTERNAL'] : values);
      if (both) {
        await page.getByRole('option', {name: 'Currency exchange', exact: true}).click();
      } else {
        await parent.click();
        await expect(parent).toHaveAttribute('data-filter-selected', 'true');
        const removedLabel = remaining === 'OWN_TRANSFER' ? 'Currency exchange' : 'Own transfer';
        await page.getByRole('option', {name: removedLabel, exact: true}).click();
      }
      await expect(parent).toHaveAttribute('data-filter-selected', 'mixed');
      await expect
        .poll(() => JSON.parse(new URL(page.url()).searchParams.get('cashFlows')!) as string[])
        .toEqual([remaining]);
      const search = new URL(page.url()).searchParams;
      expect(search.get('baseAmount')).toBe('PRESENT');
      expect(JSON.parse(search.get('categoryStatuses')!)).toEqual(['FAILED']);
      expect(search.has('financialEventTypes')).toBe(false);
      await page
        .getByRole('option', {
          name: remaining === 'OWN_TRANSFER' ? 'Own transfer' : 'Currency exchange',
          exact: true,
        })
        .click();
      await expect(parent).toHaveAttribute('data-filter-selected', 'false');
      await expect.poll(() => new URL(page.url()).searchParams.has('cashFlows')).toBe(false);
    });
  }
}
