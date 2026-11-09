import {expect, test} from '../../fixtures';

test.describe('Account Settings: Password change', () => {
  test.beforeEach(async ({freshAccount, securitySettingsPage, homePage}) => {
    await securitySettingsPage.navigate();
    await expect(homePage.accountEmail).toHaveText(freshAccount.email);
  });

  test('should change password successfully', async ({
    freshAccount,
    securitySettingsPage,
    homePage,
    loginPage,
  }) => {
    const newPassword = 'newSecurePassword123';
    await securitySettingsPage.changePassword(freshAccount.password, newPassword);
    await expect(securitySettingsPage.passwordChangedSuccessToast).toBeVisible();

    await homePage.logOut();
    await loginPage.expectToBeOnPage();

    await loginPage.login(freshAccount.email, newPassword);
    await homePage.expectToBeOnPage();
  });

  test.describe('Validation errors', () => {
    for (const {name, current, next, error} of [
      {
        name: 'incorrect current password',
        current: 'wrongpassword',
        next: 'newSecurePassword123',
        error: 'invalidCurrentPasswordError',
      },
      {
        name: 'empty current password',
        current: '',
        next: 'newSecurePassword123',
        error: 'requiredError',
      },
      {
        name: 'empty new password',
        current: null,
        next: '',
        error: 'requiredError',
      },
      {
        name: 'new password being too short',
        current: null,
        next: '123',
        error: 'passwordTooShortError',
      },
    ] as const) {
      test(`should show error for ${name}`, async ({freshAccount, securitySettingsPage}) => {
        await securitySettingsPage.changePassword(current ?? freshAccount.password, next);
        await expect(securitySettingsPage[error]).toBeVisible();
      });
    }
  });
});
