import type {Page} from '@playwright/test';

/**
 * Opens the Transactions page's Filters control on one filter: its tab in the desktop panel, or its step in the
 * phone sheet (below 768px). Returns the panel; the filter's options are `option`s inside it.
 */
export async function openTransactionFilter(page: Page, label: string) {
  const panel = page.getByTestId('bank-transaction-filters');
  if (!(await panel.isVisible()))
    await page.getByTestId('bank-transaction-filters-trigger').click();
  const name = new RegExp(`^${label}`);
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await panel.getByRole('tab', {name}).click();
    return panel;
  }
  const back = panel.getByRole('button', {name: 'Back to filters'});
  if (await back.isVisible()) await back.click();
  await panel.getByRole('button', {name}).click();
  await panel.getByRole('heading', {name: label, exact: true}).waitFor();
  return panel;
}
