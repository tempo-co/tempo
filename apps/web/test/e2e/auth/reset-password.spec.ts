import {faker} from '@faker-js/faker';
import {expect, test} from '@playwright/test';
import {HomePage} from 'test/pages/home.page';
import {LoginPage} from 'test/pages/login.page';
import {ResetPasswordPage} from 'test/pages/reset-password.page';
import {EmailUtils} from 'test/utils/email-utils';
import {
  PW_CHANGE_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_EMAIL,
  VERIFIED_ACCOUNT_PASSWORD,
} from 'test/utils/seed.constants';

test.describe.serial('Password Reset', () => {
  let resetPasswordPage: ResetPasswordPage;
  let loginPage: LoginPage;
  let homePage: HomePage;

  test.beforeEach(async ({page}) => {
    resetPasswordPage = new ResetPasswordPage(page);
    loginPage = new LoginPage(page);
    homePage = new HomePage(page);
    await EmailUtils.clearEmails();
  });

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

  test('should show request form if token is missing from URL', async ({page}) => {
    const email = PW_CHANGE_ACCOUNT_EMAIL;
    await page.goto(`/reset-password?email=${encodeURIComponent(email)}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form if email is missing from URL', async ({page}) => {
    const token = faker.string.uuid();
    await page.goto(`/reset-password?token=${token}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form if token is not a valid UUID in URL', async ({page}) => {
    const email = PW_CHANGE_ACCOUNT_EMAIL;
    const invalidToken = 'not-a-valid-uuid';
    await page.goto(`/reset-password?token=${invalidToken}&email=${encodeURIComponent(email)}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form if email format is invalid in URL', async ({page}) => {
    const token = faker.string.uuid();
    const invalidEmail = 'not-an-email-address';
    await page.goto(`/reset-password?token=${token}&email=${invalidEmail}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form if token is empty in URL', async ({page}) => {
    const email = PW_CHANGE_ACCOUNT_EMAIL;
    await page.goto(`/reset-password?token=&email=${encodeURIComponent(email)}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form if email is empty in URL', async ({page}) => {
    const token = faker.string.uuid();
    await page.goto(`/reset-password?email=&token=${token}`);
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show request form when navigating to /reset-password with no params', async () => {
    await resetPasswordPage.navigate();
    await resetPasswordPage.expectRequestFormIsVisible();
  });

  test('should show error message when submitting with an unknown/expired token', async ({
    page,
  }) => {
    const unknownToken = faker.string.uuid();
    const email = PW_CHANGE_ACCOUNT_EMAIL;
    await page.goto(`/reset-password?token=${unknownToken}&email=${encodeURIComponent(email)}`);

    await resetPasswordPage.expectVerifyFormIsVisible();
    const newPassword = faker.internet.password();
    await resetPasswordPage.setNewPassword(newPassword);

    await expect(resetPasswordPage.invalidTokenError).toBeVisible();
    await resetPasswordPage.requestNewLink.click();
    await resetPasswordPage.expectRequestFormIsVisible();
  });
});
