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
export const calendarDay = (page: Page, date: string) => page.getByTestId(`recurring-day-${date}`);

/** Closes a series' details, back to the list. */
export async function closeDetails(page: Page) {
  await page.getByRole('button', {name: 'Close details'}).click();
  await expect(detail(page)).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]series=/);
}

/**
 * A payment on the calendar. From a tablet up it is a chip on its day; on a phone a day is too narrow to tap one
 * payment in, so this taps the day and finds the payment in the list under the calendar.
 */
export async function calendarPayment(
  page: Page,
  width: number,
  {date, name, amount, kind}: {date: string; name: string; amount: string; kind: string},
) {
  if (width >= 768)
    return calendarDay(page, date).getByRole('button', {name: `${name}, ${amount}, ${kind}`});
  await calendarDay(page, date).getByRole('button').click();
  return page
    .getByRole('region', {name: /^Payments on /})
    .getByRole('button', {name: new RegExp(`^${name}, .* · ${kind} .*, ${amount}$`)});
}
