import {Locator, Page, expect} from '@playwright/test';

export class VerifyEmailPage {
  readonly page: Page;
  readonly inputOtp: Locator;
  readonly verifyCodeButton: Locator;
  readonly enterCodeManuallyButton: Locator;
  readonly pageTitle: Locator;
  readonly logOutButton: Locator;
  readonly invalidOrExpiredCodeError: Locator;
  readonly invalidLinkToastTitle: Locator;
  readonly invalidOrExpiredLinkError: Locator;
  readonly emailAlreadyVerifiedToast: Locator;
  readonly resendSuccessToastTitle: Locator;
  readonly resendCodeButton: Locator;
  readonly logInButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.inputOtp = page.getByTestId('input-otp');
    this.verifyCodeButton = page.getByTestId('verify-button');
    this.enterCodeManuallyButton = page.getByTestId('enter-code-manually-button');
    this.pageTitle = page.getByText('Check your email');
    this.logOutButton = page.getByRole('button', {name: 'Log out'});
    this.invalidOrExpiredCodeError = page.getByText('This code is invalid or has expired.');
    this.invalidOrExpiredLinkError = page.getByText('Invalid or expired verification link');
    this.invalidLinkToastTitle = page.getByText('Invalid verification link');
    this.emailAlreadyVerifiedToast = page.getByText('Your email has already been verified');
    this.resendSuccessToastTitle = page.getByText('New verification email sent');
    this.resendCodeButton = page.getByTestId('resend-code-button');
    this.logInButton = page.getByTestId('log-in-button');
  }

  async navigate() {
    await this.page.goto('/verify-email');
  }

  async expectToBeOnPage() {
    const url = /.*\/verify-email/;
    await this.page.waitForURL(url);
    await expect(this.page).toHaveURL(url);
    await expect(this.pageTitle).toBeVisible();
  }

  async inputCodeAndSubmit(code: string) {
    await this.enterCodeManuallyButton.click();
    await this.inputOtp.fill(code);
    await this.verifyCodeButton.click();
  }
}
