import {BrowserContext, Page} from '@playwright/test';

import {expect, test} from '../../fixtures';
import {HomePage} from '../../pages/home.page';
import {LoginPage} from '../../pages/login.page';

test.describe('Account Settings: Sessions', () => {
  let page2: Page;
  let loginPage2: LoginPage;
  let context2: BrowserContext | undefined;

  test.beforeEach(async ({browser, freshAccount, securitySettingsPage, homePage}) => {
    context2 = await browser.newContext({storageState: {cookies: [], origins: []}});
    page2 = await context2.newPage();
    loginPage2 = new LoginPage(page2);
    const homePage2 = new HomePage(page2);
    await loginPage2.login(freshAccount.email, freshAccount.password);
    await homePage2.expectToBeOnPage();
    await expect(homePage2.accountEmail).toHaveText(freshAccount.email);

    await securitySettingsPage.navigate();
    await expect(homePage.accountEmail).toHaveText(freshAccount.email);
    await expect(securitySettingsPage.sessionCards).toHaveCount(2);
  });

  test.afterEach(async () => {
    await context2?.close();
    context2 = undefined;
  });

  test('should revoke another session successfully', async ({securitySettingsPage}) => {
    const otherSessionCard = securitySettingsPage.otherSessionCards.first();
    await securitySettingsPage.getRevokeButton(otherSessionCard).click();
    await securitySettingsPage.revokeButtonConfirm.click();

    await expect(securitySettingsPage.sessionRevokeSuccessToast).toBeVisible();
    await expect(otherSessionCard).not.toBeVisible();

    // Check that the other session is logged out
    await page2.reload();
    await loginPage2.expectToBeOnPage();
  });

  test('should revoke all other sessions', async ({securitySettingsPage, page: page1}) => {
    await expect(securitySettingsPage.otherSessionCards.first()).toBeVisible();
    const otherSessionCount = await securitySettingsPage.otherSessionCards.count();
    await expect(securitySettingsPage.otherSessionsHeading).toHaveText(
      `Other sessions (${otherSessionCount})`,
    );
    const otherSessionsSection = securitySettingsPage.otherSessionsSection;
    await expect(otherSessionsSection.getByTestId('session-card')).toHaveCount(otherSessionCount);
    await expect(otherSessionsSection.locator('[data-current-session="true"]')).toHaveCount(0);

    await securitySettingsPage.revokeAllButton.click();
    await expect(
      page1.getByRole('dialog').getByText('Log out every session except this one?'),
    ).toBeVisible();
    await securitySettingsPage.revokeAllButtonConfirm.click();

    await expect(securitySettingsPage.currentSessionCard).toBeVisible();
    await expect(securitySettingsPage.sessionCards).toHaveCount(1);
    await expect(securitySettingsPage.revokeAllButton).not.toBeVisible();
    await expect(securitySettingsPage.otherSessionsHeading).not.toBeVisible();
  });

  test('should log out of the current session', async ({
    securitySettingsPage,
    loginPage: loginPage1,
  }) => {
    await securitySettingsPage.logOutButton.click();
    await securitySettingsPage.logOutButtonConfirm.click();

    await loginPage1.expectToBeOnPage();
  });
});
