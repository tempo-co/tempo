import type {Page} from '@playwright/test';
import type {RecurringSeriesLists} from '@wisp/contracts';

import {RECURRING_USER_AUTH_FILE} from '../../constants/auth.constants';
import {API_URL, APP_ORIGIN_HEADERS, expect, test} from '../../fixtures';
import {expectNoHorizontalOverflow} from '../../utils/layout';
import {closeDetails, detail, group, row, summaryOf} from '../../utils/recurring';

// The owner seeded with this month's payments (apps/api/scripts/seed-data/seed-recurring-data.ts); only this flow reads
// it, and it puts back what it hides.
test.use({storageState: RECURRING_USER_AUTH_FILE, timezoneId: 'Europe/Amsterdam'});

const AS_OF = '2026-10-15';
const ENERGY = {name: 'Example Energy'};

const calendarDay = (page: Page, date: string) => page.getByTestId(`recurring-day-${date}`);

/**
 * A payment on the calendar. From a tablet up it is a chip on its day; on a phone a day is too narrow to tap one
 * payment in, so this taps the day and finds the payment in the list under the calendar.
 */
async function calendarPayment(
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

for (const viewport of [
  {width: 1280, height: 800},
  {width: 390, height: 844},
]) {
  const wide = viewport.width >= 1024;

  test(`shows this month's seeded bills by status and on a calendar, opens one at its address and hides it with undo at ${viewport.width}px`, async ({
    page,
  }) => {
    // A retry starts from the seed: a series an earlier attempt hid is counted again.
    const lists = (await (
      await page.request.get(`${API_URL}/recurring-series?asOf=${AS_OF}`)
    ).json()) as RecurringSeriesLists;
    for (const {key} of lists.expenses.series.filter(({hidden}) => hidden)) {
      const shown = await page.request.patch(`${API_URL}/recurring-series/${key}/hidden`, {
        data: {hidden: false},
        headers: APP_ORIGIN_HEADERS,
      });
      expect(shown.status()).toBe(204);
    }

    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date(`${AS_OF}T10:00:00Z`));
    await page.goto('/recurring');

    // The month's bills, what is paid and what is still to pay, as the API counts the seeded payments.
    await expect(summaryOf(page)).toContainText('Bills in October€146.99');
    await expect(summaryOf(page)).toContainText('Paid€29.99');
    await expect(summaryOf(page)).toContainText('Still to pay€117.00');
    await expect(summaryOf(page)).toContainText('Income +€2,500.00 · €2,500.00 still to come');

    // Late and coming up add up to what is still to pay, paid to what is paid; salary has its own group.
    await expect(group(page, 'Late').getByRole('heading')).toHaveText('Late€77.00');
    await expect(row(group(page, 'Late'), ENERGY)).toContainText('Monthly · expected 12 Oct');
    await expect(row(group(page, 'Late'), ENERGY)).toContainText('about €77');
    await expect(group(page, 'Coming up').getByRole('heading')).toHaveText('Coming up€40.00');
    await expect(group(page, 'Coming up').getByTestId(/^recurring-series-/)).toHaveText([
      /Example Internet.*Monthly · next 20 Oct.*€40\.00/,
    ]);
    await expect(group(page, 'Paid').getByRole('heading')).toHaveText('Paid€29.99');
    await expect(group(page, 'Paid').getByTestId(/^recurring-series-/)).toHaveText([
      /Example Gym.*Monthly · paid 3 Oct.*€29\.99/,
    ]);
    await expect(group(page, 'Income').getByRole('heading')).toHaveText('Income+€2,500.00');
    await expect(group(page, 'Income').getByTestId(/^recurring-series-/)).toHaveText([
      /Example Employer.*Monthly · next 25 Oct.*\+€2,500\.00/,
    ]);
    // A quarterly bill between payments is listed apart, beside a year of bills.
    await expect(page.getByRole('region', {name: 'Not this month'})).toContainText(
      'Example InsurerQuarterly · next 25 Nov 2026',
    );
    await expect(page.getByRole('region', {name: 'A year of bills'})).toContainText('€2,124');
    await expectNoHorizontalOverflow(page);

    // The calendar places each payment on its paid or expected day.
    await page.getByRole('radio', {name: 'Calendar'}).click();
    await expect(page).toHaveURL(/[?&]view=calendar/);
    await expect(group(page, 'Late')).toBeHidden();
    await expect(calendarDay(page, AS_OF)).toHaveAttribute('aria-current', 'date');
    const at = (payment: {date: string; name: string; amount: string; kind: string}) =>
      calendarPayment(page, viewport.width, payment);
    await expect(
      await at({date: '2026-10-03', name: 'Example Gym', amount: '€29.99', kind: 'paid'}),
    ).toBeVisible();
    const energy = await at({
      date: '2026-10-12',
      name: 'Example Energy',
      amount: 'about €77',
      kind: 'late',
    });
    await expect(energy).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A series opens at its own address: in the rail beside the calendar, or a sheet on a phone.
    await energy.click();
    await expect(page).toHaveURL(/[?&]series=[0-9a-f]{32}/);
    await expect(detail(page)).toContainText('Example Energy');
    await expect(page.getByRole('dialog')).toHaveCount(wide ? 0 : 1);
    await expect(detail(page)).toContainText('Usually about€77');
    await expect(detail(page)).toContainText('Expected 12 Oct, not paid yet');
    await page.reload();
    await expect(detail(page)).toContainText('Example Energy');

    // Hiding takes it out of the month's figures and groups; Undo brings it back.
    await detail(page).getByRole('button', {name: 'Not recurring'}).click();
    await expect(page.getByText('Hidden from recurring payments.')).toBeVisible();
    await closeDetails(page);
    await page.getByRole('radio', {name: 'List'}).click();
    await expect(summaryOf(page)).toContainText('Still to pay€40.00');
    await expect(group(page, 'Late')).toBeHidden();
    await page.getByRole('button', {name: 'Undo'}).click();
    await expect(row(group(page, 'Late'), ENERGY)).toBeVisible();
    await expect(summaryOf(page)).toContainText('Still to pay€117.00');
  });
}
