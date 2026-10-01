import {faker} from '@faker-js/faker';
import {EMAIL_CHANGE_USER_AUTH_FILE, VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {UNVERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {EmailUtils} from 'test/utils/email-utils';

import {expect, test} from '../../fixtures';

test.use({storageState: EMAIL_CHANGE_USER_AUTH_FILE});

test.describe('Account Settings: Email change', () => {
  test('should change email successfully', async ({
    page,
    accountSettingsPage,
    homePage,
    verifyEmailChangePage,
  }) => {
    const newEmail = faker.internet.email();

    await accountSettingsPage.checkEmailAvailability(newEmail);
    await accountSettingsPage.sendVerificationLinkButton.click();

    const message = await EmailUtils.findEmailByRecipient(newEmail);
    await page.goto(EmailUtils.extractEmailChangeLink(message?.Text));

    await homePage.expectToBeOnPage();
    await expect(verifyEmailChangePage.emailChangeSuccessToast).toBeVisible();
    await expect(homePage.sidebarAccountEmail).toHaveText(newEmail);
  });

  test('should allow navigating back to step 1 from step 2', async ({accountSettingsPage}) => {
    const newEmail = faker.internet.email();
    await accountSettingsPage.checkEmailAvailability(newEmail);

    await expect(accountSettingsPage.getStep2DescriptionLocator(newEmail)).toBeVisible();
    await accountSettingsPage.backButton.click();

    await expect(accountSettingsPage.emailChangeStep1Description).toBeVisible();
    await expect(accountSettingsPage.newEmailInput).toBeEmpty();
  });

  test.describe('Validation errors', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    for (const {name, email, error} of [
      {
        name: 'email already in use',
        email: UNVERIFIED_ACCOUNT_EMAIL,
        error: 'emailAlreadyInUseError',
      },
      {
        name: 'new email is the same as the current one',
        email: VERIFIED_ACCOUNT_EMAIL,
        error: 'sameEmailError',
      },
      {name: 'invalid email format', email: 'not-an-email', error: 'invalidEmailError'},
    ] as const) {
      test(`should show error when ${name}`, async ({accountSettingsPage}) => {
        await accountSettingsPage.checkEmailAvailability(email);
        await expect(accountSettingsPage[error]).toBeVisible();
      });
    }
  });
});
