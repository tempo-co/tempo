import {expect, test} from '@playwright/test';
import {AppearanceSettingsPage} from 'test/pages/appearance-settings.page';
import {VERIFIED_USER_AUTH_FILE} from 'test/utils/seed.constants';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test.describe('Theme Switcher', () => {
  let appearanceSettingsPage: AppearanceSettingsPage;

  test.beforeEach(async ({page}) => {
    appearanceSettingsPage = new AppearanceSettingsPage(page);

    await appearanceSettingsPage.navigate();
  });

  test('should switch to light theme', async () => {
    await appearanceSettingsPage.lightThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    const theme = await appearanceSettingsPage.getStoredTheme();
    expect(theme).toBe('light');
  });

  test('should switch to dark theme', async () => {
    // first switch to light to ensure a state change will occur
    await appearanceSettingsPage.lightThemeButton.click();
    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    await appearanceSettingsPage.darkThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/dark/);
    const theme = await appearanceSettingsPage.getStoredTheme();
    expect(theme).toBe('dark');
  });

  test('should switch to system theme', async () => {
    await appearanceSettingsPage.systemThemeButton.click();

    const theme = await appearanceSettingsPage.getStoredTheme();
    expect(theme).toBe('system');
  });
});
