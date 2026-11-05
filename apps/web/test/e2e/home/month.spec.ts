import {MARKET_ID, mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';
import {fulfillJson} from '../../utils/api-mocks';
import {expectCategoryIcon} from '../../utils/layout';

// Every response is synthetic: these checks never read or mutate a shared API stack.
test.use({storageState: {cookies: [], origins: []}, timezoneId: 'Europe/Amsterdam'});

test('a month shows its money, where it went against the usual, and where it came from', async ({
  page,
  homePage,
}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-03');

  const dialog = homePage.monthDialog('March 2026');
  const figures = dialog.getByRole('region', {name: 'The month'});
  await expect(figures).toHaveText(
    'In€3,000Out€3,500Kept−€500−17% of inBalance at month end€18,500−€500 on Feb',
  );

  const went = dialog.getByRole('region', {name: 'Where it went'});
  await expect(went).toContainText('usual, last 12 months');
  const categories = went.getByRole('link');
  await expect(categories).toHaveCount(7);
  await expect(categories.nth(0)).toHaveText('Travel€1,500none usually');
  await expect(categories.nth(1)).toHaveText('Housing and utilities€1,2000% on usual');
  expect(decodeURIComponent((await categories.nth(0).getAttribute('href')) ?? '')).toContain(
    'categories=["TRAVEL"]',
  );
  await expectCategoryIcon(categories.nth(1), 'Housing and utilities');

  const came = dialog.getByRole('region', {name: 'Where it came from'});
  await expect(came.getByRole('link')).toHaveText(['Example Employer€3,000']);

  const transactions = dialog.getByRole('region', {name: 'Transactions'});
  await expect(transactions.getByRole('listitem')).toHaveCount(12);
  await transactions.getByRole('button', {name: 'Show all 15'}).click();
  await expect(transactions.getByRole('listitem')).toHaveCount(15);
  await expect(transactions.getByRole('link', {name: 'Open in Transactions'})).toHaveAttribute(
    'href',
    /bookingDate=/,
  );
});

test('a month without a full year of history before it has no usual', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2025-06');

  const dialog = homePage.monthDialog('June 2025');
  await expect(dialog.getByRole('region', {name: 'The month'})).toContainText('Kept+€5,000');
  const went = dialog.getByRole('region', {name: 'Where it went'});
  await expect(went.getByRole('link').first()).toHaveText('Housing and utilities€1,200');
  await expect(went).not.toContainText('usual');
  await expect(
    dialog.getByRole('region', {name: 'Where it came from'}).getByRole('link'),
  ).toHaveText(['Example Bonus€4,000', 'Example Employer€3,000']);
});

test('the running month reads as so far', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-11');

  const dialog = homePage.monthDialog('November 2026');
  await expect(dialog.getByRole('region', {name: 'The month'})).toHaveText(
    'In€0Out€1,200Kept so far−€1,200Balance now€24,300−€1,200 on Oct',
  );
  await expect(dialog.getByRole('region', {name: 'Where it came from'})).toContainText(
    'No income.',
  );
  await expect(dialog.getByRole('button', {name: 'Next month'})).toBeDisabled();
});

test('arrows step through months in place, and Back returns to Home', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await page.goto('/?month=2025-01');
  const length = await page.evaluate(() => history.length);

  await expect(homePage.monthDialog('January 2025')).toBeVisible();
  await page.getByRole('button', {name: 'Previous month'}).click();
  await expect(page).toHaveURL(/[?&]month=2024-12/);
  await expect(homePage.monthDialog('December 2024')).toBeVisible();
  // The first month of history has nothing before it.
  await expect(page.getByRole('button', {name: 'Previous month'})).toBeDisabled();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/[?&]month=2025-02/);
  await expect(homePage.monthDialog('February 2025')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(homePage.totalBalance).toHaveText('€24,300');
});

test('Escape and the close button leave the month', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/');
  await homePage.yearTable.getByRole('link', {name: 'October'}).click();
  const dialog = homePage.monthDialog('October 2026');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL('/');

  await homePage.yearTable.getByRole('link', {name: 'September'}).click();
  await page.getByRole('button', {name: 'Close the month'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL('/');
});

test('a merchant opens its page in Merchants', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  // The merchant's own page is not part of this check; answer it without reaching an API.
  await page.route(`**/merchants/${MARKET_ID}**`, (route) =>
    fulfillJson(route, {message: 'Merchant not found.'}, 404),
  );
  await page.route('**/merchants?**', (route) =>
    fulfillJson(route, {baseCurrency: 'EUR', merchants: [], total: 0}),
  );
  await page.goto('/?month=2026-10');

  const merchants = homePage
    .monthDialog('October 2026')
    .getByRole('region', {name: 'Biggest merchants'});
  await expect(merchants.getByRole('button')).toHaveCount(2);
  await merchants.getByRole('button', {name: /Example Market/}).click();
  await expect(page).toHaveURL(new RegExp(`merchants=open.*merchant=${MARKET_ID}`));
});

test('a month outside the history says so', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2019-04');
  await expect(homePage.monthDialog('April 2019')).toContainText('No history for April 2019.');
});

test('an invalid month is ignored', async ({page, homePage}) => {
  await mockSyntheticHome(page);
  await page.goto('/?month=2026-13');
  await expect(homePage.totalBalance).toHaveText('€24,300');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true});

  test('the month is a near full-height drawer without sideways scrolling', async ({
    page,
    homePage,
  }) => {
    await mockSyntheticHome(page);
    await page.goto('/?month=2026-03');
    const dialog = homePage.monthDialog('March 2026');
    await expect(dialog.getByRole('region', {name: 'Where it went'})).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.height).toBeGreaterThan(844 * 0.9);
    const overflow = await dialog.evaluate((element) =>
      Array.from(element.querySelectorAll('section')).some(
        (section) => section.scrollWidth > section.clientWidth + 1,
      ),
    );
    expect(overflow).toBe(false);
  });
});
