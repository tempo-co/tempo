import {Page, expect, test} from '@playwright/test';
import {SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD} from 'test/utils/seed.constants';

import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';
import {SecuritySettingsPage} from '../../pages/security-settings.page';

test.describe.serial('Account Settings: Sessions', () => {
  let page1: Page;
  let loginPage1: LoginPage;
  let homePage1: HomePage;

  let page2: Page;
  let loginPage2: LoginPage;
  let homePage2: HomePage;

  let securitySettingsPage: SecuritySettingsPage;

  test.beforeEach(async ({browser}) => {
    page1 = await (await browser.newContext()).newPage();
    loginPage1 = new LoginPage(page1);
    homePage1 = new HomePage(page1);

    page2 = await (await browser.newContext()).newPage();
    loginPage2 = new LoginPage(page2);
    homePage2 = new HomePage(page2);

    securitySettingsPage = new SecuritySettingsPage(page1);

    await loginPage1.login(SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
    await homePage1.expectToBeOnPage();

    await loginPage2.login(SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
    await homePage2.expectToBeOnPage();

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
