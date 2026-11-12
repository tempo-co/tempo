import type {Page} from '@playwright/test';

import {createAccount} from '../data/account.data';
import {mockSyntheticHome} from '../data/home-history.data';
import {expect, test} from '../fixtures';
import {boxOf, expectNoHorizontalOverflow} from '../utils/layout';
import {openTransactionFilter} from '../utils/transaction-filters';

test.use({
  viewport: {width: 320, height: 850},
  isMobile: true,
  hasTouch: true,
  timezoneId: 'Europe/Amsterdam',
  storageState: {cookies: [], origins: []},
});

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    const pulses: number[] = [];
    Object.assign(window, {selectionHaptics: pulses});
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (duration: number) => {
        pulses.push(duration);
        return true;
      },
    });
  });
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await page.route('**/health', (route) => route.fulfill({status: 200, json: {status: 'ok'}}));
  await page.route('**/accounts/me', (route) =>
    route.fulfill({
      json: createAccount({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Example Owner',
        email: 'owner@example.com',
      }),
    }),
  );
  await page.route('**/bank-transactions?**', (route) =>
    route.fulfill({
      json: {
        transactions: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            description: 'Example purchase',
            bookingDate: '2026-10-05',
            amount: '-10.00',
            currency: 'EUR',
            category: 'OTHER',
            categoryStatus: 'COMPLETED',
            categorySource: 'MANUAL',
            financialEventType: null,
            cashFlowTreatment: 'EXPENSE',
          },
        ],
        total: 1,
      },
    }),
  );
});

/** The token dialog's Expiration select, a Select every pointer type reaches; it starts on 90 days. */
async function openExpirationSelect(page: Page) {
  await page.route('**/personal-access-tokens', (route) => route.fulfill({json: []}));
  await page.goto('/settings/integrations');
  await page.getByRole('button', {name: 'Create token', exact: true}).click();
  const select = page.getByRole('dialog').getByRole('combobox', {name: 'Expiration'});
  await expect(select).toHaveText('90 days');
  return select;
}

test('touch date selection fills the available seven-column calendar on a narrow phone', async ({
  page,
}) => {
  await page.goto('/bank-transactions');
  const drawer = await openTransactionFilter(page, 'Booking date');
  const calendar = drawer.getByTestId('bank-transaction-mobile-calendar');
  await expect(calendar).toBeVisible();
  // Only the filter's options scroll; the sheet keeps its title and actions in place.
  await expect(drawer).toHaveCSS('overflow-y', 'hidden');
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const sheet = await boxOf(drawer);
  expect(sheet.y).toBeGreaterThanOrEqual(0);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const month = calendar.getByRole('combobox', {name: 'Month:'});
  await expect(month).toBeVisible();
  expect((await boxOf(month)).height).toBeGreaterThanOrEqual(44);
  const previous = await boxOf(calendar.getByRole('button', {name: 'Go to previous month'}));
  const next = await boxOf(calendar.getByRole('button', {name: 'Go to next month'}));
  const monthBox = await boxOf(month);
  const yearBox = await boxOf(calendar.getByRole('combobox', {name: 'Year:'}));
  expect(previous.height).toBeGreaterThanOrEqual(44);
  expect(yearBox.height).toBeGreaterThanOrEqual(44);
  expect(previous.x + previous.width).toBeLessThanOrEqual(monthBox.x);
  expect(yearBox.x + yearBox.width).toBeLessThanOrEqual(next.x);
  const week = calendar.locator('tbody tr').nth(1);
  const cells = await week.locator('td').evaluateAll((items) =>
    items.map((item) => ({
      cell: item.getBoundingClientRect().width,
      hit: item.querySelector('button')!.getBoundingClientRect().width,
      height: item.querySelector('button')!.getBoundingClientRect().height,
    })),
  );
  expect(cells).toHaveLength(7);
  for (const cell of cells) {
    expect(cell.hit).toBeCloseTo(cell.cell, 0);
    expect(cell.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
  const bounds = await boxOf(calendar);
  const lastDay = await boxOf(week.locator('td').last());
  expect(lastDay.x + lastDay.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  await calendar.getByRole('gridcell', {name: '5', exact: true}).tap();
  await expect(page).toHaveURL(/bookingDate/);
});

for (const width of [320, 820]) {
  test(`touch selection presents finger-sized options at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 850});
    const trigger = await openExpirationSelect(page);
    // Measure once the dialog has opened: mid-animation, its boxes carry rounding from the moving transform.
    await page
      .getByRole('dialog')
      .evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
    // The token dialog sizes its trigger for phones; the options are finger-sized everywhere.
    if (width < 640) expect((await boxOf(trigger)).height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    const option = page.getByRole('option', {name: '1 year', exact: true});
    await expect(option).toBeVisible();
    await expect.poll(async () => (await boxOf(option)).height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await expect(trigger).toHaveText('1 year');
    await trigger.tap();
    await page.getByRole('option', {name: '1 year', exact: true}).tap();
    await expect(page.getByRole('listbox')).toBeHidden();
    expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual([
      8,
    ]);
  });
}

async function swipeFilterUp(page: Page) {
  test.skip(
    page.context().browser()?.browserType().name() !== 'chromium',
    'Touches are sent through Chromium CDP.',
  );
  const viewport = page
    .getByTestId('bank-transaction-filters-scroll-area')
    .locator(':scope > [data-radix-scroll-area-viewport]');
  await expect
    .poll(() =>
      page
        .getByTestId('bank-transaction-filters')
        .evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(850);
  const box = await boxOf(viewport);
  const touch = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 40;
  await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
  for (let step = 1; step <= 10; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x, y: y - step * 24}],
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await touch.detach();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
}

test('touch category filtering uses readable search text and finger-sized choices', async ({
  page,
}) => {
  await page.goto('/bank-transactions');
  const drawer = await openTransactionFilter(page, 'Categories');
  const search = drawer.getByPlaceholder('Search categories...');
  await swipeFilterUp(page);
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
    [],
  );
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS('font-size', '16px');
  await search.tap();
  await search.fill('Food');
  const option = drawer.getByRole('option', {name: 'Food and drink', exact: true});
  expect((await boxOf(option)).height).toBeGreaterThanOrEqual(44);
  await option.tap();
  await expect(page).toHaveURL(/FOOD_AND_DRINK/);
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual([
    8,
  ]);
});

test('touch verification-code entry uses readable digits across the phone field', async ({
  page,
}) => {
  await page.route('**/accounts/me', (route) =>
    route.fulfill({
      json: createAccount({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Example Owner',
        email: 'owner@example.com',
        isEmailVerified: false,
      }),
    }),
  );
  await page.goto('/verify-email');
  await page.getByTestId('enter-code-manually-button').tap();
  const input = page.getByTestId('input-otp');
  await expect(input).toBeVisible();
  await input.tap();
  await input.fill('123456');
  const digit = page.getByText('1', {exact: true});
  await expect(digit).toHaveCSS('font-size', '16px');
  // The slots settle after the code fills them; WebKit can measure mid-transition.
  await expect.poll(async () => (await boxOf(digit)).height).toBeGreaterThanOrEqual(44);
  expect(
    await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await expect(page.getByTestId('verify-button')).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test('Home span choices are finger-sized and select quietly', async ({page}) => {
  // Home's reads are all answered here; CI's real API would sign the fake session out.
  await mockSyntheticHome(page);
  await page.goto('/');
  const spans = page
    .getByRole('region', {name: 'Where you stand'})
    .getByRole('radiogroup', {name: 'Span'});
  const threeYears = spans.getByRole('radio', {name: '3Y', exact: true});
  await expect(threeYears).toBeVisible();
  for (const button of await spans.getByRole('radio').all())
    expect((await boxOf(button)).height).toBeGreaterThanOrEqual(44);
  await threeYears.tap();
  await expect(threeYears).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
    [],
  );
  await expectNoHorizontalOverflow(page);
});

test('reduced-motion touch selections commit quietly', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  const size = await openExpirationSelect(page);
  await size.tap();
  await expect(page.getByRole('listbox')).toHaveCSS('animation-name', 'none');
  await page.getByRole('option', {name: '1 year', exact: true}).tap();
  await expect(size).toHaveText('1 year');
  await page.goto('/bank-transactions');
  const drawer = await openTransactionFilter(page, 'Categories');
  await swipeFilterUp(page);
  await drawer.getByPlaceholder('Search categories...').fill('Food');
  await drawer.getByRole('option', {name: 'Food and drink', exact: true}).tap();
  await expect(page).toHaveURL(/FOOD_AND_DRINK/);
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
    [],
  );
});

for (const support of ['unavailable', 'restricted']) {
  test(`touch selections work when haptics are ${support}`, async ({page}) => {
    const size = await openExpirationSelect(page);
    await page.evaluate((mode) => {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value:
          mode === 'unavailable'
            ? undefined
            : () => {
                throw new Error('Feedback restricted');
              },
      });
    }, support);
    await size.tap();
    await page.getByRole('option', {name: '1 year', exact: true}).tap();
    await expect(size).toHaveText('1 year');
    await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).tap();
    await page.getByRole('link', {name: 'Transactions'}).tap();
    const drawer = await openTransactionFilter(page, 'Categories');
    await swipeFilterUp(page);
    await drawer.getByPlaceholder('Search categories...').fill('Food');
    await drawer.getByRole('option', {name: 'Food and drink', exact: true}).tap();
    await expect(page).toHaveURL(/FOOD_AND_DRINK/);
  });
}

test('cancelled touch selection leaves the value unchanged and keyboard selection stays quiet', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Touches are sent through Chromium CDP.');
  const size = await openExpirationSelect(page);
  await size.tap();
  const option = page.getByRole('option', {name: '1 year', exact: true});
  await expect.poll(async () => (await boxOf(option)).height).toBeGreaterThanOrEqual(44);
  const box = await boxOf(option);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: box.x + box.width / 2, y: box.y + box.height / 2}],
  });
  await touch.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await touch.detach();
  await expect(option).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByRole('option', {name: '90 days', exact: true})).toHaveAttribute(
    'data-state',
    'checked',
  );
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
    [],
  );
  await option.focus();
  await option.press('Enter');
  await expect(size).toHaveText('1 year');
  expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
    [],
  );
});

test.describe('precise-pointer controls', () => {
  test.use({isMobile: false, hasTouch: false, viewport: {width: 1440, height: 900}});
  test('mouse and keyboard selections commit without haptics', async ({page}) => {
    const size = await openExpirationSelect(page);
    await size.click();
    await page.getByRole('option', {name: '30 days', exact: true}).click();
    await expect(size).toHaveText('30 days');
    await size.focus();
    await size.press('ArrowDown');
    await page.getByRole('option', {name: '1 year', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(size).toHaveText('1 year');
    await page.goto('/bank-transactions');
    await openTransactionFilter(page, 'Categories');
    const search = page.getByPlaceholder('Search categories...');
    await expect(search).toHaveCSS('font-size', '14px');
    await search.fill('Food');
    await page.getByRole('option', {name: 'Food and drink', exact: true}).click();
    await expect(page).toHaveURL(/FOOD_AND_DRINK/);
    await search.fill('Shopping');
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(page).toHaveURL(/SHOPPING/);
    expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
      [],
    );
  });
});

test('pending touch token creation keeps its expiration locked and quiet', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/personal-access-tokens', async (route) => {
    if (route.request().method() === 'POST') {
      await held;
      return route.fulfill({status: 500, json: {message: 'Example creation failure'}});
    }
    return route.fulfill({json: []});
  });
  await page.goto('/settings/integrations');
  await page.getByRole('button', {name: 'Create token', exact: true}).tap();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', {name: 'Name', exact: true}).fill('Example client');
  const expiration = dialog.getByRole('combobox', {name: 'Expiration'});
  const selectedExpiration = await expiration.innerText();
  await dialog.getByRole('button', {name: 'Create token', exact: true}).tap();
  try {
    await expect(expiration).toBeDisabled();
    const box = await boxOf(expiration);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(expiration).toHaveText(selectedExpiration);
    expect(await page.evaluate(() => Reflect.get(window, 'selectionHaptics') as number[])).toEqual(
      [],
    );
  } finally {
    release();
  }
  await expect(dialog.getByRole('alert')).toContainText('Your token could not be created');
  await expect(expiration).toBeEnabled();
});
