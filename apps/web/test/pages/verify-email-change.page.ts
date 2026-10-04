import {Locator, Page} from '@playwright/test';

export class VerifyEmailChangePage {
  readonly page: Page;
  readonly emailChangeSuccessToast: Locator;
  readonly loginRequiredToast: Locator;
  readonly invalidOrExpiredLinkError: Locator;
  readonly invalidLinkToastTitle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailChangeSuccessToast = page.getByText('Email changed', {exact: true});
    this.loginRequiredToast = page.getByText('Log in to finish changing your email.');
    this.invalidOrExpiredLinkError = page.getByText(
      'This verification link is invalid or has expired.',
    );
    this.invalidLinkToastTitle = page.getByText('This verification link is invalid.');
  }
}
