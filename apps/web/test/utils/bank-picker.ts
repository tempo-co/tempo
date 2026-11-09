import {type Page, expect} from '@playwright/test';

/**
 * Opens Connect a bank, chooses `bank.countryLabel` and `bank.name`, then presses Continue, which starts the
 * authorization request.
 */
export async function connectThroughPicker(page: Page, bank: {name: string; countryLabel: string}) {
  await page.getByRole('button', {name: 'Connect a bank'}).click();
  const picker = page.getByTestId('bank-connection-picker');
  await picker.getByTestId('bank-connection-country').click();
  await picker
    .getByRole('button', {name: new RegExp(`^${bank.countryLabel} \\d+ banks?$`)})
    .click();
  await picker.getByRole('button', {name: bank.name, exact: true}).click();
  await expect(picker.getByRole('heading', {name: `Connect ${bank.name}`})).toBeVisible();
  await picker.getByTestId('bank-connection-confirm').click();
}
