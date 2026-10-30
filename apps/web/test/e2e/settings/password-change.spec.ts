import {PW_CHANGE_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {PW_CHANGE_ACCOUNT_EMAIL, PW_CHANGE_ACCOUNT_PASSWORD} from 'test/constants/seed.constants';

import {expect, test} from '../../fixtures';

test.use({storageState: PW_CHANGE_USER_AUTH_FILE});

test.describe('Account Settings: Password change', () => {
  test.beforeEach(async ({securitySettingsPage}) => {
    await securitySettingsPage.navigate();
  });

  test('should change password successfully', async ({
    securitySettingsPage,
    homePage,
    loginPage,
  }) => {
    const newPassword = 'newSecurePassword123';
    await securitySettingsPage.changePassword(PW_CHANGE_ACCOUNT_PASSWORD, newPassword);
    await expect(securitySettingsPage.passwordChangedSuccessToast).toBeVisible();

    await homePage.logOut();
    await loginPage.expectToBeOnPage();

    await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, newPassword);
    await homePage.expectToBeOnPage();
  });

  test.describe('Validation errors', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

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
        current: PW_CHANGE_ACCOUNT_PASSWORD,
        next: '',
        error: 'requiredError',
      },
      {
        name: 'new password being too short',
        current: PW_CHANGE_ACCOUNT_PASSWORD,
        next: '123',
        error: 'passwordTooShortError',
      },
    ] as const) {
      test(`should show error for ${name}`, async ({securitySettingsPage}) => {
        await securitySettingsPage.changePassword(current, next);
        await expect(securitySettingsPage[error]).toBeVisible();
      });
    }
  });
});
