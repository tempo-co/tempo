import {Locator, Page, expect} from '@playwright/test';

export class VerifyEmailPage {
  readonly page: Page;
  readonly inputOtp: Locator;
  readonly verifyCodeButton: Locator;
  readonly enterCodeManuallyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.inputOtp = page.getByTestId('input-otp');
    this.verifyCodeButton = page.getByTestId('verify-button');
    this.enterCodeManuallyButton = page.getByTestId('enter-code-manually-button');
  }

  async expectToBeOnPage() {
    const url = /.*\/verify-email/;
    await this.page.waitForURL(url);
    await expect(this.page).toHaveURL(url);
  }

  async inputCodeAndSubmit(code: string) {
    await this.enterCodeManuallyButton.click();
    await this.inputOtp.fill(code);
    await this.verifyCodeButton.click();
  }
}
