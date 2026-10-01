import {faker} from '@faker-js/faker';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {PW_RESET_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {invalidResetPasswordSearchParams} from 'test/data/reset-password-params.data';
import {EmailUtils} from 'test/utils/email-utils';

import {expect, test} from '../../fixtures';
import {withSearchParams} from '../../utils/url';

test.describe.serial('Password Reset', () => {
  test.describe('Successful Flow', () => {
    test('should successfully reset password', async ({resetPasswordPage, loginPage, homePage}) => {
      await resetPasswordPage.openResetLink(PW_RESET_ACCOUNT_EMAIL);

      const newPassword = faker.internet.password();
      await resetPasswordPage.setNewPassword(newPassword);
      await expect(resetPasswordPage.verifySuccessMessage).toBeVisible();

      await resetPasswordPage.returnToLoginLink.click();
      await loginPage.login(PW_RESET_ACCOUNT_EMAIL, newPassword);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
    });
  });

  test.describe('Authenticated Flow', () => {
    test.use({storageState: VERIFIED_USER_AUTH_FILE});

    test('should redirect to home page if a logged in user navigates to /reset-password', async ({
      page,
      resetPasswordPage,
      homePage,
    }) => {
      await resetPasswordPage.navigate();
      await homePage.expectToBeOnPage();
      expect(page.url()).not.toContain('/reset-password');
      await homePage.expectUserLoggedIn();
    });
  });

  test.describe('Request Phase', () => {
    test('should show reset confirmation message but not send an email for a non-existent account', async ({
      resetPasswordPage,
    }) => {
      await EmailUtils.clearEmails();
      const email = faker.internet.email();
      await resetPasswordPage.requestPasswordReset(email);
      const message = await EmailUtils.findEmailByRecipient(email);
      expect(message).toBeUndefined();
    });

    test('should resend and expect 2 emails', async ({resetPasswordPage}) => {
      await EmailUtils.clearEmails();
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      let count = await EmailUtils.countEmailsByRecipient(VERIFIED_ACCOUNT_EMAIL, 1);
      expect(count).toBe(1);

      await resetPasswordPage.resendButton.click();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      count = await EmailUtils.countEmailsByRecipient(VERIFIED_ACCOUNT_EMAIL, 2);
      expect(count).toBe(2);
    });

    test('should return to email input form when "use a different email" is clicked', async ({
      resetPasswordPage,
    }) => {
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      await resetPasswordPage.useDifferentEmailButton.click();
      await expect(resetPasswordPage.useDifferentEmailButton).toBeHidden();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      await resetPasswordPage.expectRequestFormIsVisible();
    });

    test('should validate the new password on the reset form', async ({resetPasswordPage}) => {
      await resetPasswordPage.openResetLink(VERIFIED_ACCOUNT_EMAIL);
      await resetPasswordPage.expectVerifyFormIsVisible();

      await resetPasswordPage.setNewPassword('');
      await expect(resetPasswordPage.requiredError).toBeVisible();

      await resetPasswordPage.setNewPassword('123');
      await expect(resetPasswordPage.passwordTooShortError).toBeVisible();
    });
  });

  test.describe('Invalid Search Params', () => {
    test('should show "Invalid or expired token" for a validly formatted but incorrect email/token combination', async ({
      page,
      resetPasswordPage,
    }) => {
      await page.goto(
        withSearchParams('/reset-password', {
          email: faker.internet.email(),
          token: faker.string.uuid(),
        }),
      );
      await resetPasswordPage.expectVerifyFormIsVisible();

      await resetPasswordPage.setNewPassword(faker.internet.password());
      await expect(resetPasswordPage.invalidTokenError).toBeVisible();
      await resetPasswordPage.requestNewLink.click();
      await resetPasswordPage.expectRequestFormIsVisible();
    });

    for (const {name, params} of invalidResetPasswordSearchParams) {
      test(`should show request form for: ${name}`, async ({page, resetPasswordPage}) => {
        await page.goto(withSearchParams('/reset-password', params));
        await resetPasswordPage.expectRequestFormIsVisible();
      });
    }
  });
});
