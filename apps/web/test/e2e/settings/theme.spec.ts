import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';

import {expect, test} from '../../fixtures';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

test.describe('Theme Switcher', () => {
  test.beforeEach(async ({appearanceSettingsPage}) => {
    await appearanceSettingsPage.navigate();
  });

  test('should switch to light theme', async ({appearanceSettingsPage}) => {
    await appearanceSettingsPage.lightThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('light');
    await expect(appearanceSettingsPage.lightThemeButton).toHaveAttribute('aria-checked', 'true');

    // Clicking the active option again keeps it selected.
    await appearanceSettingsPage.lightThemeButton.click();
    await expect(appearanceSettingsPage.lightThemeButton).toHaveAttribute('aria-checked', 'true');
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('light');
  });

  test('should switch to dark theme', async ({appearanceSettingsPage}) => {
    // first switch to light to ensure a state change will occur
    await appearanceSettingsPage.lightThemeButton.click();
    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    await appearanceSettingsPage.darkThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/dark/);
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('dark');
  });

  test('should switch to system theme', async ({appearanceSettingsPage}) => {
    await appearanceSettingsPage.systemThemeButton.click();

    expect(await appearanceSettingsPage.getStoredTheme()).toBe('system');
  });
});
