import {Page, expect, test} from '@playwright/test';
import {HomePage} from 'test/pages/home.page';
import {
  SESSION_TEST_ACCOUNT_EMAIL,
  SESSION_TEST_ACCOUNT_PASSWORD,
  SESSION_TEST_USER_AUTH_FILE,
} from 'test/utils/seed.constants';

import {LoginPage} from '../../pages/login.page';
import {SecuritySettingsPage} from '../../pages/security-settings.page';

test.describe.serial('Account Settings: Sessions', () => {
  let page1: Page;
  let loginPage1: LoginPage;
  let page2: Page;
  let loginPage2: LoginPage;
  let homePage2: HomePage;

  let securitySettingsPage: SecuritySettingsPage;

  test.beforeEach(async ({browser}) => {
    const context1 = await browser.newContext({storageState: SESSION_TEST_USER_AUTH_FILE});
    page1 = await context1.newPage();
    loginPage1 = new LoginPage(page1);

    const context2 = await browser.newContext();
    page2 = await context2.newPage();
    loginPage2 = new LoginPage(page2);
    homePage2 = new HomePage(page2);
    await loginPage2.login(SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
    await homePage2.expectToBeOnPage();

    securitySettingsPage = new SecuritySettingsPage(page1);
    await securitySettingsPage.navigate();
  });

  test('should revoke another session successfully', async () => {
    const otherSessionCard = securitySettingsPage.otherSessionCards.first();
    await otherSessionCard.hover();
    await securitySettingsPage.revokeButton.click();
    await securitySettingsPage.revokeButtonConfirm.click();

    await expect(securitySettingsPage.sessionRevokeSuccessToast).toBeVisible();
    await expect(otherSessionCard).not.toBeVisible();

    // Check that the other session is logged out
    await page2.reload();
    await loginPage2.expectToBeOnPage();
  });

  test('should revoke all other sessions', async () => {
    await securitySettingsPage.revokeAllButton.click();
    await securitySettingsPage.revokeAllButtonConfirm.click();

    await expect(securitySettingsPage.currentSessionCard).toBeVisible();
    await expect(securitySettingsPage.sessionCards).toHaveCount(1);
    await expect(securitySettingsPage.revokeAllButton).not.toBeVisible();
  });

  test('should log out of the current session', async () => {
    await securitySettingsPage.currentSessionCard.hover();
    await securitySettingsPage.logOutButton.click();
    await securitySettingsPage.logOutButtonConfirm.click();

    await loginPage1.expectToBeOnPage();
  });
});
