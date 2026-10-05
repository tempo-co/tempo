import {Locator, Page, expect} from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly sidebarAccountName: Locator;
  readonly sidebarAccountEmail: Locator;
  readonly sidebarAccountMenuTrigger: Locator;
  readonly sidebarLogOutButton: Locator;
  readonly welcomeToastTitle: Locator;
  readonly welcomeToastDescription: Locator;
  readonly alreadyVerifiedToastTitle: Locator;
  readonly emptyStateTitle: Locator;
  readonly connectBankLink: Locator;
  readonly monthHeading: Locator;
  readonly previousMonthLink: Locator;
  readonly nextMonthLink: Locator;
  readonly nextMonthButton: Locator;
  readonly backToThisMonthLink: Locator;
  readonly syncStatus: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebarAccountName = page.getByTestId('sidebar-current-account-name');
    this.sidebarAccountEmail = page.getByTestId('sidebar-current-account-email');
    this.sidebarAccountMenuTrigger = page.getByTestId('account-menu-trigger');
    this.sidebarLogOutButton = page.getByTestId('log-out-button');
    this.welcomeToastTitle = page.getByText('Welcome to Tempo!');
    this.welcomeToastDescription = page.getByText('Your email has been verified.');
    this.alreadyVerifiedToastTitle = page.getByText('Your email has already been verified.');
    this.emptyStateTitle = page.getByRole('heading', {name: 'Connect a bank to see your month'});
    this.connectBankLink = page.getByRole('link', {name: 'Connect bank'});
    this.monthHeading = page.getByRole('heading', {level: 1});
    this.previousMonthLink = page.getByRole('link', {name: 'Previous month'});
    this.nextMonthLink = page.getByRole('link', {name: 'Next month'});
    this.nextMonthButton = page.getByRole('button', {name: 'Next month'});
    this.backToThisMonthLink = page.getByRole('link', {name: 'Back to this month'});
    this.syncStatus = page.getByTestId('home-sync-status');
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

  async logOut() {
    await this.sidebarAccountMenuTrigger.click();
    await this.sidebarLogOutButton.click();
  }
}
