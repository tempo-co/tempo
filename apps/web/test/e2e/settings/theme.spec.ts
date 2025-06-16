import {expect, test} from '@playwright/test';
import {AppearanceSettingsPage} from 'test/pages/appearance-settings.page';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from 'test/utils/seed.constants';

test.describe('Theme Switcher', () => {
  let loginPage: LoginPage;
  let homePage: HomePage;
  let appearanceSettingsPage: AppearanceSettingsPage;

  test.beforeEach(async ({page}) => {
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    appearanceSettingsPage = new AppearanceSettingsPage(page);

    await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
    await homePage.expectToBeOnPage();
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
