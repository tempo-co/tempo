import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {invalidResetPasswordSearchParams} from 'test/data/reset-password-params.data';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {ResetPasswordPage} from 'test/pages/reset-password.page';
import {EmailUtils} from 'test/utils/email-utils';
import {
  PW_CHANGE_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/utils/seed.constants';

test.describe('Password Reset', () => {
  let resetPasswordPage: ResetPasswordPage;
  let loginPage: LoginPage;
  let homePage: HomePage;

  test.beforeEach(async ({page}) => {
    resetPasswordPage = new ResetPasswordPage(page);
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    await EmailUtils.clearEmails();
  });

  test.describe('Successful password reset flow', () => {
    test('should successfully reset password', async ({page}) => {
      await resetPasswordPage.requestPasswordReset(PW_CHANGE_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(PW_CHANGE_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

      const newPassword = faker.internet.password();
      await resetPasswordPage.setNewPassword(newPassword);
      await expect(resetPasswordPage.verifySuccessMessage).toBeVisible();

      await resetPasswordPage.returnToLoginLink.click();
      await loginPage.login(PW_CHANGE_ACCOUNT_EMAIL, newPassword);
      await homePage.expectToBeOnPage();
      await homePage.expectUserLoggedIn();
    });

    test('should redirect to home page if a logged in user navigates to /reset-password', async ({
      page,
    }) => {
      await loginPage.navigate();
      await loginPage.login(VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
      await homePage.expectToBeOnPage();

      await resetPasswordPage.navigate();

      await homePage.expectToBeOnPage();
      expect(page.url()).not.toContain('/reset-password');
      await homePage.expectUserLoggedIn();
    });
  });

  test.describe('Request phase', () => {
    test('should show reset confirmation message but not send an email for a non-existent account', async () => {
      const email = faker.internet.email();
      await resetPasswordPage.requestPasswordReset(email);
      const message = await EmailUtils.findEmailByRecipient(PW_CHANGE_ACCOUNT_EMAIL);
      expect(message).toBeUndefined();
    });

    test('should resend and expect 2 emails', async () => {
      await resetPasswordPage.requestPasswordReset(PW_CHANGE_ACCOUNT_EMAIL);

      await resetPasswordPage.resendButton.click();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      const count = await EmailUtils.countEmailsByRecipient(PW_CHANGE_ACCOUNT_EMAIL);
      expect(count).toBe(2);
    });

    test('should return to email input form when "use a different email" is clicked', async () => {
      await resetPasswordPage.requestPasswordReset(PW_CHANGE_ACCOUNT_EMAIL);
      await resetPasswordPage.useDifferentEmailButton.click();
      await expect(resetPasswordPage.useDifferentEmailButton).toBeHidden();
      await expect(resetPasswordPage.openGmailButton).toBeHidden();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      await resetPasswordPage.expectRequestFormIsVisible();
    });

    test('should show error for password too short on reset form', async ({page}) => {
      await resetPasswordPage.requestPasswordReset(PW_CHANGE_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(PW_CHANGE_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

      await resetPasswordPage.expectVerifyFormIsVisible();
      await resetPasswordPage.setNewPassword('123');
      await expect(resetPasswordPage.passwordTooShortError).toBeVisible();
    });

    test('should show error for empty new password on reset form', async ({page}) => {
      await resetPasswordPage.requestPasswordReset(PW_CHANGE_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(PW_CHANGE_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

      await resetPasswordPage.expectVerifyFormIsVisible();
      await resetPasswordPage.setNewPassword('');
      await expect(resetPasswordPage.requiredError).toBeVisible();
    });
  });

  test.describe('Invalid URL parameter handling (defaults to request form)', () => {
    for (const testCase of invalidResetPasswordSearchParams) {
      test(`should show request form for: ${testCase.name}`, async ({page}) => {
        const searchParams = new URLSearchParams();
        for (const key in testCase.params) {
          const value = testCase.params[key];
          searchParams.set(key, String(value));
        }
        const url = `/reset-password?${searchParams.toString()}`;

        await page.goto(url);
        await resetPasswordPage.expectRequestFormIsVisible();
      });
    }
  });
});
