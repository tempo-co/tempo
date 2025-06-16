import {expect, test} from '@playwright/test';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {SecuritySettingsPage} from 'test/pages/security-settings.page';
import {
  PW_CHANGE_ACCOUNT_EMAIL,
  PW_CHANGE_ACCOUNT_PASSWORD,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/utils/seed.constants';

test.describe('Account Settings: Password change', () => {
  let loginPage: LoginPage;
  let homePage: HomePage;
  let securitySettingsPage: SecuritySettingsPage;

  test.beforeEach(({page}) => {
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    securitySettingsPage = new SecuritySettingsPage(page);
  });

  test('should change password successfully', async () => {
    await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD);
    await homePage.expectToBeOnPage();
    await securitySettingsPage.navigate();

    const newPassword = 'newSecurePassword123';
    await securitySettingsPage.changePassword(PW_CHANGE_ACCOUNT_PASSWORD, newPassword);
    await expect(securitySettingsPage.passwordChangedSuccessToast).toBeVisible();

    await homePage.logOut();
    await loginPage.expectToBeOnPage();

    await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, newPassword);
    await homePage.expectToBeOnPage();
  });

  test.describe('Validation errors', () => {
    test.beforeEach(async () => {
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();
      await securitySettingsPage.navigate();
    });

    test('should show error for incorrect current password', async () => {
      await securitySettingsPage.changePassword('wrongpassword', 'newSecurePassword123');
      await expect(securitySettingsPage.invalidCurrentPasswordError).toBeVisible();
    });

    test('should show error for empty current password', async () => {
      await securitySettingsPage.changePasswordButton.click();
      await securitySettingsPage.newPasswordInput.fill('newSecurePassword123');
      await securitySettingsPage.confirmPasswordButton.click();

      await expect(securitySettingsPage.requiredError.first()).toBeVisible();
    });

    test('should show error for empty new password', async () => {
      await securitySettingsPage.changePasswordButton.click();
      await securitySettingsPage.currentPasswordInput.fill(PW_CHANGE_ACCOUNT_PASSWORD);
      await securitySettingsPage.confirmPasswordButton.click();
      
      await expect(securitySettingsPage.requiredError.last()).toBeVisible();
    });

    test('should show error for new password being too short', async () => {
      await securitySettingsPage.changePassword(PW_CHANGE_ACCOUNT_PASSWORD, '123');
      await expect(securitySettingsPage.passwordTooShortError).toBeVisible();
    });
  });
});
