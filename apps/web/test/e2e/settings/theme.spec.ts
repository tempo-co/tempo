import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';

import {expect, test} from '../../fixtures';
import {AppearanceSettingsPage} from '../../pages/appearance-settings.page';

test.use({storageState: VERIFIED_USER_AUTH_FILE});

async function expectSelected(page: AppearanceSettingsPage, selected: 'light' | 'dark' | 'system') {
  const options = {
    light: page.lightThemeButton,
    dark: page.darkThemeButton,
    system: page.systemThemeButton,
  };
  for (const [theme, option] of Object.entries(options)) {
    await expect(option).toHaveAttribute('aria-checked', String(theme === selected));
  }
}

test.describe('Theme Switcher', () => {
  test.beforeEach(async ({appearanceSettingsPage}) => {
    await appearanceSettingsPage.navigate();
  });

  test('should follow the system theme by default', async ({page, appearanceSettingsPage}) => {
    await page.evaluate(() => localStorage.removeItem('vite-ui-theme'));
    await page.emulateMedia({colorScheme: 'light'});
    await page.reload();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    await expectSelected(appearanceSettingsPage, 'system');
    await expect(page.getByRole('radio')).toHaveText(['System', 'Dark', 'Light']);
  });

  test('should switch to light theme', async ({appearanceSettingsPage}) => {
    await appearanceSettingsPage.lightThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('light');
    await expectSelected(appearanceSettingsPage, 'light');

    // Clicking the active option again keeps it selected.
    await appearanceSettingsPage.lightThemeButton.click();
    await expectSelected(appearanceSettingsPage, 'light');
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('light');
  });

  test('should switch to dark theme', async ({appearanceSettingsPage}) => {
    // first switch to light to ensure a state change will occur
    await appearanceSettingsPage.lightThemeButton.click();
    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    await appearanceSettingsPage.darkThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/dark/);
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('dark');
    await expectSelected(appearanceSettingsPage, 'dark');
  });

  test('should switch to system theme', async ({page, appearanceSettingsPage}) => {
    // Start from dark with a light system preference, so following the system is observable.
    await page.emulateMedia({colorScheme: 'light'});
    await appearanceSettingsPage.darkThemeButton.click();
    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/dark/);

    await appearanceSettingsPage.systemThemeButton.click();

    await expect(appearanceSettingsPage.htmlElement).toHaveClass(/light/);
    expect(await appearanceSettingsPage.getStoredTheme()).toBe('system');
    await expectSelected(appearanceSettingsPage, 'system');
  });
});
