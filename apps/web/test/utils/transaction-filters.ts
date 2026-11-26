import type {Page} from '@playwright/test';

/**
 * Opens the Transactions page's "+ Add filter" control on one filter: its step in the desktop popover or the phone
 * sheet (below 768px). Returns the control; the filter's options are `option`s inside it.
 */
export async function openTransactionFilter(page: Page, label: string) {
  const panel = page.getByTestId('bank-transaction-filters');
  if (!(await panel.isVisible()))
    await page.getByTestId('bank-transaction-filters-trigger').click();
  const back = panel.getByRole('button', {name: 'Back to filters'});
  if (await back.isVisible()) await back.click();
  await panel.getByRole('button', {name: new RegExp(`^${label}`)}).click();
  await panel.getByRole('heading', {name: label, exact: true}).waitFor();
  return panel;
}
