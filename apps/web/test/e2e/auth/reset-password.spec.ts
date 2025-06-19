import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {VERIFIED_USER_AUTH_FILE} from 'test/constants/auth.constants';
import {PW_RESET_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from 'test/constants/seed.constants';
import {invalidResetPasswordSearchParams} from 'test/data/reset-password-params.data';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {ResetPasswordPage} from 'test/pages/reset-password.page';
import {EmailUtils} from 'test/utils/email-utils';

test.describe.serial('Password Reset', () => {
  test.describe('Successful Flow', () => {
    let resetPasswordPage: ResetPasswordPage;
    let loginPage: LoginPage;
    let homePage: HomePage;

    test.beforeEach(({page}) => {
      resetPasswordPage = new ResetPasswordPage(page);
      loginPage = new LoginPage(page);
      homePage = new HomePage(page);
    });

    test('should successfully reset password', async ({page}) => {
      await EmailUtils.clearEmails();

      await resetPasswordPage.requestPasswordReset(PW_RESET_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(PW_RESET_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

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
    }) => {
      const resetPasswordPage = new ResetPasswordPage(page);
      const homePage = new HomePage(page);

      await resetPasswordPage.navigate();
      await homePage.expectToBeOnPage();
      expect(page.url()).not.toContain('/reset-password');
      await homePage.expectUserLoggedIn();
    });
  });

  test.describe('Request Phase', () => {
    let resetPasswordPage: ResetPasswordPage;

    test.beforeEach(({page}) => {
      resetPasswordPage = new ResetPasswordPage(page);
    });

    test('should show reset confirmation message but not send an email for a non-existent account', async () => {
      await EmailUtils.clearEmails();
      const email = faker.internet.email();
      await resetPasswordPage.requestPasswordReset(email);
      const message = await EmailUtils.findEmailByRecipient(VERIFIED_ACCOUNT_EMAIL);
      expect(message).toBeUndefined();
    });

    test('should resend and expect 2 emails', async () => {
      await EmailUtils.clearEmails();
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      let count = await EmailUtils.countEmailsByRecipient(VERIFIED_ACCOUNT_EMAIL, 1);
      expect(count).toBe(1);

      await resetPasswordPage.resendButton.click();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      count = await EmailUtils.countEmailsByRecipient(VERIFIED_ACCOUNT_EMAIL, 2);
      expect(count).toBe(2);
    });

    test('should return to email input form when "use a different email" is clicked', async () => {
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      await resetPasswordPage.useDifferentEmailButton.click();
      await expect(resetPasswordPage.useDifferentEmailButton).toBeHidden();
      await expect(resetPasswordPage.openGmailButton).toBeHidden();
      await expect(resetPasswordPage.resendButton).toBeHidden();

      await resetPasswordPage.expectRequestFormIsVisible();
    });

    test('should show error for password too short on reset form', async ({page}) => {
      await EmailUtils.clearEmails();
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(VERIFIED_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

      await resetPasswordPage.expectVerifyFormIsVisible();
      await resetPasswordPage.setNewPassword('123');
      await expect(resetPasswordPage.passwordTooShortError).toBeVisible();
    });

    test('should show error for empty new password on reset form', async ({page}) => {
      await EmailUtils.clearEmails();
      await resetPasswordPage.requestPasswordReset(VERIFIED_ACCOUNT_EMAIL);
      const message = await EmailUtils.findEmailByRecipient(VERIFIED_ACCOUNT_EMAIL);
      const link = EmailUtils.extractResetPasswordLink(message?.Text);
      await page.goto(link);

      await resetPasswordPage.expectVerifyFormIsVisible();
      await resetPasswordPage.setNewPassword('');
      await expect(resetPasswordPage.requiredError).toBeVisible();
    });
  });

  // Invalid search param tests
  test.describe('Invalid Search Params', () => {
    let resetPasswordPage: ResetPasswordPage;

    test.beforeEach(({page}) => {
      resetPasswordPage = new ResetPasswordPage(page);
    });

    test('should show "Invalid or expired token" for a validly formatted but incorrect email/token combination', async ({
      page,
    }) => {
      const searchParams = new URLSearchParams({
        email: faker.internet.email(),
        token: faker.string.uuid(),
      });
      const invalidUrl = `/reset-password?${searchParams.toString()}`;

      await page.goto(invalidUrl);
      await resetPasswordPage.expectVerifyFormIsVisible();

      const newPassword = faker.internet.password();
      await resetPasswordPage.setNewPassword(newPassword);
      await expect(resetPasswordPage.invalidTokenError).toBeVisible();
      await resetPasswordPage.requestNewLink.click();
      await resetPasswordPage.expectRequestFormIsVisible();
    });

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
