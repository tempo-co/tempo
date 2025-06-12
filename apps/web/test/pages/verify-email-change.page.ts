import {Locator, Page} from '@playwright/test';

export class VerifyEmailChangePage {
  readonly page: Page;
  readonly emailChangeSuccessToast: Locator;
  readonly invalidOrExpiredLinkError: Locator;
  readonly invalidLinkToastTitle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailChangeSuccessToast = page.getByText('Your new email has been verified.');
    this.invalidOrExpiredLinkError = page.getByText(
      'This verification link is invalid or has expired.',
    );
    this.invalidLinkToastTitle = page.getByText('This verification link is invalid.');
  }
}
