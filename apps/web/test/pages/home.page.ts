import {Locator, Page, expect} from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly sidebarAccountName: Locator;
  readonly sidebarAccountEmail: Locator;
  readonly welcomeToastTitle: Locator;
  readonly welcomeToastDescription: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebarAccountName = page.getByTestId('sidebar-current-account-name');
    this.sidebarAccountEmail = page.getByTestId('sidebar-current-account-email');
    this.welcomeToastTitle = page.getByText('Welcome to Flair!');
    this.welcomeToastDescription = page.getByText('Your email has been verified.');
  }

  async expectToBeOnPage() {
    const url = '/';
    await this.page.waitForURL(url);
    await expect(this.page).toHaveURL(url);
  }

  async expectWelcomeMessage() {
    await expect(this.welcomeToastTitle).toBeVisible();
    await expect(this.welcomeToastDescription).toBeVisible();
  }

  async expectUserLoggedIn() {
    await expect(this.sidebarAccountName).toBeVisible();
    await expect(this.sidebarAccountEmail).toBeVisible();
  }
}
