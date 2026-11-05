import {Locator, Page, expect} from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly accountName: Locator;
  readonly accountEmail: Locator;
  readonly accountMenuTrigger: Locator;
  readonly logOutButton: Locator;
  readonly welcomeToastTitle: Locator;
  readonly welcomeToastDescription: Locator;
  readonly alreadyVerifiedToastTitle: Locator;
  readonly emptyStateTitle: Locator;
  readonly connectBankLink: Locator;
  readonly whereYouStand: Locator;
  readonly totalBalance: Locator;
  readonly yearTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.accountName = page.getByTestId('current-account-name');
    this.accountEmail = page.getByTestId('current-account-email');
    this.accountMenuTrigger = page.getByTestId('account-menu-trigger');
    this.logOutButton = page.getByTestId('log-out-button');
    this.welcomeToastTitle = page.getByText('Welcome to Tempo!');
    this.welcomeToastDescription = page.getByText('Your email has been verified.');
    this.alreadyVerifiedToastTitle = page.getByText('Your email has already been verified.');
    this.emptyStateTitle = page.getByRole('heading', {
      name: 'Connect a bank to see where you stand',
    });
    this.connectBankLink = page.getByRole('link', {name: 'Connect bank'});
    this.whereYouStand = page.getByRole('region', {name: 'Where you stand'});
    this.totalBalance = this.whereYouStand
      .getByRole('heading', {name: 'Total balance'})
      .locator('xpath=following-sibling::p[1]');
    this.yearTable = page.getByRole('region', {name: 'Year by year'});
  }

  /** The month dialog, named by its title ("March 2026"). */
  monthDialog(title: string) {
    return this.page.getByRole('dialog', {name: title});
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
    await expect(this.accountName).toBeVisible();
    await expect(this.accountEmail).toBeVisible();
  }

  async logOut() {
    await this.accountMenuTrigger.click();
    await this.logOutButton.click();
  }
}
