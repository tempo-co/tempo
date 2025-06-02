import {Locator, Page, expect} from '@playwright/test';

export class ResetPasswordPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly continueButton: Locator;
  readonly returnToLoginLink: Locator;
  readonly newPasswordInput: Locator;
  readonly resetPasswordButton: Locator;
  readonly verifySuccessMessage: Locator;
  readonly passwordTooShortError: Locator;
  readonly requiredError: Locator;
  readonly openGmailButton: Locator;
  readonly resendButton: Locator;
  readonly useDifferentEmailButton: Locator;
  readonly invalidTokenError: Locator;
  readonly requestNewLink: Locator;

  constructor(page: Page) {
    this.page = page;

    // request phase
    this.emailInput = page.getByTestId('email-input');
    this.continueButton = page.getByTestId('continue-button');
    this.returnToLoginLink = page.getByTestId('return-to-login-link');
    this.openGmailButton = page.getByTestId('open-gmail-button');
    this.resendButton = page.getByTestId('resend-button');
    this.useDifferentEmailButton = page.getByTestId('use-different-email-button');

    // verify phase
    this.newPasswordInput = page.getByTestId('password-input');
    this.resetPasswordButton = page.getByTestId('reset-button');
    this.verifySuccessMessage = page.getByText('Password reset successful');
    this.passwordTooShortError = page.getByText('Too short. Must be at least 8 characters.');
    this.requiredError = page.getByText('Required');
    this.invalidTokenError = page.getByText('Invalid or expired token');
    this.requestNewLink = page.getByTestId('request-new-link');
  }

  async navigate() {
    await this.page.goto('/reset-password');
  }

  async setNewPassword(password: string) {
    await this.newPasswordInput.fill(password);
    await this.resetPasswordButton.click();
  }

  async expectVerifyFormIsVisible() {
    await expect(this.newPasswordInput).toBeVisible();
    await expect(this.resetPasswordButton).toBeVisible();
  }

  async expectRequestFormIsVisible() {
    await expect(this.emailInput).toBeVisible();
    await expect(this.continueButton).toBeVisible();
    await expect(this.returnToLoginLink).toBeVisible();
  }

  async requestPasswordReset(email: string) {
    await this.navigate();
    await this.emailInput.fill(email);
    await this.continueButton.click();

    await expect(this.page.getByText(email)).toBeVisible();
    await expect(this.resendButton).toBeVisible();
    await expect(this.useDifferentEmailButton).toBeVisible();
    await expect(this.openGmailButton).toBeVisible();
    await expect(this.returnToLoginLink).toBeVisible();
  }
}
