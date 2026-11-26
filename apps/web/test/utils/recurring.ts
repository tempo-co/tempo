import type {Locator, Page} from '@playwright/test';

import {expect} from '../fixtures';

/** A series' row, by its key or by its name. */
export const row = (scope: Page | Locator, series: string | {name: string}) =>
  typeof series === 'string'
    ? scope.getByTestId(`recurring-series-${series}`)
    : scope.getByTestId(/^recurring-series-/).filter({hasText: series.name});
/** One of This month's groups. */
export const group = (page: Page, name: 'Late' | 'Coming up' | 'Paid' | 'Income') =>
  page.getByRole('region', {name, exact: true});
/** One of All recurring's cards. */
export const card = (page: Page, name: 'Bills' | 'Income') =>
  page.getByRole('region', {name, exact: true});
export const summaryOf = (page: Page) => page.getByTestId('recurring-summary');
export const detail = (page: Page) => page.getByRole('region', {name: 'Recurring payment details'});

/** Closes a series' details, back to the list. */
export async function closeDetails(page: Page) {
  await page.getByRole('button', {name: 'Close details'}).click();
  await expect(detail(page)).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]series=/);
}
