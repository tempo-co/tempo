import type {Locator, Page} from '@playwright/test';
import {BANK_LIST} from '@tempo/contracts';

import {expect, test} from '../../fixtures';
import {mockAccountsApi} from '../../utils/accounts';
import {mockJson} from '../../utils/api-mocks';
import {routeMockedBankApp} from '../../utils/bank-connections';
import {animationsSettled, boxOf, expectNoHorizontalOverflow} from '../../utils/layout';

/** Worst cases: a bank name as long as real cooperative banks' legal names, with a hyphenated run and diacritics. */
const LONG_BANK = {
  name: 'Example Raiffeisenlandesbank Niederösterreich-Wien-Burgenland Genossenschaft',
  country: 'AT',
};

/** The bank this tab left for, as the hand-off remembers it, then the bank's return with `result`. */
async function returnFromBank(page: Page, result: 'cancelled' | 'error') {
  await page.goto('/settings/profile');
  await page.evaluate(
    (bank) => sessionStorage.setItem('wisp-connecting-bank', JSON.stringify(bank)),
    LONG_BANK,
  );
  await page.goto(`/accounts?result=${result}`);
  const sheet = page.getByTestId('add-data-sheet');
  await expect(sheet.getByRole('alert')).toBeVisible();
  await animationsSettled(sheet);
  return sheet;
}

/**
 * Inside the window and the sheet, nothing scrolls sideways, and every button is whole and in reach: a button in a
 * scrolling body counts once it is scrolled into its view, and the body itself ends inside the window.
 */
async function expectInside(page: Page, sheet: Locator) {
  await expectNoHorizontalOverflow(page);
  const viewport = page.viewportSize()!;
  const box = await boxOf(sheet);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(viewport.width);
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const scroller of await sheet.locator('[data-radix-scroll-area-viewport]').all()) {
    const own = await boxOf(scroller);
    expect(own.y + own.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  for (const button of await sheet.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const scrolledAway = await button.evaluate((element) => {
      const scroller = element.closest('[data-radix-scroll-area-viewport]');
      if (!scroller) return false;
      const [own, view] = [element.getBoundingClientRect(), scroller.getBoundingClientRect()];
      return own.bottom > view.bottom + 0.5 || own.top < view.top - 0.5;
    });
    if (scrolledAway) continue;
    const own = await boxOf(button);
    expect(own.x).toBeGreaterThanOrEqual(box.x);
    expect(own.x + own.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(own.y + own.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
  }
  // A title wraps, or on the hand-off truncates with the name in full below; either way it ends inside the sheet.
  const title = await boxOf(sheet.getByRole('heading').first());
  expect(title.x + title.width).toBeLessThanOrEqual(box.x + box.width);
}

test.describe('Add data sheet layout', () => {
  test.use({storageState: {cookies: [], origins: []}, serviceWorkers: 'block'});

  test.beforeEach(async ({page, baseURL}) => {
    await routeMockedBankApp(page, baseURL);
    await mockAccountsApi(page, () => ({connections: [], imports: []}));
    await mockJson(page, '**/bank-connections/aspsps', [{...LONG_BANK, logoUrl: null}]);
  });

  for (const {width, height} of [
    {width: 320, height: 568},
    {width: 390, height: 844},
    {width: 1440, height: 900},
  ])
    for (const theme of ['light', 'dark'] as const)
      test(`keeps every step inside the sheet with a long bank name at ${width}px in ${theme}`, async ({
        page,
      }) => {
        await page.setViewportSize({width, height});
        await page.emulateMedia({colorScheme: theme});

        // The ways in, then the import's first step.
        await page.goto('/settings/profile');
        await page.getByRole('button', {name: 'Add data'}).click();
        const sheet = page.getByTestId('add-data-sheet');
        await expect(sheet.getByRole('heading', {name: 'Add data'})).toBeVisible();
        await animationsSettled(sheet);
        await expectInside(page, sheet);
        // On phones, one bottom sheet the window's width; on desktop, a side sheet the window's height.
        const box = await boxOf(sheet);
        if (width < 768) {
          expect(Math.round(box.width)).toBe(width);
          expect(Math.round(box.y + box.height)).toBe(height);
        } else {
          // Up to the page's reserved scrollbar gutter, where every overlay's backdrop ends too.
          const pageWidth = await page.evaluate(() => {
            const probe = document.body.appendChild(document.createElement('div'));
            probe.style.cssText = 'position:fixed;inset:0';
            const right = probe.getBoundingClientRect().right;
            probe.remove();
            return right;
          });
          expect(Math.round(box.x + box.width)).toBe(pageWidth);
          expect(Math.round(box.height)).toBe(height);
        }
        await sheet.getByRole('button', {name: /^Import a statement file/}).click();
        await expect(
          sheet.getByRole('heading', {name: 'Which bank is the file from?'}),
        ).toBeVisible();
        await expectInside(page, sheet);
        // The bank with the longest name and the most steps, then the file choice under its steps.
        const longest = [...BANK_LIST].sort(
          (left, right) =>
            right.name.length - left.name.length ||
            right.exportSteps.steps.join('').length - left.exportSteps.steps.join('').length,
        )[0];
        // Its row's name is the bank's name followed by its country.
        await sheet.getByRole('button', {name: longest.name}).click();
        await expect(sheet.getByRole('heading', {name: 'Import a file'})).toBeVisible();
        await expectInside(page, sheet);

        // The hand-off to the long-named bank.
        await sheet.getByRole('button', {name: 'Back to the banks'}).click();
        await sheet.getByRole('button', {name: 'Back to Add data'}).click();
        await sheet.getByRole('button', {name: /^Connect a bank/}).click();
        await sheet.getByRole('button', {name: LONG_BANK.name, exact: true}).click();
        await expect(sheet.getByTestId('bank-connection-confirm')).toBeVisible();
        await expectInside(page, sheet);

        // Back from the bank unfinished, then failed.
        for (const result of ['cancelled', 'error'] as const) {
          const returned = await returnFromBank(page, result);
          await expect(returned.getByRole('heading').first()).toContainText(LONG_BANK.name);
          await expectInside(page, returned);
          await page.keyboard.press('Escape');
          await expect(returned).toBeHidden();
        }
      });
});
