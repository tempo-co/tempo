import type {Page} from '@playwright/test';

import {mockSyntheticHome} from '../../data/home-history.data';
import {expect, test} from '../../fixtures';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/** Home's To do card: its rows in order. */
const toDoRows = (page: Page) =>
  page.getByRole('main').getByRole('region', {name: 'To do', exact: true}).getByRole('listitem');

test.describe('Installing Tempo on an iPhone', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    timezoneId: 'Europe/Amsterdam',
    userAgent: IPHONE_SAFARI,
    viewport: {width: 390, height: 844},
  });

  test("Home offers it once below the check row with Safari's steps, × hides it for good, and Appearance still has Install", async ({
    page,
  }) => {
    await mockSyntheticHome(page);
    await page.goto('/');

    const rows = toDoRows(page);
    await expect(rows.first()).toContainText('Check 3 transactions');
    const card = rows.nth(1);
    await expect(card).toContainText('Add Tempo to your Home Screen');
    await card.getByRole('button', {name: 'Add'}).click();
    const steps = page.getByRole('dialog', {name: 'Add Tempo to your Home Screen'});
    await expect(steps.getByRole('listitem')).toHaveText([
      /^1Tap Share in Safari’s toolbar$/,
      /^2Scroll and tap Add to Home Screen$/,
      /^3Tap Add\. Tempo then opens from its own icon\.$/,
    ]);
    await steps.getByRole('button', {name: 'Done'}).click();
    await expect(steps).toBeHidden();
    await expect(card.getByRole('button', {name: 'Add'})).toBeFocused();
    await expect(card).toContainText('Add Tempo to your Home Screen');

    await card.getByRole('button', {name: 'Don’t show again'}).click();
    await expect(page.getByText('Add Tempo to your Home Screen')).toHaveCount(0);
    await page.reload();
    await expect(rows.first()).toContainText('Check 3 transactions');
    await expect(page.getByText('Add Tempo to your Home Screen')).toHaveCount(0);

    await page.goto('/settings/appearance');
    await page.getByRole('button', {name: 'Install'}).click();
    await expect(page.getByRole('dialog', {name: 'Add Tempo to your Home Screen'})).toBeVisible();
  });

  test('× in another tab of the browser hides it here too', async ({page}) => {
    await mockSyntheticHome(page);
    await page.goto('/');
    await expect(toDoRows(page).nth(1)).toContainText('Add Tempo to your Home Screen');

    // What another tab's × does to this one: it saves the dismissal, and this tab hears of it.
    await page.evaluate(() => {
      localStorage.setItem('tempo.install-card-dismissed', '1');
      window.dispatchEvent(
        new StorageEvent('storage', {key: 'tempo.install-card-dismissed', newValue: '1'}),
      );
    });
    await expect(page.getByText('Add Tempo to your Home Screen')).toHaveCount(0);
  });

  test('neither Home nor Appearance offers it when Tempo runs from the Home Screen', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', {value: true});
    });
    await mockSyntheticHome(page);
    await page.goto('/');
    await expect(toDoRows(page).first()).toContainText('Check 3 transactions');
    await expect(page.getByText('Add Tempo to your Home Screen')).toHaveCount(0);

    await page.goto('/settings/appearance');
    await expect(page.getByRole('heading', {name: 'Theme'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'App', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Install'})).toHaveCount(0);
  });
});

test.describe('Installing Tempo on Android', () => {
  test.use({
    storageState: {cookies: [], origins: []},
    timezoneId: 'Europe/Amsterdam',
    userAgent: ANDROID_CHROME,
    viewport: {width: 390, height: 844},
  });

  test("Add opens Chrome's own install prompt, once the browser offers one", async ({page}) => {
    // Chrome's install event, as it fires shortly after the page loads; `prompt` records that it was opened.
    await page.addInitScript(() => {
      const prompts: string[] = [];
      (window as unknown as {installPrompts: string[]}).installPrompts = prompts;
      window.addEventListener('load', () => {
        const event = Object.assign(new Event('beforeinstallprompt', {cancelable: true}), {
          prompt: () => {
            prompts.push('prompt');
            return Promise.resolve();
          },
          userChoice: Promise.resolve({outcome: 'accepted'}),
        });
        window.dispatchEvent(event);
      });
    });
    await mockSyntheticHome(page);
    await page.goto('/');

    const card = toDoRows(page).nth(1);
    await expect(card).toContainText('Add Tempo to your Home Screen');
    await card.getByRole('button', {name: 'Add'}).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as {installPrompts: string[]}).installPrompts),
      )
      .toEqual(['prompt']);
    // Chrome's prompt opens once per event, so the card goes with it.
    await expect(page.getByText('Add Tempo to your Home Screen')).toHaveCount(0);
  });
});
