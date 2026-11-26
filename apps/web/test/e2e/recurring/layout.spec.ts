import type {Page} from '@playwright/test';

import {demoRecurring, mockRecurringPage, worstCaseRecurring} from '../../data/recurring.data';
import {expect, test} from '../../fixtures';
import {boxOf, brokenAmounts, expectLoaded, expectNoHorizontalOverflow} from '../../utils/layout';

test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

const layouts = [
  {width: 1440, theme: 'light'},
  {width: 1440, theme: 'dark'},
  {width: 390, theme: 'light'},
  {width: 390, theme: 'dark'},
  {width: 320, theme: 'dark'},
] as const;

/** Series rows that are not the shared 60px row with a 36px tile, by name. */
const offRows = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'main [data-testid^="recurring-series-"] > button, main [data-testid^="recurring-later-"] > button, main [data-testid^="recurring-calendar-item-"] > button',
      ),
    )
      .filter((row) => row.offsetParent !== null)
      .filter((row) => {
        const tile = row.querySelector<HTMLElement>('[data-testid="merchant-logo-tile"]');
        const box = tile?.getBoundingClientRect();
        return row.offsetHeight !== 60 || box?.width !== 36 || box.height !== 36;
      })
      .map((row) => row.getAttribute('aria-label')),
  );

/** Calendar days whose payments run out of the day, and days narrower than the others. */
const brokenDays = (page: Page) =>
  page.evaluate(() => {
    const days = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="recurring-day-"]'),
    );
    const widths = new Set(days.map((day) => Math.round(day.getBoundingClientRect().width)));
    const spilled = days
      .filter((day) => {
        const box = day.getBoundingClientRect();
        return Array.from(day.querySelectorAll('button')).some((chip) => {
          const rect = chip.getBoundingClientRect();
          return rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
        });
      })
      .map((day) => day.dataset.testid);
    return {widths: widths.size, spilled};
  });

for (const [name, lists] of [
  ['demo', demoRecurring],
  ['worst-case', worstCaseRecurring],
] as const) {
  for (const {width, theme} of layouts) {
    test(`Recurring fits ${name} data at ${width}px in ${theme}`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({width, height: 1000});
      await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
      await page.addInitScript((value) => localStorage.setItem('vite-ui-theme', value), theme);
      const data = lists();
      await mockRecurringPage(page, data);
      await page.goto('/recurring');
      await expect(page.getByTestId('recurring-summary')).toBeVisible();
      await expectLoaded(page);
      await page.evaluate(() => document.fonts.ready);

      // This month as a list.
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      expect.soft(await offRows(page)).toEqual([]);
      // Demo figures share one line from 390px up; larger ones may wrap but are never cut short.
      const figures = page.getByTestId('recurring-summary').locator('dd');
      if (name === 'demo' && width >= 390) {
        const tops = await Promise.all(
          (await figures.all()).map(async (dd) => (await boxOf(dd)).y),
        );
        expect.soft(new Set(tops).size).toBe(1);
      }

      // This month on a calendar: seven equal columns, every payment inside its day.
      await page.getByRole('radio', {name: 'Calendar'}).click();
      await expect(page.getByTestId('recurring-day-2026-10-01')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      expect.soft(await brokenDays(page)).toEqual({widths: 1, spilled: []});
      // A day's payments open as rows under the calendar: on a phone by tapping the day, which is a touch target.
      const firstDay = page.getByTestId('recurring-day-2026-10-01');
      if (width < 768) {
        const dayButton = firstDay.getByRole('button');
        expect.soft((await boxOf(dayButton)).height).toBeGreaterThanOrEqual(44);
        await dayButton.click();
        await expect(page.getByRole('region', {name: 'Payments on 1 October'})).toBeVisible();
        expect.soft(await offRows(page)).toEqual([]);
        await expectNoHorizontalOverflow(page);
        expect.soft(await brokenAmounts(page)).toEqual([]);
      }

      // All recurring.
      await page.getByRole('tab', {name: /^All recurring/}).click();
      await expect(page.getByRole('region', {name: 'Bills', exact: true})).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      expect.soft(await offRows(page)).toEqual([]);

      // A series' details, in the rail or a sheet.
      const first = data.expenses.series[0];
      await page.getByTestId(`recurring-series-${first.key}`).getByRole('button').click();
      const detail = page.getByRole('region', {name: 'Recurring payment details'});
      await expect(detail).toContainText(first.name);
      await expectLoaded(detail);
      await expectNoHorizontalOverflow(page);
      expect.soft(await brokenAmounts(page)).toEqual([]);
      // The close button stays inside the rail's card or the sheet.
      const [frameBox, closeBox] = await Promise.all([
        boxOf(detail.locator('..')),
        boxOf(detail.getByRole('button', {name: 'Close details'})),
      ]);
      expect.soft(closeBox.x + closeBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);

      expect(errors).toEqual([]);
    });
  }
}
