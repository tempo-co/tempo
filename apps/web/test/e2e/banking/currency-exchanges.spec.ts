import {OWN_TRANSFER_USER_AUTH_FILE} from '../../constants/auth.constants';
import {expect, test} from '../../fixtures';
import {boxOf} from '../../utils/layout';

// Synthetic exchange legs seeded by the API's own-transfer seed (scripts/seed-data/seed-own-transfer-data.ts).
const EXCHANGE_OUTGOING_ID = '00000000-0000-4000-8000-000000000111';
const EXCHANGE_INCOMING_ID = '00000000-0000-4000-8000-000000000112';
const UNMATCHED_EXCHANGE_ID = '00000000-0000-4000-8000-000000000113';

test.describe('currency exchanges', () => {
  test.use({storageState: OWN_TRANSFER_USER_AUTH_FILE});

  test('links the other side of an exchange both ways', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`/bank-transactions?transactionId=${EXCHANGE_OUTGOING_ID}`);
    const inspector = page.getByTestId('bank-transaction-inspector');
    const exchange = inspector.getByTestId('bank-transaction-currency-exchange');
    await expect(inspector.getByText('Currency exchange', {exact: true})).toBeVisible();
    // Exchanges are never offered as own transfers.
    await expect(inspector.getByTestId('bank-transaction-own-transfer')).toHaveCount(0);

    const counterpartCard = exchange.getByTestId('bank-transaction-currency-exchange-counterpart');
    await expect(counterpartCard).toContainText('Revolut · USD');
    await expect(counterpartCard).toHaveAccessibleName(/\$92\.00/);
    await counterpartCard.click();

    await expect(page).toHaveURL(new RegExp(`transactionId=${EXCHANGE_INCOMING_ID}`));
    await expect(inspector.getByTestId('bank-transaction-detail-amount')).toContainText('92');
    const backCard = exchange.getByTestId('bank-transaction-currency-exchange-counterpart');
    await expect(backCard).toContainText('Travel');
    await expect(backCard).toHaveAccessibleName(/€80\.00/);
    await backCard.click();
    await expect(page).toHaveURL(new RegExp(`transactionId=${EXCHANGE_OUTGOING_ID}`));
  });

  test('says when the other side is not matched', async ({page}) => {
    await page.goto(`/bank-transactions?transactionId=${UNMATCHED_EXCHANGE_ID}`);
    const exchange = page.getByTestId('bank-transaction-currency-exchange');
    await expect(exchange).toContainText('Not matched');
    await expect(exchange.getByRole('link')).toHaveCount(0);
  });

  test('fits the other side on mobile', async ({page}) => {
    await page.setViewportSize({width: 393, height: 852});
    await page.goto(`/bank-transactions?transactionId=${EXCHANGE_OUTGOING_ID}`);
    const exchange = page.getByTestId('bank-transaction-currency-exchange');
    const counterpartCard = exchange.getByTestId('bank-transaction-currency-exchange-counterpart');
    await expect(counterpartCard).toBeVisible();
    await expect
      .poll(() => counterpartCard.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    expect((await boxOf(exchange)).width).toBeLessThanOrEqual(393);
  });
});
